import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { AlertService } from '../alerting/alert.service';
import { PrismaService } from '../database/prisma.service';
import { CommsService } from '../modules/comms/comms.service';
import { InventoryService } from '../modules/inventory/inventory.service';
import { InvoicingService } from '../modules/invoicing/invoicing.service';
import { SchedulingService } from '../modules/scheduling/scheduling.service';
import { DomainEventJob, EVENT, QUEUE } from './queue.constants';

/**
 * צורך אירועים עסקיים.
 *
 * זה מה שמחליף את מאזיני `@OnEvent`. שם, `EventEmitter2.emit()` לא
 * ממתין ולא תופס, ולכן מאזין `async` שנדחה הפך ל-unhandled rejection
 * ו-Node סיים את התהליך — **לכל הטננטים**, אחרי שה-200 כבר נשלח
 * ללקוח. תקלת DB אחת בסגירת משימה אחת הפילה את ה-API כולו.
 * ראו docs/10-audit-findings.md#C8.
 *
 * כאן כישלון הוא רק כישלון של עבודה: BullMQ מנסה שוב עם backoff,
 * ואחרי המכסה השורה מסומנת DEAD.
 *
 * העיבוד הוא **at-least-once**, ולכן כל handler חייב להיות אידמפוטנטי.
 * זה נאכף ב-DB, לא בתקווה: `@@unique([taskId, inventoryItemId, reason])`
 * על StockMovement, `@@unique([taskId, priceCode])` על InvoiceLineItem.
 */
/** הצורה המשותפת לאירועי משימה. */
const taskEventSchema = z.object({
  taskId: z.string().uuid(),
  source: z.string().optional(),
});

@Processor(QUEUE.DOMAIN_EVENTS, { concurrency: 5 })
export class DomainEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(DomainEventsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertService,
    private readonly scheduling: SchedulingService,
    private readonly inventory: InventoryService,
    private readonly invoicing: InvoicingService,
    private readonly comms: CommsService,
  ) {
    super();
  }

  async process(job: Job<DomainEventJob>): Promise<void> {
    const { outboxEventId, tenantId, eventName, payload } = job.data;

    this.logger.debug({ eventName, tenantId, attempt: job.attemptsMade + 1 }, 'Handling event');

    try {
      await this.dispatch(eventName, tenantId, payload);
      await this.markDone(outboxEventId);
    } catch (err) {
      await this.recordFailure(outboxEventId, job, err);
      // נזרק מחדש כדי ש-BullMQ יתזמן ניסיון חוזר. בליעה כאן הייתה
      // מסמנת הצלחה על עבודה שלא בוצעה.
      throw err;
    }
  }

  /**
   * ניתוב אירוע ל-handlers שלו.
   *
   * כל handler רץ בנפרד ובאופן עצמאי: כישלון של אחד לא מונע מהאחרים
   * לרוץ. `allSettled` ולא `all` — אם ניכוי המלאי נכשל, הלקוח עדיין
   * צריך לקבל את המייל.
   */
  private async dispatch(eventName: string, tenantId: string, payload: unknown): Promise<void> {
    const handlers = this.handlersFor(eventName, tenantId, payload);

    if (handlers.length === 0) {
      // אירוע ללא צרכן הוא כמעט תמיד שם שגוי או handler שנשכח.
      this.logger.warn({ eventName }, 'No handler registered for event');
      return;
    }

    const results = await Promise.allSettled(handlers.map((h) => h.run()));

    const failures = results
      .map((r, i) => ({ r, name: handlers[i]!.name }))
      .filter((x): x is { r: PromiseRejectedResult; name: string } => x.r.status === 'rejected');

    for (const f of failures) {
      this.logger.error({ err: f.r.reason, handler: f.name, eventName }, 'Handler failed');
    }

    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((f) => f.r.reason),
        `${failures.length} handler(s) failed for ${eventName}: ${failures.map((f) => f.name).join(', ')}`,
      );
    }
  }

  private handlersFor(
    eventName: string,
    tenantId: string,
    payload: unknown,
  ): Array<{ name: string; run: () => Promise<unknown> }> {
    switch (eventName) {
      case EVENT.TASK_CREATED: {
        // ה-payload הגיע כ-JSON מעמודת DB, ולכן הוא `unknown` אמיתי —
        // לא משהו שמותר להצהיר עליו ב-cast. אירוע ישן מגרסה קודמת של
        // הסכימה ייכשל כאן בבירור, ולא שלוש שכבות למטה.
        const p = taskEventSchema.parse(payload);
        const args = { tenantId, taskId: p.taskId, source: p.source ?? 'MANUAL' };
        return [
          { name: 'scheduling.assign', run: () => this.scheduling.handleTaskCreated(args) },
          { name: 'comms.taskCreated', run: () => this.comms.handleTaskCreated(args) },
        ];
      }

      case EVENT.TASK_CLOSED: {
        const p = taskEventSchema.parse(payload);
        const args = { tenantId, taskId: p.taskId };
        return [
          { name: 'inventory.consume', run: () => this.inventory.handleTaskClosed(args) },
          { name: 'invoicing.validate', run: () => this.invoicing.validateClosedTask(args) },
          { name: 'comms.taskClosed', run: () => this.comms.handleTaskClosed(args) },
        ];
      }

      // אירועים שנרשמים לצורך עקבות בלבד, ואין להם עדיין תגובה
      // אוטומטית. מנויים כאן במפורש כדי שלא יפלו לאזהרת
      // "אין handler" ויסתירו טעות אמיתית.
      case EVENT.TASK_ASSIGNED:
      case EVENT.USER_INVITED:
      case EVENT.INVENTORY_LOW_STOCK:
        return [{ name: 'noop', run: () => Promise.resolve() }];

      default:
        return [];
    }
  }

  private async markDone(outboxEventId: string): Promise<void> {
    // דרך הפונקציה ולא דרך Prisma: השורה שייכת לטננט כלשהו, ולעובד
    // אין קונטקסט. ראו ההסבר ב-outbox.publisher.ts.
    await this.prisma.untenanted
      .$executeRaw`SELECT public.settle_outbox_event(${outboxEventId}::uuid, 'DONE', NULL, NULL, NULL)`;
  }

  /**
   * רושם כישלון. אחרי הניסיון האחרון השורה מסומנת DEAD — מצב שדורש
   * התראה תפעולית, כי משמעותו פעולה עסקית שלא התרחשה ולא תתרחש.
   */
  private async recordFailure(outboxEventId: string, job: Job, err: unknown): Promise<void> {
    const attempts = job.attemptsMade + 1;
    const exhausted = attempts >= (job.opts.attempts ?? 1);
    const message = err instanceof Error ? err.message : String(err);

    await this.prisma.untenanted.$executeRaw`
      SELECT public.settle_outbox_event(
        ${outboxEventId}::uuid,
        ${exhausted ? 'DEAD' : 'PROCESSING'},
        ${attempts}::int,
        ${message.slice(0, 1_000)},
        NULL
      )`;

    if (exhausted) {
      // DEAD אינו "שגיאה שנרשמה". זו פעולה עסקית שלא התרחשה ולא
      // תתרחש: מלאי שלא נוכה, חשבונית שלא נוצרה, לקוח שלא עודכן.
      // היא דורשת אדם, ולכן היא יוצאת מהלוג החוצה.
      await this.alerts.send({
        severity: 'critical',
        event: 'outbox.dead',
        summary: `Outbox event permanently failed after ${attempts} attempts — a business action did not happen`,
        context: { outboxEventId, attempts, error: message.slice(0, 300) },
      });
    }
  }
}
