import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';
import { PrismaService, TenantClient } from '../../database/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { generateInvoicePdf } from './invoice-pdf.util';

interface ChecklistItem {
  label: string;
  done: boolean;
  priceCode?: string;
}

interface PendingLineItem {
  taskId: string;
  priceCode: string;
  description: string;
  amount: Prisma.Decimal;
}

// ============================================================
// Invoicing Agent (מסמך הארכיטקטורה, סעיפים 6.4 + טבלת 5.1 שורות 6ג/7).
//
// שני תפקידים נפרדים בכוונה:
//
// 1. validateClosedTask (@OnEvent('task.closed')) - רץ מיד בסגירה,
//    רק *מוודא* שכל checklist item עם priceCode קיים במחירון.
//
// 2. generateInvoice() - פעולה יזומה של מנהל (טבלה 5.1, שורה 7).
//
// ------------------------------------------------------------
// שלושה דברים שתוקנו כאן
// ------------------------------------------------------------
//
// א. כסף. הגרסה הקודמת עשתה `Number(priceEntry.price)` ואז `reduce`
//    על floats. `totalAmount` שנכתב כך *לא* שווה ל-`SUM(amount)` של
//    השורות של אותה חשבונית — בדיוק המספר שצריך להסתדר. כל המסלול
//    כאן הוא `Prisma.Decimal`, מהמחירון ועד ה-PDF.
//
// ב. מספר חשבונית רץ. `Invoice.invoiceNumber` הוא דרישה חשבונאית
//    ולא ניתן להפיק מ-UUID. הוא מוקצה *בתוך* הטרנזקציה תחת
//    `pg_advisory_xact_lock` לכל טננט, כך שאין כפילויות ואין דילוגים
//    גם כששני מנהלים לוחצים "הפק" באותה שנייה.
//
// ג. חיוב כפול. הבדיקה הישנה הייתה read-then-write: קריאת
//    `alreadyInvoiced` *מחוץ* לטרנזקציה ואז כתיבה. שתי בקשות מקבילות
//    עברו שתיהן. עכשיו ה-`@@unique([taskId, priceCode])` הוא הערובה,
//    וה-P2002 מטופל כ-409.
// ============================================================

