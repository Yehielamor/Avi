import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import type { Task } from '@prisma/client';

import { PrismaService, type TenantClient } from '../../database/prisma.service';

// ============================================================
// זהו ה-Intake module + ליבת ה-Task lifecycle (מסמך הארכיטקטורה,
// סעיפים 5+6.1). שני מסלולי היצירה (מייל/ידני) מובילים לאותה
// createManual/createFromEmail -> אותה טבלת Task.
//
// כל גישה ל-DB כאן עוברת דרך prisma.forTenant() — הלקוח הגלוי
// זורק בלי קונטקסט טננט (docs/20-backend-conventions.md §1).
// ============================================================

const DEFAULT_PAGE_SIZE = 50;

export interface ChecklistItemInput {
  label: string;
  done: boolean;
  priceCode?: string;
  sku?: string;
  qty?: number;
}

export interface CloseTaskResult {
  taskId: string;
  status: typeof TaskStatus.CLOSED;
  /** true = המשימה כבר הייתה סגורה; לא נכתב אירוע שני ולא נפלט אחד. */
  alreadyClosed: boolean;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------------------
  // קריאה
  // ---------------------------------------------------------------------------

  /**
   * עימוד keyset: `cursor` הוא ה-id של השורה האחרונה בעמוד הקודם.
   * הגרסה הקודמת החזירה findMany ללא take — עם include לשני יחסים —
   * וברשימה של 100k משימות זה היה OOM ודאי.
   */
  async findAll(
    tenantId: string,
    filters: {
      status?: TaskStatus;
      take?: number;
      cursor?: string;
      assignedToMe?: boolean;
      urgentFirst?: boolean;
    } = {},
    /**
     * מזהה המשתמש המחובר, מהטוקן.
     *
     * `assignedToMe` הוא boolean ולא מזהה, וזו הנקודה: הזהות נקבעת
     * כאן מהטוקן ואינה ניתנת להצהרה ע"י הלקוח. אחרת כל טכנאי היה
     * יכול לשלוף את התור של עמיתו.
     */
    actorUserId?: string,
  ): Promise<{ items: Task[]; nextCursor: string | null }> {
    const take = filters.take ?? DEFAULT_PAGE_SIZE;

    if (filters.assignedToMe && !actorUserId) {
      throw new BadRequestException('assignedToMe requires an authenticated user');
    }

    const items = await this.prisma.forTenant(tenantId, (tx) =>
      tx.task.findMany({
        where: {
          tenantId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.assignedToMe ? { assignedToUserId: actorUserId } : {}),
        },
        include: { customer: true, assignedTo: true },
        // priority עולה = דחוף קודם (1=דחוף). המיון נעשה ב-DB ולא
        // בקליינט, אחרת הוא נכון רק בתוך העמוד שנשלף.
        orderBy: filters.urgentFirst
          ? [{ priority: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      }),
    );

    // עמוד מלא בדיוק עדיין יכול להיות האחרון — הקליינט מגלה זאת
    // בעמוד הבא הריק. עדיף מלשלוף take+1 שורות עם include.
    const nextCursor = items.length === take ? (items[items.length - 1]?.id ?? null) : null;
    return { items, nextCursor };
  }

  /**
   * משימה אחת, עם כל מה שמסך הפרטים צריך.
   *
   * זורק 404 ולא מחזיר null: נתיב `GET /tasks/:id` תמיד רוצה 404,
   * ו-null שחוזר עד ה-controller הוא איך שמתקבל 200 עם גוף ריק.
   *
   * ה-tenantId ב-where מיותר טכנית (ה-RLS חוסם ממילא) אבל נשאר
   * בכוונה — הוא הופך שורה של טננט אחר ל-404 מדויק במקום ל-null
   * מסתורי, ומשאיר את הכוונה גלויה לקורא הבא.
   */
  async findOne(tenantId: string, taskId: string) {
    const task = await this.prisma.forTenant(tenantId, (tx) =>
      tx.task.findFirst({
        where: { id: taskId, tenantId },
        include: {
          customer: true,
          assignedTo: { select: { id: true, name: true, role: true } },
          jobTypeTemplate: { select: { id: true, name: true, requiredSkill: true } },
        },
      }),
    );

    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  // ---------------------------------------------------------------------------
  // יצירה
  // ---------------------------------------------------------------------------

  // עוזר משותף לשני מסלולי היצירה - שולף checklist/priority ברירת מחדל
  // מהתבנית אם יש התאמה. רץ עם ה-tx של הקורא כדי שהקריאה והיצירה
  // יהיו באותה טרנזקציה (ובאותו קונטקסט טננט).
  private async resolveTemplateDefaults(
    tx: TenantClient,
    tenantId: string,
    jobTypeTemplateId: string | null,
  ): Promise<{ checklist: Prisma.JsonValue | null; priority: number }> {
    if (!jobTypeTemplateId) return { checklist: null, priority: 2 };

    const template = await tx.jobTypeTemplate.findFirst({
      where: { id: jobTypeTemplateId, tenantId },
    });
    if (!template) throw new NotFoundException('JobTypeTemplate not found for this tenant');

    return { checklist: template.defaultChecklist, priority: template.defaultPriority };
  }

  /** Json אופציונלי: `undefined` = אל תיגע, `null` = DbNull מפורש. */
  private toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
    return value === null || value === undefined ? Prisma.DbNull : value;
  }

  // ---- מסלול ב': פתיחה ידנית (JobTypeTemplate) - ראו סעיף 6.1 ----
  async createManual(
    tenantId: string,
    params: {
      customerId: string;
      jobTypeTemplateId: string;
      title: string;
      description?: string;
      customFields?: Record<string, unknown>;
    },
    actorUserId?: string,
  ): Promise<Task> {
    const task = await this.prisma.forTenant(tenantId, async (tx) => {
      const { checklist, priority } = await this.resolveTemplateDefaults(
        tx,
        tenantId,
        params.jobTypeTemplateId,
      );

      // הלקוח מאומת מול הטננט במפורש: בלי זה FK על לקוח של טננט אחר
      // נופל כשגיאת DB אטומה במקום 404 ברור (§1.1).
      const customer = await tx.customer.findFirst({
        where: { id: params.customerId, tenantId },
        select: { id: true },
      });
      if (!customer) throw new NotFoundException('Customer not found for this tenant');

      const created = await tx.task.create({
        data: {
          tenantId,
          customerId: params.customerId,
          jobTypeTemplateId: params.jobTypeTemplateId,
          title: params.title,
          description: params.description,
          source: 'MANUAL',
          priority,
          checklist: this.toJsonInput(checklist),
          customFields: this.toJsonInput(params.customFields),
        },
      });

      await this.writeAudit(tx, {
        tenantId,
        userId: actorUserId,
        action: 'task.created',
        entityType: 'Task',
        entityId: created.id,
        metadata: { source: 'MANUAL', jobTypeTemplateId: params.jobTypeTemplateId },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          eventName: 'task.created',
          payload: { tenantId, taskId: created.id, source: 'MANUAL' },
        },
      });

      return created;
    });

    return task;
  }

