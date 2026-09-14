import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { PrismaService } from '../database/prisma.service';
import { EmailIntakeService } from '../modules/intake/email-intake.service';
import { JOB, QUEUE, SyncGmailJob } from './queue.constants';

/**
 * מריץ סנכרון Gmail לכל טננט מחובר.
 *
 * זה החלק שהיה חסר לגמרי. ה-README הבטיח ש"הסנכרון ירוץ ב-cron כל
 * 2-5 דקות", אבל **לא היה scheduler מותקן בכלל** — הקליטה קרתה רק
 * כשאדם הריץ curl ידנית. לולאת מייל→משימה, שעליה כל המוצר נשען,
 * לא הייתה מאוטומטת. ראו docs/10-audit-findings.md#C10.
 */
@Injectable()
export class IntakeScheduler implements OnModuleInit {
  private readonly logger = new Logger(IntakeScheduler.name);

  /**
   * כל 3 דקות. מספיק תכוף כדי שלקוח לא ימתין, דליל מספיק כדי לא
   * לשרוף מכסות Gmail על תיבות שקטות.
   */
  private static readonly CRON = '*/3 * * * *';

  constructor(@InjectQueue(QUEUE.INTAKE) private readonly queue: Queue<SyncGmailJob>) {}

  async onModuleInit(): Promise<void> {
    // job חוזר עם מזהה קבוע: כמה מופעים של האפליקציה לא מייצרים
    // כמה תזמונים, ו-BullMQ מבטיח שרק אחד ירוץ בכל מחזור.
    await this.queue.add(
      JOB.SYNC_GMAIL,
      { tenantId: '' }, // ה-fan-out קורה בתוך ה-processor
      {
        repeat: { pattern: IntakeScheduler.CRON },
        jobId: 'intake-gmail-fanout',
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    );
    this.logger.log(`Gmail intake scheduled (${IntakeScheduler.CRON})`);
  }
}

/**
 * מעבד הסנכרון.
 *
 * concurrency 2: הקריאות ל-Google ול-Anthropic הן איטיות ומוגבלות
 * בקצב. הרצה מקבילה רחבה תגרום ל-429 ולא תזרז דבר.
 */
@Processor(QUEUE.INTAKE, { concurrency: 2 })
export class IntakeProcessor extends WorkerHost {
  private readonly logger = new Logger(IntakeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailIntake: EmailIntakeService,
    @InjectQueue(QUEUE.INTAKE) private readonly queue: Queue<SyncGmailJob>,
  ) {
    super();
  }

  async process(job: Job<SyncGmailJob>): Promise<unknown> {
    // ה-job החוזר הוא fan-out בלבד: הוא מוצא את הטננטים ומתזמן
    // עבודה נפרדת לכל אחד. כך טננט שנכשל לא מונע מהאחרים לרוץ,
    // ולכל אחד יש ניסיונות חוזרים משלו.
    if (!job.data.tenantId) {
      return this.fanOut();
    }
    return this.syncOne(job.data.tenantId);
  }

  private async fanOut(): Promise<{ scheduled: number }> {
    // חוצה טננטים מעצם טבעו — אין קונטקסט יחיד לבחור, ולכן דרך
    // פונקציית SECURITY DEFINER צרה שמחזירה מזהים בלבד ולא טוקנים.
    // הטוקנים נקראים אחר כך בתוך forTenant של אותו טננט.
    const rows = await this.prisma.untenanted.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT * FROM public.list_intake_tenants('GMAIL')
    `;

    for (const { tenant_id: tenantId } of rows) {
      await this.queue.add(
        JOB.SYNC_GMAIL,
        { tenantId },
        {
          // מזהה לפי חלון זמן: שני fan-out חופפים לא מייצרים שתי
          // הרצות לאותו טננט — וזו בדיוק התבנית שיצרה משימות כפולות
          // מאותו מייל.
          // מקף ולא נקודתיים — BullMQ דוחה ':' במזהה עבודה.
          jobId: `intake-gmail-${tenantId}-${Math.floor(Date.now() / 60_000)}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { age: 3_600 },
          removeOnFail: { age: 24 * 3_600 },
        },
      );
    }

    if (rows.length > 0) {
      this.logger.debug(`Scheduled Gmail sync for ${rows.length} tenant(s)`);
    }
    return { scheduled: rows.length };
  }

  private async syncOne(tenantId: string): Promise<unknown> {
    const result = await this.emailIntake.syncGmail(tenantId);
    this.logger.log({ tenantId, result }, 'Gmail sync complete');
    return result;
  }
}
