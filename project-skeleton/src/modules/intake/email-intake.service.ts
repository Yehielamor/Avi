import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { TasksService } from '../tasks/tasks.service';
import { parseFromHeader } from '../integrations/email-parsing.util';
import { IntegrationAuthError } from '../integrations/external-call.util';
import type { FetchEmailsResult, ParsedEmail } from '../integrations/gmail.connector';
import { GmailConnector } from '../integrations/gmail.connector';
import { IntakeExtractionService } from './intake-extraction.service';

// ============================================================
// תזמור מייל → משימה.
//
// ------------------------------------------------------------
// למה זה עבר לכאן
// ------------------------------------------------------------
// הלולאה הזו ישבה ב-`integrations.controller.ts`. מודול תשתית —
// שתפקידו OAuth, הצפנת טוקנים ו-connectors — החזיק את הלוגיקה
// העסקית של "איך פנייה הופכת למשימה", והיה תלוי ב-Tasks, ב-Customers
// וב-Intake. התוצאה: כל שינוי בכללי הקליטה נגע בקוד ה-OAuth.
//
// ------------------------------------------------------------
// ובעיקר: כל מייל בתוך try/catch משלו
// ------------------------------------------------------------
// ללולאה הישנה לא היה try/catch בכלל. מייל אחד שנכשל הפיל את כל
// הסנכרון ב-500 — לא נוצר ממנו Task, הוא לא סומן כנקרא, ולכן
// נשלף שוב בכל ריצה והפיל גם אותה. מייל אחד השבית לצמיתות את
// קליטת המיילים של הטננט כולו.
//
// עכשיו: כשל של מייל בודד מבודד למייל הזה, נרשם ומדווח חזרה —
// ושאר האצווה ממשיכה.
// ============================================================

export interface EmailIntakeReport {
  created: Array<{
    taskId: string;
    gmailMessageId: string;
    matchedTemplate: boolean;
    confidence: number;
  }>;
  skippedAlreadyProcessed: number;
  failed: Array<{ gmailMessageId: string; reason: string }>;
  totalFetched: number;
  /** true אם נשארו מיילים מעבר לתקרת האצווה — צריך ריצה נוספת. */
  moreAvailable: boolean;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Injectable()
export class EmailIntakeService {
  private readonly logger = new Logger(EmailIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly tasks: TasksService,
    private readonly customers: CustomersService,
    private readonly extraction: IntakeExtractionService,
  ) {}

  async syncGmail(
    tenantId: string,
    options: { maxMessages?: number } = {},
  ): Promise<EmailIntakeReport> {
    const { lastSyncedAt } = await this.integrations.getSyncState(tenantId, 'GMAIL');
    const startedAt = new Date();

    // השליפה מ-Google היא קריאת רשת — היא רצה *לפני* כל טרנזקציה,
    // ולא בתוך `forTenant`. טרנזקציה מחזיקה חיבור DB, ושליפה של
    // מאות מיילים הייתה תופסת אותו לדקות.
    let fetched: FetchEmailsResult;
    let connector: GmailConnector;
    try {
      const raw = await this.integrations.getConnector(tenantId, 'GMAIL');
      connector = raw as GmailConnector;
      await connector.ensureAuthenticated();

      fetched = await connector.fetch<FetchEmailsResult>('unread_messages', {
        since: lastSyncedAt,
        maxMessages: options.maxMessages,
      });
    } catch (err: unknown) {
      if (err instanceof IntegrationAuthError) {
        // EXPIRED + lastError, במקום 500 אטום שחוזר לנצח.
        await this.integrations.markExpired(tenantId, 'GMAIL', err.message);
      }
      throw err;
    }

    const report: EmailIntakeReport = {
      created: [],
      skippedAlreadyProcessed: 0,
      failed: [],
      totalFetched: fetched.emails.length,
      moreAvailable: fetched.truncated,
    };

    for (const email of fetched.emails) {
      try {
        const outcome = await this.ingestOne(tenantId, email);

        if (outcome.kind === 'skipped') {
          report.skippedAlreadyProcessed++;
        } else {
          report.created.push({
            taskId: outcome.taskId,
            gmailMessageId: email.gmailMessageId,
            matchedTemplate: outcome.matchedTemplate,
            confidence: outcome.confidence,
          });
        }

        // סימון כנקרא רק אחרי שהמשימה קיימת ב-DB. הסדר ההפוך היה
        // מאבד פנייה לגמרי אם הכתיבה נכשלת אחריו.
        await this.markReadQuietly(connector, email.gmailMessageId);
      } catch (err: unknown) {
        // הבידוד. מייל אחד לא מפיל את האצווה.
        report.failed.push({ gmailMessageId: email.gmailMessageId, reason: errorMessage(err) });
        this.logger.error(
          { err, tenantId, gmailMessageId: email.gmailMessageId },
          'Failed to ingest one email; continuing with the rest of the batch',
        );
      }
    }

    // ה-watermark מתקדם רק אם באמת מיצינו את האצווה. אחרת הריצה
    // הבאה תדלג על מה שנשאר מאחור.
    if (!fetched.truncated) {
      await this.integrations.recordSyncSuccess(tenantId, 'GMAIL', startedAt, fetched.cursor);
    }

    return report;
  }

