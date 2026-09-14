import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService, TenantClient } from '../../database/prisma.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';

interface ChecklistItem {
  label: string;
  done: boolean;
  priceCode?: string;
  sku?: string;  // מקשר לפריט מלאי (InventoryItem.sku) - נפרד מ-priceCode בכוונה:
  qty?: number;  // לא כל שורת מחירון צורכת חלק פיזי (למשל "בדיקת גז" - אין sku)
}

interface LowStockAlert {
  sku: string;
  name: string;
  quantity: number;
}

export interface StockRow {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  lowStockThreshold: number;
}

// ============================================================
// Inventory Agent (מסמך הארכיטקטורה, סעיף 6.3) - שני מצבי עבודה
// על אותה טבלה בדיוק (InventoryItem):
//
// 1. מצב שירות שטח (פעיל עכשיו): ניכוי אוטומטי בסגירת checklist item
//    עם sku מוגדר - ראו handleTaskClosed.
//
// 2. מצב קמעונאות: אותה טבלה, 50k SKU לטננט. כל שאילתה כאן נכתבת
//    כאילו זה הגודל — כולל findLowStock, שהיה findMany + filter ב-JS.
//
// הניכוי נכתב מחדש מהיסוד. מה שהיה:
//   findUnique -> update({ decrement }) בלולאה, מחוץ לכל טרנזקציה.
//   checklist של 10 פריטים = 20 שאילתות; קריסה באמצע השאירה חצי
//   מה-SKU מנוכים בלי rollback ובלי שום תיעוד; כמות יכלה לרדת מתחת
//   לאפס ורק נרשמה אזהרה *אחרי* המעשה.
//
// מה שיש עכשיו:
//   • כל הניכוי בטרנזקציית forTenant אחת — או הכל, או כלום.
//   • כל שינוי כמות מייצר שורת StockMovement עם quantityAfter, כך
//     שההיסטוריה ניתנת לשחזור.
//   • `@@unique([taskId, inventoryItemId, reason])` הופך סגירה כפולה
//     לבלתי אפשרית ברמת ה-DB. P2002 = "כבר נוכה", לא שגיאה.
//   • הכמות לא יכולה לרדת מתחת לאפס: התנאי `quantity >= qty` נמצא
//     ב-UPDATE עצמו, ושורה שלא עודכנה מגלגלת את כל הטרנזקציה לאחור.
// ============================================================

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  // EventEmitter2.emit() לא ממתין ולא תופס — מאזין async שנדחה הוא
  // unhandled rejection שמפילה את התהליך לכל הטננטים, אחרי שה-200
  // כבר נשלח. עד שה-outbox יחליף את ה-emit (קונבנציות, סעיף 7),
  // הגוף עטוף ולא זורק החוצה לעולם.
  @OnEvent('task.closed')
  async handleTaskClosed(payload: { tenantId: string; taskId: string }): Promise<void> {
    try {
      await this.consumeForTask(payload.tenantId, payload.taskId);
    } catch (err) {
      if (isUniqueViolation(err)) {
        // סגירה כפולה שהגיעה במקביל: הטרנזקציה השנייה נחסמה ע"י
        // ה-unique constraint וגולגלה לאחור במלואה. זו בדיוק ההתנהגות
        // הרצויה, לא תקלה.
        this.logger.log(`Stock for task ${payload.taskId} was already deducted - skipping duplicate close`);
        return;
      }
      this.logger.error(
        `task.closed stock deduction failed for task ${payload.taskId} (tenant ${payload.tenantId}): ` +
          `${describeError(err)} - inventory left unchanged, needs manual review`,
      );
    }
  }

  /**
   * מנכה את כל ה-SKU שנצרכו במשימה, בטרנזקציה אחת.
   * מחזיר את הפריטים שירדו לסף התראה (האירוע נפלט אחרי commit).
   */
  private async consumeForTask(tenantId: string, taskId: string): Promise<void> {
    const lowStock = await this.prisma.forTenant(tenantId, async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: taskId, tenantId },
        select: { checklist: true },
      });
      if (!task) throw new NotFoundException('Task not found');

      const plan = consumptionPlan(task.checklist);
      if (plan.size === 0) return [];

      const items = await tx.inventoryItem.findMany({
        where: { tenantId, sku: { in: [...plan.keys()] } },
        select: { id: true, sku: true, name: true },
      });
      const bySku = new Map(items.map((item) => [item.sku, item]));

      // דילוג מקדים על מה שכבר נוכה. ה-unique constraint הוא הערובה
      // מול race אמיתי; הבדיקה הזו היא כדי שסגירה חוזרת *סדרתית*
      // (למשל אחרי עריכת checklist) תנכה רק את מה שנוסף, במקום
      // להתנגש ולהיכשל כולה.
      const recorded = await tx.stockMovement.findMany({
        where: { tenantId, taskId, reason: 'TASK_CONSUMPTION' },
        select: { inventoryItemId: true },
      });
      const alreadyDeducted = new Set(recorded.map((m) => m.inventoryItemId));

      const movements: Prisma.StockMovementCreateManyInput[] = [];
      const alerts: LowStockAlert[] = [];

      for (const [sku, qty] of plan) {
        const item = bySku.get(sku);
        if (!item) {
          // SKU שאינו בטבלה הוא טעות הקלדה בתבנית, לא סיבה לגלגל
          // לאחור ניכוי תקין של שאר הפריטים.
          this.logger.warn(
            `Task ${taskId} closed with sku "${sku}" not found in inventory for tenant ${tenantId}`,
          );
          continue;
        }
        if (alreadyDeducted.has(item.id)) continue;

        const row = await this.decrementOrFail(tx, tenantId, item.id, qty);
        if (!row) {
          // בלי rollback כאן היינו כותבים מלאי שלילי — בדיוק הבאג
          // שהוחלף. הטרנזקציה כולה נופלת, ושום SKU לא מנוכה חלקית.
          throw new ConflictException(
            `Insufficient stock for sku "${sku}" while closing task ${taskId} (needed ${qty})`,
          );
        }

        movements.push({
          tenantId,
          inventoryItemId: item.id,
          delta: -qty,
          quantityAfter: row.quantity,
          reason: 'TASK_CONSUMPTION',
          taskId,
        });

        if (row.quantity <= row.lowStockThreshold) {
          alerts.push({ sku, name: item.name, quantity: row.quantity });
        }
      }

      if (movements.length > 0) {
        // כתיבה אחת. התנגשות כאן (P2002) מפילה את כל הטרנזקציה —
        // וזה נכון: המשמעות היא שהמשימה כבר נוכתה במקביל.
        await tx.stockMovement.createMany({ data: movements });
      }

      return alerts;
    });

    for (const alert of lowStock) {
      this.logger.warn(
        `Low stock alert: "${alert.name}" (${alert.sku}) is at ${alert.quantity} units for tenant ${tenantId}`,
      );
      // TODO: Comms module לא מאזין לאירוע הזה עדיין - hook מוכן
      // להתראת מנהל ברגע שיתווסף template מתאים.
      this.events.emit('inventory.low_stock', { tenantId, ...alert });
    }
  }

  /**
   * ניכוי אטומי עם רצפה באפס.
   *
   * ה-UPDATE נושא את התנאי `quantity >= qty` בעצמו, ולכן אין חלון
   * בין בדיקה לכתיבה. `RETURNING` נותן את quantityAfter מאותה שורה
   * שבאמת עודכנה — זה מה שהופך את ההיסטוריה לניתנת לשחזור, במקום
   * לקרוא שוב אחרי ה-update ולקבל את מה שקרה בינתיים.
   * מחזיר null אם אין מספיק מלאי (או שהשורה אינה של הטננט הזה).
   */
  private async decrementOrFail(
    tx: TenantClient,
    tenantId: string,
    itemId: string,
    qty: number,
  ): Promise<{ quantity: number; lowStockThreshold: number } | null> {
    const rows = await tx.$queryRaw<Array<{ quantity: number; lowStockThreshold: number }>>`
      UPDATE "inventory_items"
      SET "quantity" = "quantity" - ${qty}::int, "updatedAt" = now()
      WHERE "id" = ${itemId}::uuid
        AND "tenantId" = ${tenantId}::uuid
        AND "quantity" >= ${qty}::int
      RETURNING "quantity", "lowStockThreshold"
    `;
    return rows[0] ?? null;
  }

  // --- שימוש עתידי: matching מול הזמנה נכנסת בקמעונאות (סעיף 5.2) ---
  async checkAvailability(
    tenantId: string,
    sku: string,
    requestedQty: number,
  ): Promise<{ available: boolean; currentQuantity: number }> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: { tenantId, sku },
        select: { quantity: true },
      });
      if (!item) return { available: false, currentQuantity: 0 };
      return { available: item.quantity >= requestedQty, currentQuantity: item.quantity };
    });
  }

  // --- CRUD בסיסי לניהול ידני של המלאי ---

  async findAll(tenantId: string, page: { limit?: number; offset?: number } = {}) {
    const take = page.limit ?? 100;
    const skip = page.offset ?? 0;
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.inventoryItem.findMany({
        where: { tenantId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take,
        skip,
      }),
    );
  }

  /**
   * פריטים שהכמות שלהם ירדה לסף ההתראה.
   *
   * היה findMany על כל הטבלה + filter ב-JS. זה נכון לחברת אחזקה עם
   * מאות פריטים ושגוי לחלוטין לוורטיקל RETAIL שהסכימה תומכת בו
   * במפורש — 50k שורות שנשלפות לזיכרון בכל טעינת מסך.
   *
   * Prisma לא יודע להשוות שתי עמודות של אותה שורה ב-where, ולכן raw.
   * זה רץ בתוך forTenant ולכן ה-RLS חל עליו כרגיל; `tenantId` המפורש
   * הוא גם השכבה השנייה וגם מה שמאפשר לאינדקס `[tenantId, quantity]`
   * לצמצם את הסריקה לשורות של הטננט בלבד.
   */
  async findLowStock(tenantId: string, page: { limit?: number; offset?: number } = {}): Promise<StockRow[]> {
    const take = page.limit ?? 100;
    const skip = page.offset ?? 0;
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.$queryRaw<StockRow[]>`
        SELECT "id", "sku", "name", "quantity", "lowStockThreshold"
        FROM "inventory_items"
        WHERE "tenantId" = ${tenantId}::uuid
          AND "isActive" = true
          AND "quantity" <= "lowStockThreshold"
        ORDER BY "quantity" ASC, "name" ASC
        LIMIT ${take}::int OFFSET ${skip}::int
      `,
    );
  }

  async create(tenantId: string, data: CreateInventoryItemDto, actorUserId?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      try {
        const item = await tx.inventoryItem.create({
          data: {
            tenantId,
            sku: data.sku,
            name: data.name,
            quantity: data.quantity ?? 0,
            lowStockThreshold: data.lowStockThreshold ?? 5,
            // כסף הוא Decimal, לא Number (קונבנציות, סעיף 4).
            unitPrice: data.unitPrice == null ? null : new Prisma.Decimal(data.unitPrice),
            category: data.category ?? null,
          },
        });

        // מלאי פתיחה הוא שינוי כמות ככל שינוי אחר, ולכן גם הוא מקבל
        // שורת תנועה — אחרת ההיסטוריה לא מסתכמת לכמות הנוכחית.
        if (item.quantity !== 0) {
          await tx.stockMovement.create({
            data: {
              tenantId,
              inventoryItemId: item.id,
              delta: item.quantity,
              quantityAfter: item.quantity,
              reason: 'RESTOCK',
              note: 'initial stock',
              actorUserId: actorUserId ?? null,
            },
          });
        }

        return item;
      } catch (err) {
        // `@@unique([tenantId, sku])` במקום findFirst-ואז-create, שהוא
        // race: שתי בקשות מקבילות עוברות שתיהן את הבדיקה (סעיף 6).
        if (isUniqueViolation(err)) {
          throw new BadRequestException(`SKU "${data.sku}" already exists for this tenant`);
        }
        throw err;
      }
    });
  }

  /**
   * restock/תיקון ידני - delta חיובי (הגיע מלאי) או שלילי (תיקון
   * אחרי ספירת מלאי פיזית). גם כאן: אטומי, לא יורד מתחת לאפס,
   * ומשאיר שורת StockMovement.
   */
  async adjustQuantity(
    tenantId: string,
    id: string,
    delta: number,
    opts: { note?: string; actorUserId?: string } = {},
  ): Promise<StockRow> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<StockRow[]>`
        UPDATE "inventory_items"
        SET "quantity" = "quantity" + ${delta}::int, "updatedAt" = now()
        WHERE "id" = ${id}::uuid
          AND "tenantId" = ${tenantId}::uuid
          AND "quantity" + ${delta}::int >= 0
        RETURNING "id", "sku", "name", "quantity", "lowStockThreshold"
      `;

      const row = rows[0];
      if (!row) {
        // שתי סיבות אפשריות לאפס שורות — מפרידים ביניהן כדי שהקורא
        // יקבל 404 או 409, לא "משהו נכשל".
        const existing = await tx.inventoryItem.findFirst({
          where: { id, tenantId },
          select: { quantity: true },
        });
        if (!existing) throw new NotFoundException('Inventory item not found for this tenant');
        throw new ConflictException(
          `Adjustment of ${delta} would take quantity below zero (current ${existing.quantity})`,
        );
      }

      await tx.stockMovement.create({
        data: {
          tenantId,
          inventoryItemId: row.id,
          delta,
          quantityAfter: row.quantity,
          reason: delta > 0 ? 'RESTOCK' : 'MANUAL_ADJUSTMENT',
          note: opts.note ?? null,
          actorUserId: opts.actorUserId ?? null,
        },
      });

      return row;
    });
  }
}

/**
 * מאחד את ה-checklist למפת sku -> כמות כוללת.
 *
 * האיחוד אינו קוסמטי: ה-unique הוא על (taskId, inventoryItemId, reason),
 * ולכן אותו SKU פעמיים ב-checklist חייב להפוך לתנועה אחת בכמות
 * מצטברת — אחרת הכתיבה השנייה מתנגשת ומפילה את כל הסגירה.
 */
function consumptionPlan(checklist: unknown): Map<string, number> {
  const plan = new Map<string, number>();
  if (!Array.isArray(checklist)) return plan;

  for (const raw of checklist) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as ChecklistItem;
    if (item.done !== true) continue;
    if (typeof item.sku !== 'string' || item.sku.length === 0) continue;

    const qty = typeof item.qty === 'number' && Number.isInteger(item.qty) && item.qty > 0 ? item.qty : 1;
    plan.set(item.sku, (plan.get(item.sku) ?? 0) + qty);
  }
  return plan;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