  // ---- מסלול א': ממייל. jobTypeTemplateId/priority כאן מגיעים מה-
  // IntakeExtractionService (LLM) - null אם הביטחון נמוך מדי, ואז
  // המשימה נשארת "גולמית" לבדיקה ידנית (ראו intake-extraction.service.ts) ----
  async createFromEmail(
    tenantId: string,
    params: {
      customerId: string;
      title: string;
      description?: string;
      sourceEmailId: string;
      jobTypeTemplateId?: string | null;
      extractedFields?: Record<string, unknown>;
      priority?: number;
    },
  ): Promise<Task> {
    const task = await this.prisma.forTenant(tenantId, async (tx) => {
      const { checklist, priority: defaultPriority } = await this.resolveTemplateDefaults(
        tx,
        tenantId,
        params.jobTypeTemplateId ?? null,
      );

      const created = await tx.task.create({
        data: {
          tenantId,
          customerId: params.customerId,
          jobTypeTemplateId: params.jobTypeTemplateId ?? null,
          title: params.title,
          description: params.description,
          source: 'EMAIL',
          sourceEmailId: params.sourceEmailId,
          priority: params.priority ?? defaultPriority,
          checklist: this.toJsonInput(checklist),
          customFields: this.toJsonInput(params.extractedFields),
        },
      });

      await this.writeAudit(tx, {
        tenantId,
        action: 'task.created',
        entityType: 'Task',
        entityId: created.id,
        metadata: { source: 'EMAIL', sourceEmailId: params.sourceEmailId },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          eventName: 'task.created',
          payload: { tenantId, taskId: created.id, source: 'EMAIL' },
        },
      });

      return created;
    });