  private async ingestOne(
    tenantId: string,
    email: ParsedEmail,
  ): Promise<
    | { kind: 'skipped' }
    | { kind: 'created'; taskId: string; matchedTemplate: boolean; confidence: number }
  > {
    // בדיקה מקדימה בלבד. הערובה האמיתית היא
    // `@@unique([tenantId, sourceEmailId])` + טיפול ב-P2002 למטה.
    const existing = await this.prisma.forTenant(tenantId, (tx) =>
      tx.task.findFirst({
        where: { tenantId, sourceEmailId: email.gmailMessageId },
        select: { id: true },
      }),
    );
    if (existing) return { kind: 'skipped' };

    const { name, email: fromEmail, isValidEmail } = parseFromHeader(email.from);

    const customerId = await this.resolveCustomer(tenantId, name, fromEmail, isValidEmail);

    // קריאת ה-LLM היא קריאת רשת — מחוץ לכל טרנזקציה, במכוון.
    // `matchedTemplateId` שחוזר ממנה כבר עבר אימות מול רשימת
    // התבניות של הטננט (ראו intake-extraction.service.ts).
    const extraction = await this.extraction.extractFromEmail(tenantId, {
      subject: email.subject,
      bodyText: email.bodyText || email.snippet,
    });
    const autoAssign = this.extraction.shouldAutoAssignTemplate(extraction);

    try {
      const task = await this.tasks.createFromEmail(tenantId, {
        customerId,
        title: email.subject || '(ללא נושא)',
        description: email.bodyText || email.snippet,
        sourceEmailId: email.gmailMessageId,
        jobTypeTemplateId: autoAssign ? extraction.matchedTemplateId : null,
        extractedFields: extraction.extractedFields,
        priority: extraction.priority,
      });

      return {
        kind: 'created',
        taskId: task.id,
        matchedTemplate: autoAssign,
        confidence: extraction.confidence,
      };
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        // ריצת cron חופפת הספיקה לקלוט את אותו מייל. זו התנהגות
        // תקינה של האידמפוטנטיות, לא שגיאה.
        return { kind: 'skipped' };
      }
      throw err;
    }
  }

  /**
   * לקוח קיים לפי כתובת מדויקת, אחרת חדש.
   *
   * `customers.search` הוא `contains` לצורכי autocomplete — התאמה
   * חלקית כאן הייתה משייכת פנייה של `dan@x.com` ללקוח `dan@xy.com`.
   * לכן ההתאמה מסוננת לשוויון מדויק ולא-רגיש-לרישיות.
   */
  private async resolveCustomer(
    tenantId: string,
    name: string,
    fromEmail: string,
    isValidEmail: boolean,
  ): Promise<string> {
    if (isValidEmail) {
      const candidates = await this.customers.search(tenantId, fromEmail);
      const exact = candidates.find((c) => c.email?.toLowerCase() === fromEmail.toLowerCase());
      if (exact) return exact.id;
    }

    // כתובת שלא עברה אימות לא נשמרת כ-email: היא הייתה הופכת
    // בהמשך ל-`To:` יוצא (docs/20-backend-conventions.md §10).
    const created = await this.customers.create(
      tenantId,
      isValidEmail ? { name, email: fromEmail } : { name },
    );
    return created.id;
  }

  /**
   * כשל בסימון כנקרא לא אמור להפיל מייל שכבר הפך למשימה — הריצה
   * הבאה תזהה אותו כמעובד דרך `sourceEmailId`. נרשם, לא נזרק.
   */
  private async markReadQuietly(connector: GmailConnector, messageId: string): Promise<void> {
    try {
      await connector.markRead(messageId);
    } catch (err: unknown) {
      this.logger.warn({ err, messageId }, 'Failed to mark email as read after ingestion');
    }
  }
}
