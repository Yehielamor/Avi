import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

import { PrismaService } from '../database/prisma.service';
import { DomainEventJob, JOB, QUEUE, RETRY_POLICY } from './queue.constants';

/**
 * מפרסם את ה-outbox: קורא אירועים שממתינים ב-DB ודוחף אותם לתור.
 *
 * למה בכלל outbox ולא דחיפה ישירה לתור:
 *
 *   כתיבה ל-DB ודחיפה ל-Redis הן שתי מערכות. אם המשימה נסגרת ואז
 *   הדחיפה נכשלת — המלאי לא ינוכה והלקוח לא יקבל מייל, לנצח. אם
 *   דוחפים קודם והטרנזקציה מתגלגלת אחורה — נשלח מייל על משימה שלא
 *   נסגרה.
 *
 *   האירוע נכתב *באותה טרנזקציה* שמשנה את המצב העסקי, ולכן או ששניהם
 *   קורים או שאף אחד. הפרסום קורה אחרי ה-commit, ואם הוא נכשל —
 *   הסריקה הבאה תרים את השורה שוב.
 *
 *   המשמעות: הבטחת **at-least-once**. צרכן חייב להיות אידמפוטנטי,
 *   וזו הסיבה לאילוצי הייחודיות ב-schema.prisma.
 */
@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  /** תדירות הסריקה. מספיק תכוף כדי שירגיש מיידי, דליל כדי לא להעיק. */
  private static readonly POLL_MS = 2_000;
  private static readonly BATCH = 50;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE.DOMAIN_EVENTS) private readonly queue: Queue<DomainEventJob>,
  ) {}

  onModuleInit(): void {
    this.schedule();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, OutboxPublisher.POLL_MS);
  }

  private async tick(): Promise<void> {
    // סריקה אחת בכל רגע נתון בתוך המופע הזה. בין מופעים, ה-
    // FOR UPDATE SKIP LOCKED מטפל.
    if (this.running) return;
    this.running = true;
    try {
      await this.publishBatch();
    } catch (err) {
      this.logger.error({ err }, 'Outbox poll failed');
    } finally {
      this.running = false;
    }
  }

  /**
   * שולף אצווה ומסמן אותה PROCESSING באותה טרנזקציה.
   *
   * `FOR UPDATE SKIP LOCKED` הוא מה שמאפשר להריץ כמה מופעים של
   * האפליקציה: כל אחד תופס שורות אחרות במקום להיחסם או לעבד כפול.
   *
   * הקריאה עוברת דרך `claim_outbox_batch` ולא דרך Prisma ישירות.
   *
   * הסיבה: הפרסום חוצה טננטים מעצם טבעו — אין קונטקסט יחיד לבחור —
   * ולכן `current_tenant_id()` זורק וה-RLS חוסם. זה ה-RLS עובד נכון.
   *
   * הפונקציה היא SECURITY DEFINER צרה (מיגרציה 0004): היא יודעת רק
   * לתפוס אצווה מ-outbox_events, ולא יכולה לקרוא לקוחות או משימות.
   * החלופה — תפקיד BYPASSRLS — הייתה פותחת את כל הטבלאות לקוד שצריך
   * טבלה אחת.
   *
   * ה-tenantId של כל שורה נישא ב-job, והצרכן מחיל אותו דרך forTenant.
   */
  private async publishBatch(): Promise<void> {
    const claimed = await this.prisma.untenanted.$queryRaw<
      Array<{ id: string; tenant_id: string; event_name: string; payload: unknown; attempts: number }>
    >`SELECT * FROM public.claim_outbox_batch(${OutboxPublisher.BATCH}::int)`;

    if (claimed.length === 0) return;

    for (const row of claimed) {
      try {
        await this.queue.add(
          JOB.HANDLE_EVENT,
          {
            outboxEventId: row.id,
            tenantId: row.tenant_id,
            eventName: row.event_name,
            payload: row.payload,
          },
          {
            ...RETRY_POLICY,
            // מזהה קבוע לכל שורת outbox: אם הפרסום רץ פעמיים (נפילה
            // בין ה-UPDATE לדחיפה), BullMQ מתעלם מהכפילות.
            // מקף ולא נקודתיים — BullMQ דוחה ':' במזהה עבודה.
            jobId: `outbox-${row.id}`,
          },
        );
      } catch (err) {
        // הדחיפה נכשלה — מחזירים ל-PENDING כדי שהסריקה הבאה תנסה שוב.
        this.logger.error({ err, outboxEventId: row.id }, 'Failed to enqueue outbox event');
        await this.prisma.untenanted
          .$executeRaw`SELECT public.settle_outbox_event(${row.id}::uuid, 'PENDING', NULL, NULL, interval '10 seconds')`;
      }
    }

    this.logger.debug(`Published ${claimed.length} outbox event(s)`);
  }
}
