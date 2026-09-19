import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PublicLinkPurpose, TaskStatus, UserRole } from '@prisma/client';

import { buildWaLink } from '../../common/phone.util';
import { PrismaService } from '../../database/prisma.service';
import { PublicLinkService } from '../public-links/public-link.service';

import { deriveCustomerStatus, firstName, formatVisit, type CustomerStatus } from './customer-status';

type Actor = { id: string; role: UserRole };
type Tx = Prisma.TransactionClient;

/** ביקור ארוך מזה הוא כמעט תמיד טעות הקלדה של יום או שעה. */
const MAX_VISIT_HOURS = 12;

export interface ShareResult {
  url: string;
  /** null כשלטלפון של הלקוח אין פורמט ישראלי תקין — הכפתור מוסתר. */
  waUrl: string | null;
  message: string;
}

export interface PublicTaskView {
  businessName: string;
  title: string;
  status: CustomerStatus;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  technicianFirstName: string | null;
  customerConfirmedAt: Date | null;
  rescheduleRequested: boolean;
  /** אפשר לאשר רק מועד שנקבע, לעבודה שעוד לא הסתיימה. */
  canConfirm: boolean;
  canRequestReschedule: boolean;
}

/**
 * סטטוס משימה ללקוח.
 *
 * צד העסק: שיתוף קישור, קביעת מועד, "בדרך". צד הלקוח: צפייה, אישור מועד,
 * בקשת מועד אחר. הלקוח לא מזוהה — הטוקן בקישור הוא ההרשאה היחידה, ולכן
 * הוא רואה ומשנה רק את מה שמופיע כאן, ולא דבר מעבר לזה.
 */