    return task;
  }

  // ---------------------------------------------------------------------------
  // סגירה — הטריגר לכל שאר המודולים (6א/6ב/6ג במסמך הארכיטקטורה)
  // ---------------------------------------------------------------------------

  /**
   * שני באגים תוקנו כאן בבת אחת:
   *
   *   • `where: { id: taskId }` ללא tenantId אפשר לתוקף עם טננט משלו
   *     לסגור — ולקרוא בתשובה את השורה המלאה של — כל משימה בכל טננט.
   *
   *   • `update` על משימה סגורה הצליח שוב ופלט 'task.closed' פעם
   *     נוספת: ניכוי מלאי כפול, שורת חשבונית כפולה, מייל ללקוח פעמיים.
   *
   * `updateMany` עם `status: { not: CLOSED }` פותר את שניהם: התנאי
   * נבדק ונכתב באותה שאילתה אטומית, ו-count=0 אומר "כבר סגורה".
   */
  async close(
    tenantId: string,
    taskId: string,
    finalChecklist?: ChecklistItemInput[],
    actorUserId?: string,
  ): Promise<CloseTaskResult> {
    const result = await this.prisma.forTenant(tenantId, async (tx) => {
      const { count } = await tx.task.updateMany({
        where: { id: taskId, tenantId, status: { not: TaskStatus.CLOSED } },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: new Date(),
          ...(finalChecklist !== undefined
            ? { checklist: finalChecklist as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });

      if (count === 0) {
        // מבדילים בין "כבר סגורה" (200 אידמפוטנטי) לבין "לא קיימת
        // בטננט הזה" (404). שים לב שגם משימה של טננט אחר נופלת לענף
        // ה-404 — היא פשוט אינה נראית מכאן.
        const exists = await tx.task.findFirst({
          where: { id: taskId, tenantId },
          select: { id: true },
        });
        if (!exists) throw new NotFoundException('Task not found');
        return { alreadyClosed: true };
      }

      await this.writeAudit(tx, {
        tenantId,
        userId: actorUserId,
        action: 'task.closed',
        entityType: 'Task',
        entityId: taskId,
        metadata: { checklistItems: finalChecklist?.length ?? 0 },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          eventName: 'task.closed',
          payload: { tenantId, taskId },
        },
      });

      return { alreadyClosed: false };
    });

    if (!result.alreadyClosed) {
    }

    return { taskId, status: TaskStatus.CLOSED, alreadyClosed: result.alreadyClosed };
  }

  // ---------------------------------------------------------------------------
  // עזר
  // ---------------------------------------------------------------------------

  private writeAudit(
    tx: TenantClient,
    entry: {
      tenantId: string;
      userId?: string;
      action: string;
      entityType: string;
      entityId: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<unknown> {
    return tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: this.toJsonInput(entry.metadata),
      },
    });
  }

}
