import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { renderTemplate } from './template-renderer.util';
import { normalizeRecipientAddress } from './email-address.util';

interface ChecklistItem {
  label: string;
  done: boolean;
  priceCode?: string;
}

type TemplateKey = 'taskCreated' | 'taskClosed';

export interface SendResult {
  sent: boolean;
  reason?: string;
}

interface EmailDraft {
  to: string;
  subject: string;
  body: string;
}

// ============================================================
// Customer Comms Agent (מסמך הארכיטקטורה, סעיף 6.5 + טבלה 5.1 שורה 6א).
//
// שני triggers, שני template keys מ-TenantConfig.emailTemplates
// (ראו seed.ts):
// - task.created (רק source=EMAIL) -> "taskCreated": אישור קבלת פנייה.
// - task.closed (תמיד) -> "taskClosed": סיכום מה שבוצע, מתוך ה-checklist.
//
// שלוש נקודות שהיו באגים ותוקנו כאן — אל תחזירו אותן:
//
// 1. קריאת המשימה הייתה `findUnique({ where: { id: taskId } })` בלי
//    tenantId. `POST /comms/tasks/:id/resend-closed-email` עם מזהה
//    משימה של טננט אחר רינדר את הכותרת וה-checklist שלו לתוך מייל
//    ושלח אותו דרך קונקטור ה-Gmail של *התוקף* — הנתונים של הקורבן
//    נחתו בתיקיית ה-Sent שלו. עכשיו: forTenant + where מפורש + 404.
//
// 2. כתובת הנמען עוברת normalizeRecipientAddress לפני שהיא נוגעת
//    בכותרת `To:` (ראו email-address.util.ts).
//
// 3. הקריאות ל-Google רצות *מחוץ* ל-forTenant. טרנזקציה מחזיקה
//    חיבור DB, ושליחת מייל היא קריאת רשת שיכולה להימשך שניות.
//
// כשל שליחה (Gmail לא מחובר, טוקן פג) לא זורק — מתועד ומוחזר כתוצאה
// שלילית, כדי לא להפיל listeners אחרים על אותו אירוע.
// ============================================================

@Injectable()
export class CommsService {
  private readonly logger = new Logger(CommsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Event handlers
  //
  // EventEmitter2.emit() לא ממתין ולא תופס: דחייה במאזין async היא
  // unhandled rejection שמפילה את התהליך לכל הטננטים, אחרי שה-200
  // כבר נשלח. עד שה-outbox יחליף את ה-emit הישיר (סעיף 7 בקונבנציות),
  // כל גוף מאזין עטוף ואינו זורק החוצה לעולם.
  // ---------------------------------------------------------------------------

  @OnEvent('task.created')
  async handleTaskCreated(payload: { tenantId: string; taskId: string; source: string }): Promise<void> {
    try {
      if (payload.source !== 'EMAIL') return;
      const result = await this.sendTemplateEmail(payload.tenantId, payload.taskId, 'taskCreated');
      if (!result.sent) {
        this.logger.warn(`taskCreated email not sent for task ${payload.taskId}: ${result.reason}`);
      }
    } catch (err) {
      this.logger.error(
        `task.created handler failed for task ${payload.taskId} (tenant ${payload.tenantId}): ${describeError(err)}`,
      );
    }
  }

  @OnEvent('task.closed')
  async handleTaskClosed(payload: { tenantId: string; taskId: string }): Promise<void> {
    try {
      const result = await this.sendTemplateEmail(payload.tenantId, payload.taskId, 'taskClosed');
      if (!result.sent) {
        this.logger.warn(`taskClosed email not sent for task ${payload.taskId}: ${result.reason}`);
      }
    } catch (err) {
      this.logger.error(
        `task.closed handler failed for task ${payload.taskId} (tenant ${payload.tenantId}): ${describeError(err)}`,
      );
    }
  }

  /**
   * "שלח שוב" ידני. אותה לוגיקה בדיוק כמו המסלול האוטומטי — כולל
   * סינון לפי tenantId, ולכן מזהה משימה של טננט אחר מחזיר 404.
   */
  async resendClosedEmail(tenantId: string, taskId: string): Promise<SendResult> {
    return this.sendTemplateEmail(tenantId, taskId, 'taskClosed');
  }

  private async sendTemplateEmail(
    tenantId: string,
    taskId: string,
    templateKey: TemplateKey,
  ): Promise<SendResult> {
    const draft = await this.buildDraft(tenantId, taskId, templateKey);
    if ('reason' in draft) return { sent: false, reason: draft.reason };

    try {
      const gmail = await this.integrations.getConnector(tenantId, 'GMAIL');
      await gmail.ensureAuthenticated();
      await gmail.send('message', draft);
      return { sent: true };
    } catch (err) {
      this.logger.error(
        `Failed to send "${templateKey}" email for task ${taskId} (tenant ${tenantId}): ${describeError(err)}`,
      );
      return { sent: false, reason: 'send failed - see server logs (likely Gmail not connected for this tenant)' };
    }
  }

  /** כל הגישה ל-DB במקום אחד, בטרנזקציה אחת, בלי שום קריאת רשת בפנים. */
  private async buildDraft(
    tenantId: string,
    taskId: string,
    templateKey: TemplateKey,
  ): Promise<EmailDraft | { reason: string }> {
    const { task, emailTemplates } = await this.prisma.forTenant(tenantId, async (tx) => {
      const found = await tx.task.findFirst({
        where: { id: taskId, tenantId },
        select: {
          title: true,
          checklist: true,
          customer: { select: { name: true, email: true } },
        },
      });
      // ה-RLS כבר מונע את הדליפה; ה-tenantId המפורש הוא מה שהופך את
      // התוצאה ל-404 ברור במקום null מסתורי (קונבנציות, סעיף 1.1).
      if (!found) throw new NotFoundException('Task not found');

      const config = await tx.tenantConfig.findUnique({
        where: { tenantId },
        select: { emailTemplates: true },
      });
      return { task: found, emailTemplates: config?.emailTemplates };
    });

    const to = normalizeRecipientAddress(task.customer.email);
    if (!to) {
      return {
        reason: task.customer.email
          ? 'customer email address is not a single valid address - refusing to build an outgoing header from it'
          : 'customer has no email address on file',
      };
    }

    const templates = isRecord(emailTemplates) ? emailTemplates : {};
    const candidate = templates[templateKey];
    const template = typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
    if (!template) {
      return { reason: `no "${templateKey}" template configured in TenantConfig.emailTemplates` };
    }

    const checklistSummary =
      toChecklist(task.checklist)
        .filter((item) => item.done)
        .map((item) => item.label)
        .join(', ') || 'ללא פירוט זמין';

    return {
      to,
      subject: this.subjectFor(templateKey, task.title),
      body: renderTemplate(template, {
        customerName: task.customer.name,
        checklistSummary,
        taskTitle: task.title,
      }),
    };
  }

  private subjectFor(templateKey: TemplateKey, taskTitle: string): string {
    return templateKey === 'taskClosed'
      ? `העבודה הושלמה: ${taskTitle}`
      : `קיבלנו את פנייתך: ${taskTitle}`;
  }
}

// `checklist` הוא Json חופשי ב-DB. צורה לא צפויה שם לא אמורה להפיל
// שליחת מייל — היא הופכת ל"ללא פירוט זמין".
function toChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ChecklistItem =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { label?: unknown }).label === 'string',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