@Injectable()
export class TaskStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: PublicLinkService,
  ) {}

  // ---------------------------------------------------------------------------
  // צד העסק
  // ---------------------------------------------------------------------------

  async share(tenantId: string, taskId: string, actor: Actor): Promise<ShareResult> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const task = await this.findForActor(tx, tenantId, taskId, actor);
      const { url } = await this.links.create(tx, {
        tenantId,
        purpose: PublicLinkPurpose.TASK_STATUS,
        customerId: task.customerId,
        taskId,
      });
      await this.audit(tx, tenantId, actor.id, 'task.status_link_shared', taskId, {});

      // בלי שם הלקוח: לקוח יכול להיות עסק ("מסעדת ..."), ואין דרך אמינה
      // לדעת מתי המילה הראשונה היא שם פרטי.
      const when = task.scheduledStart ? ` הביקור נקבע ל${formatVisit(task.scheduledStart, task.scheduledEnd)}.` : '';
      const message = `שלום, כאן ${task.tenant.name}.${when} אפשר לראות את מצב העבודה ולאשר את המועד כאן: ${url}`;
      return { url, waUrl: buildWaLink(task.customer.phone, message), message };
    });
  }

  async schedule(
    tenantId: string,
    taskId: string,
    input: { scheduledStart: string; scheduledEnd?: string },
    actorId: string,
  ) {
    const start = new Date(input.scheduledStart);
    const end = input.scheduledEnd ? new Date(input.scheduledEnd) : null;
    if (end && end <= start) throw new BadRequestException('scheduledEnd must be after scheduledStart');
    if (end && end.getTime() - start.getTime() > MAX_VISIT_HOURS * 3_600_000) {
      throw new BadRequestException(`A visit cannot be longer than ${MAX_VISIT_HOURS} hours`);
    }

    return this.prisma.forTenant(tenantId, async (tx) => {
      // מועד חדש מבטל אישור קודם ובקשת שינוי: הלקוח אישר זמן אחר.
      const { count } = await tx.task.updateMany({
        where: { id: taskId, tenantId, status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED] } },
        data: {
          scheduledStart: start,
          scheduledEnd: end,
          customerConfirmedAt: null,
          rescheduleRequest: null,
          rescheduleRequestedAt: null,
          onTheWayAt: null,
        },
      });
      if (count === 0) {
        // משימה שהסתיימה היא 409, כמו ב-"בדרך" — לא 404 כאילו אינה קיימת
        // (QA 18.09, F18). רק משימה שבאמת לא נמצאה בטננט היא 404.
        const exists = await tx.task.findFirst({ where: { id: taskId, tenantId }, select: { id: true } });
        if (exists) throw new ConflictException('Task is already finished');
        throw new NotFoundException('Task not found');
      }
      await this.audit(tx, tenantId, actorId, 'task.scheduled', taskId, {
        scheduledStart: start.toISOString(),
        scheduledEnd: end?.toISOString() ?? null,
      });
      return { id: taskId, scheduledStart: start, scheduledEnd: end };
    });
  }

  async onTheWay(tenantId: string, taskId: string, actor: Actor): Promise<ShareResult & { onTheWayAt: Date }> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const task = await this.findForActor(tx, tenantId, taskId, actor);
      if (task.status === TaskStatus.CLOSED || task.status === TaskStatus.CANCELLED) {
        throw new ConflictException('Task is already finished');
      }
      const onTheWayAt = new Date();
      await tx.task.update({ where: { id: taskId }, data: { onTheWayAt } });

      // הקישור הקיים לא ניתן לשחזור (שמור רק ה-hash), אז "בדרך" יוצר חדש.
      const { url } = await this.links.create(tx, {
        tenantId,
        purpose: PublicLinkPurpose.TASK_STATUS,
        customerId: task.customerId,
        taskId,
      });
      await this.audit(tx, tenantId, actor.id, 'task.on_the_way', taskId, {});

      const tech = firstName(task.assignedTo?.name) ?? 'הטכנאי';
      const message = `שלום, ${tech} מ${task.tenant.name} בדרך אליך. פרטים: ${url}`;
      return { url, waUrl: buildWaLink(task.customer.phone, message), message, onTheWayAt };
    });
  }

  // ---------------------------------------------------------------------------
  // צד הלקוח — דרך טוקן בלבד
  // ---------------------------------------------------------------------------

  async view(token: string): Promise<PublicTaskView> {
    const { tenantId, link } = await this.links.resolve(token, PublicLinkPurpose.TASK_STATUS);
    return this.prisma.forTenant(tenantId, async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: link.taskId!, tenantId },
        select: {
          title: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          onTheWayAt: true,
          customerConfirmedAt: true,
          rescheduleRequest: true,
          assignedTo: { select: { name: true } },
          tenant: { select: { name: true } },
        },
      });
      if (!task) throw new NotFoundException('Link not found or expired');

      const status = deriveCustomerStatus(task);
      const open = status !== 'done' && status !== 'cancelled';
      return {
        businessName: task.tenant.name,
        title: task.title,
        status,
        scheduledStart: task.scheduledStart,
        scheduledEnd: task.scheduledEnd,
        technicianFirstName: firstName(task.assignedTo?.name),
        customerConfirmedAt: task.customerConfirmedAt,
        rescheduleRequested: task.rescheduleRequest !== null,
        canConfirm: open && task.scheduledStart !== null,
        canRequestReschedule: open,
      };
    });
  }

  async confirm(token: string): Promise<PublicTaskView> {
    const { tenantId, link } = await this.links.resolve(token, PublicLinkPurpose.TASK_STATUS);
    await this.prisma.forTenant(tenantId, async (tx) => {
      const confirmable = {
        id: link.taskId!,
        tenantId,
        scheduledStart: { not: null },
        status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED] },
      } satisfies Prisma.TaskWhereInput;
      // רק מועד שעוד לא אושר. לחיצה חוזרת לא דורסת את זמן האישור המקורי
      // ולא מוסיפה שורת audit — קודם כל לחיצה עשתה את שניהם (QA 18.09, F16).
      // מועד חדש או בקשת שינוי מאפסים את customerConfirmedAt, כך שאישור
      // מחדש אחריהם עדיין עובר כאן.
      const { count } = await tx.task.updateMany({
        where: { ...confirmable, customerConfirmedAt: null },
        data: { customerConfirmedAt: new Date(), rescheduleRequest: null, rescheduleRequestedAt: null },
      });
      if (count === 0) {
        const alreadyConfirmed = await tx.task.findFirst({
          where: { ...confirmable, customerConfirmedAt: { not: null } },
          select: { id: true },
        });
        if (alreadyConfirmed) return;
        throw new ConflictException('There is no visit time to confirm');
      }
      await this.audit(tx, tenantId, null, 'task.customer_confirmed', link.taskId!, { via: 'public_link' });
    });
    return this.view(token);
  }

  async requestReschedule(token: string, note: string): Promise<PublicTaskView> {
    const { tenantId, link } = await this.links.resolve(token, PublicLinkPurpose.TASK_STATUS);
    await this.prisma.forTenant(tenantId, async (tx) => {
      const { count } = await tx.task.updateMany({
        where: { id: link.taskId!, tenantId, status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED] } },
        data: { rescheduleRequest: note.trim(), rescheduleRequestedAt: new Date(), customerConfirmedAt: null },
      });
      if (count === 0) throw new ConflictException('This job is already finished');
      // התוכן לא נכנס ליומן: הוא טקסט חופשי מלקוח, ומקומו במשימה בלבד.
      await this.audit(tx, tenantId, null, 'task.customer_requested_reschedule', link.taskId!, { via: 'public_link' });
    });
    return this.view(token);
  }

  // ---------------------------------------------------------------------------

  /** טכנאי רואה רק משימה שהוקצתה לו — בתוך ה-WHERE, כדי ש"לא שלך" ו"לא קיים" ייראו אותו דבר. */
  private async findForActor(tx: Tx, tenantId: string, taskId: string, actor: Actor) {
    const task = await tx.task.findFirst({
      where: {
        id: taskId,
        tenantId,
        ...(actor.role === UserRole.FIELD && { assignedToUserId: actor.id }),
      },
      select: {
        id: true,
        status: true,
        customerId: true,
        scheduledStart: true,
        scheduledEnd: true,
        customer: { select: { name: true, phone: true } },
        assignedTo: { select: { name: true } },
        tenant: { select: { name: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  private audit(
    tx: Tx,
    tenantId: string,
    userId: string | null,
    action: string,
    taskId: string,
    metadata: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: { tenantId, userId, action, entityType: 'Task', entityId: taskId, metadata: metadata as Prisma.InputJsonValue },
    });
  }
}