/** מזהה נעילה יציב לטננט: FNV-1a 32-bit על ה-UUID. */
function tenantLockKey(tenantId: string): bigint {
  let hash = 2166136261;
  for (let i = 0; i < tenantId.length; i++) {
    hash ^= tenantId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // advisory lock מקבל bigint חתום; >>> 0 מבטיח טווח לא-שלילי.
  return BigInt(hash >>> 0);
}

function isUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  async validateClosedTask(payload: { tenantId: string; taskId: string }): Promise<void> {
    const missing = await this.prisma.forTenant(payload.tenantId, async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: payload.taskId, tenantId: payload.tenantId },
        select: { checklist: true },
      });
      if (!task?.checklist) return [];

      const checklist = task.checklist as unknown as ChecklistItem[];
      const priceCodes = checklist
        .filter((item) => item.done && item.priceCode)
        .map((item) => item.priceCode as string);
      if (priceCodes.length === 0) return [];

      const found = await tx.priceListItem.findMany({
        where: { tenantId: payload.tenantId, code: { in: priceCodes }, isActive: true },
        select: { code: true },
      });
      const foundCodes = new Set(found.map((f) => f.code));
      return priceCodes.filter((code) => !foundCodes.has(code));
    });

    if (missing.length > 0) {
      this.logger.warn(
        `Task ${payload.taskId} closed with checklist priceCode(s) not found in PriceListItem: ` +
          `${missing.join(', ')}. Invoice generation will skip these line items until a manager ` +
          `adds them to the price list.`,
      );
    }
  }

  async generateInvoice(
    tenantId: string,
    params: { customerId: string; periodStart: Date; periodEnd: Date },
  ) {
    // --- שלב 1: קריאה + חישוב. טרנזקציה קצרה, בלי קריאות רשת. ---
    const prepared = await this.prisma.forTenant(tenantId, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: params.customerId, tenantId },
        select: { id: true, name: true },
      });
      if (!customer) throw new NotFoundException('Customer not found for this tenant');

      const tenant = await tx.tenant.findFirstOrThrow({
        where: { id: tenantId },
        select: { name: true },
      });

      // סינון מוקדם של משימות שכבר חויבו. זו *אופטימיזציה*, לא ערובה —
      // הערובה היא ה-unique constraint בשלב הכתיבה.
      const alreadyInvoiced = await tx.invoiceLineItem.findMany({
        where: { taskId: { not: null }, invoice: { tenantId, customerId: params.customerId } },
        select: { taskId: true },
      });
      const excludeTaskIds = alreadyInvoiced
        .map((i) => i.taskId)
        .filter((id): id is string => id !== null);

      const closedTasks = await tx.task.findMany({
        where: {
          tenantId,
          customerId: params.customerId,
          status: 'CLOSED',
          closedAt: { gte: params.periodStart, lte: params.periodEnd },
          id: { notIn: excludeTaskIds },
        },
        select: { id: true, checklist: true },
      });

      if (closedTasks.length === 0) {
        throw new BadRequestException(
          'No un-invoiced closed tasks found for this customer in the given period',
        );
      }

      const priceList = await tx.priceListItem.findMany({
        where: { tenantId, isActive: true },
        select: { code: true, description: true, price: true },
      });
      const priceByCode = new Map(priceList.map((p) => [p.code, p]));

      const lineItems: PendingLineItem[] = [];
      for (const task of closedTasks) {
        const checklist = (task.checklist as unknown as ChecklistItem[] | null) ?? [];
        for (const item of checklist) {
          if (!item.done || !item.priceCode) continue;
          const priceEntry = priceByCode.get(item.priceCode);
          // כבר הוזהר ב-validateClosedTask — לא נכשלים כאן, מדלגים.
          if (!priceEntry) continue;

          lineItems.push({
            taskId: task.id,
            priceCode: item.priceCode,
            description: priceEntry.description,
            // price מגיע כבר כ-Decimal מ-Prisma; העטיפה היא רק
            // כדי שהטיפוס יהיה מפורש ולא יישען על ההסקה.
            amount: new Prisma.Decimal(priceEntry.price),
          });
        }
      }

      if (lineItems.length === 0) {
        throw new BadRequestException(
          'Found closed tasks but no billable checklist items matched an active price list entry',
        );
      }

      // סכימה ב-Decimal. `reduce` על floats היה מייצר סך שונה
      // מ-SUM של השורות שנכתבו לצדו.
      const totalAmount = lineItems.reduce((sum, li) => sum.add(li.amount), new Prisma.Decimal(0));

      return { customerName: customer.name, tenantName: tenant.name, lineItems, totalAmount };
    });

    // --- שלב 2: כתיבה. טרנזקציה שנייה, קצרה, עם הקצאת מספר תחת נעילה. ---
    const invoice = await this.prisma.forTenant(tenantId, async (tx) => {
      const invoiceNumber = await this.allocateInvoiceNumber(tx, tenantId);

      const created = await tx.invoice.create({
        data: {
          tenantId,
          customerId: params.customerId,
          invoiceNumber,
          periodStart: params.periodStart,
          periodEnd: params.periodEnd,
          totalAmount: prepared.totalAmount,
          status: 'DRAFT',
        },
      });

      try {
        // createMany ולא יצירה אחת-אחת: כך ה-P2002 מפיל את *כל*
        // הטרנזקציה, ולא משאיר חשבונית עם חלק מהשורות.
        await tx.invoiceLineItem.createMany({
          data: prepared.lineItems.map((li) => ({ invoiceId: created.id, ...li })),
        });
      } catch (err: unknown) {
        if (isUniqueViolation(err)) {
          // @@unique([taskId, priceCode]) — מישהו חייב את אותה שורת
          // עבודה בין שלב הקריאה לשלב הכתיבה. זה בדיוק ה-race שהבדיקה
          // הישנה לא תפסה. rollback ו-409, לא חיוב כפול.
          throw new ConflictException(
            'One or more work items were already billed by a concurrent invoice run. ' +
              'No invoice was created; retry to bill only what remains.',
          );
        }
        throw err;
      }

      return created;
    });

    // --- שלב 3: PDF + Drive. מחוץ לכל טרנזקציה בכוונה. ---
    // אם ההעלאה נכשלת נשארת חשבונית DRAFT תקינה ב-DB שאפשר לייצא
    // אליה PDF שוב, במקום לאבד את כל העבודה.
    try {
      const pdfBuffer = await generateInvoicePdf({
        tenantName: prepared.tenantName,
        customerName: prepared.customerName,
        invoiceNumber: invoice.invoiceNumber,
        invoiceId: invoice.id,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        lineItems: prepared.lineItems,
        totalAmount: prepared.totalAmount,
      });

      const drive = await this.integrations.getConnector(tenantId, 'DRIVE');
      const uploaded = await drive.send<{ fileId: string }>('file', {
        name: `invoice-${invoice.invoiceNumber}-${prepared.customerName}.pdf`,
        mimeType: 'application/pdf',
        content: pdfBuffer,
      });

      return this.prisma.forTenant(tenantId, (tx) =>
        tx.invoice.update({
          where: { id: invoice.id },
          data: { status: 'FINALIZED', finalizedAt: new Date(), pdfDriveFileId: uploaded.fileId },
          include: { lineItems: true },
        }),
      );
    } catch (err: unknown) {
      this.logger.error(
        { err, tenantId, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
        'Invoice created but PDF/Drive upload failed - invoice remains in DRAFT. ' +
          'Likely cause: Drive not connected for this tenant, token refresh failed, or missing Hebrew font asset.',
      );
      return this.prisma.forTenant(tenantId, (tx) =>
        tx.invoice.findFirstOrThrow({
          where: { id: invoice.id, tenantId },
          include: { lineItems: true },
        }),
      );
    }
  }

  /**
   * מקצה את המספר הרץ הבא לטננט.
   *
   * `pg_advisory_xact_lock` ולא `SELECT ... FOR UPDATE`: אין שורה
   * לנעול כשמדובר בחשבונית *הראשונה* של הטננט, ו-`MAX()` על טבלה
   * ריקה לא נועל כלום. הנעילה הייעודית מסדרת את המקצים בטור ומשוחררת
   * אוטומטית ב-COMMIT/ROLLBACK, כך שהיא לא יכולה לדלוף.
   *
   * התוצאה: אין כפילויות (ה-`@@unique([tenantId, invoiceNumber])`
   * ממילא היה חוסם) וגם אין דילוגים — דילוג בסדרת מספרי חשבונית הוא
   * ממצא בביקורת חשבונאית, לא אי-נוחות.
   */
  private async allocateInvoiceNumber(tx: TenantClient, tenantId: string): Promise<number> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${tenantLockKey(tenantId)}::bigint)`;

    const rows = await tx.$queryRaw<Array<{ next: bigint }>>`
      SELECT COALESCE(MAX("invoiceNumber"), 0) + 1 AS next
      FROM invoices
      WHERE "tenantId" = ${tenantId}::uuid
    `;

    const next = rows[0]?.next;
    if (next === undefined) {
      throw new Error('Failed to allocate an invoice number');
    }
    return Number(next);
  }

  findAll(tenantId: string, customerId?: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.invoice.findMany({
        where: { tenantId, ...(customerId ? { customerId } : {}) },
        include: { lineItems: true, customer: true },
        orderBy: { invoiceNumber: 'desc' },
      }),
    );
  }

  async findOne(tenantId: string, id: string) {
    const invoice = await this.prisma.forTenant(tenantId, (tx) =>
      tx.invoice.findFirst({
        where: { id, tenantId },
        include: { lineItems: true, customer: true },
      }),
    );
    // בלי זה, חשבונית של טננט אחר חוזרת כ-null ונראית בדיוק כמו
    // "לא קיימת" — ראו docs/20-backend-conventions.md §1.1.
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
}
