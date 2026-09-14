import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { OnboardingSession, Prisma } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service';
import type { AppEnv } from '../../config/env.schema';
import { ONBOARDING_TOOLS } from './onboarding-tools';
import {
  companyInfoSchema,
  jobTypeSchema,
  parseStored,
  priceCodeSchema,
  readyToFinalizeSchema,
  sessionDraftSchema,
  teamMemberSchema,
  type SessionDraft,
} from './onboarding-schemas';

// ============================================================
// "מוח" ה-Onboarding — שיחה מרובת-תורות עם Claude, tool-use בלבד
// (לא פרסור טקסט חופשי) לאיסוף מידע מובנה.
//
// המודול הזה אנונימי לחלוטין מעצם טבעו (הטננט עדיין לא קיים), ולכן
// הוא משטח ההתעללות הגדול ביותר במערכת. שלוש הגנות נושאות אותו:
//
//   1. `sessionSecretHash` — ב-DB יושב רק hash. דליפת DB לא מוסרת
//      סשנים חיים. ההשוואה היא constant-time.
//   2. `expiresAt` — סשן נטוש לא מחזיק ח.פ ואימייל לנצח, והסוד חדל
//      להיות תקף גם אחרי finalize.
//   3. `llmCallCount` + `version` — תקרת קריאות קשיחה לסשן, ונעילה
//      אופטימית שמונעת משתי קריאות /message מקבילות גם לדרוס זו את
//      תוצאות ה-tool של זו וגם להכפיל את החיוב.
//
// טבלאות ה-onboarding הן היחידות ללא tenantId וללא RLS, ולכן זהו
// השימוש הלגיטימי היחיד ב-`prisma.untenanted`.
// ============================================================

/** תקרת סיבובי tool-use בתוך בקשה אחת. גם תקרת קריאות ה-LLM לבקשה. */
const MAX_TOOL_ITERATIONS = 5;

const SESSION_SECRET_BYTES = 32;

export interface ValidatedSession extends OnboardingSession {
  draft: SessionDraft;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly ttlHours: number;
  private readonly maxLlmCalls: number;
  private readonly maxInputChars: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {
    this.client = new Anthropic({ apiKey: this.config.get('ANTHROPIC_API_KEY', { infer: true }) });
    this.model = this.config.get('ANTHROPIC_ONBOARDING_MODEL', { infer: true });
    this.ttlHours = this.config.get('ONBOARDING_SESSION_TTL_HOURS', { infer: true });
    this.maxLlmCalls = this.config.get('ONBOARDING_MAX_LLM_CALLS_PER_SESSION', { infer: true });
    this.maxInputChars = this.config.get('LLM_MAX_INPUT_CHARS', { infer: true });
  }

  // ---------------------------------------------------------------------------
  // סוד הסשן
  // ---------------------------------------------------------------------------

  /** sha256 מספיק: הסוד הוא 32 בתים אקראיים, לא סיסמה שאפשר לתקוף במילון. */
  private static hashSecret(secret: string): Buffer {
    return createHash('sha256').update(secret, 'utf8').digest();
  }

  async start(): Promise<{ sessionId: string; sessionSecret: string; message: string }> {
    const sessionSecret = randomBytes(SESSION_SECRET_BYTES).toString('hex');
    const greeting =
      'שלום! אני כאן כדי להכיר את העסק שלך ולהקים עבורו את המערכת. ' +
      'בוא נתחיל מהבסיס - מה השם הרשמי של החברה, ומה מספר ח.פ או עוסק מורשה?';

    const session = await this.prisma.untenanted.onboardingSession.create({
      data: {
        sessionSecretHash: OnboardingService.hashSecret(sessionSecret).toString('hex'),
        expiresAt: new Date(Date.now() + this.ttlHours * 3_600_000),
        conversationHistory: [{ role: 'assistant', content: greeting }] as Prisma.InputJsonValue,
      },
    });

    // הסוד מוחזר כאן פעם אחת ויחידה — הוא לא ניתן לשחזור מה-DB.
    return { sessionId: session.id, sessionSecret, message: greeting };
  }

  /**
   * מאמתת סשן ומחזירה אותו יחד עם ה-draft המפורסר.
   * זורקת על סוד שגוי, סשן שלא נמצא, או סשן שפג.
   */
  async validateSession(sessionId: string, sessionSecret: string): Promise<ValidatedSession> {
    const session = await this.prisma.untenanted.onboardingSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Onboarding session not found');

    // שני ה-buffers באורך קבוע (32 בתים), ולכן timingSafeEqual לעולם
    // לא זורק כאן — ואורך הסוד שנשלח אינו מדליף דבר.
    const provided = OnboardingService.hashSecret(sessionSecret);
    const stored = Buffer.from(session.sessionSecretHash, 'hex');
    if (stored.length !== provided.length || !timingSafeEqual(provided, stored)) {
      throw new ForbiddenException('Invalid session secret');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      // כולל סשן שכבר בוצע לו finalize — שם expiresAt נדחף לעבר
      // בכוונה, כדי שהסוד לא יישאר תקף אחרי שהטננט כבר קיים.
      throw new ForbiddenException('Onboarding session has expired');
    }

    return { ...session, draft: this.readDraft(session) };
  }

  private readDraft(session: OnboardingSession): SessionDraft {
    return parseStored(
      sessionDraftSchema,
      {
        companyInfo: session.companyInfo ?? null,
        teamMembers: session.teamMembers ?? [],
        priceCodes: session.priceCodes ?? [],
        jobTypes: session.jobTypes ?? [],
      },
      { companyInfo: null, teamMembers: [], priceCodes: [], jobTypes: [] },
    );
  }

  // ---------------------------------------------------------------------------
  // השיחה
  // ---------------------------------------------------------------------------

  async sendMessage(
    sessionId: string,
    sessionSecret: string,
    userMessage: string,
  ): Promise<{ reply: string; status: string }> {
    const session = await this.validateSession(sessionId, sessionSecret);
    if (session.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Session is already ${session.status} - cannot continue chatting`,
      );
    }

    const remaining = this.maxLlmCalls - session.llmCallCount;
    if (remaining <= 0) {
      throw new HttpException(
        'This onboarding session has reached its LLM call limit',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const budget = Math.min(MAX_TOOL_ITERATIONS, remaining);

    // --- הזמנת תקציב מראש ------------------------------------------------
    // מגדילים את llmCallCount ואת version *לפני* הקריאה הראשונה. שתי
    // מטרות בבת אחת: בקשה מקבילה על אותו סשן נכשלת כאן, לפני שהיא
    // מבזבזת ולו קריאה אחת; והתקרה נאכפת גם אם התהליך נופל באמצע.
    const reserved = await this.prisma.untenanted.onboardingSession.updateMany({
      where: { id: sessionId, version: session.version, status: 'IN_PROGRESS' },
      data: { version: { increment: 1 }, llmCallCount: { increment: budget } },
    });
    if (reserved.count === 0) {
      throw new ConflictException(
        'Another request is already processing this onboarding session - retry in a moment',
      );
    }
    const reservedVersion = session.version + 1;

    const draft: SessionDraft = {
      companyInfo: session.draft.companyInfo,
      teamMembers: [...session.draft.teamMembers],
      priceCodes: [...session.draft.priceCodes],
      jobTypes: [...session.draft.jobTypes],
    };
    let readyToFinalize = false;
    let callsUsed = 0;
    let finalText = 'קיבלתי, בוא נמשיך.';

    const docCounts = await this.getDocumentCounts(sessionId);

    // קלט משתמש נחתך. גוף הודעה בלתי חסום = בקשה של מיליוני טוקנים
    // על חשבון הפעלת המערכת. ראו docs/20-backend-conventions.md#9.
    const trimmedMessage = userMessage.slice(0, this.maxInputChars);

    // ההיסטוריה נכתבת רק על ידינו (אין נתיב שבו הלקוח מספק אותה),
    // ולכן די בבדיקה מבנית שזה מערך.
    const history = Array.isArray(session.conversationHistory)
      ? (session.conversationHistory as unknown as Anthropic.MessageParam[])
      : [];

    let messages: Anthropic.MessageParam[] = [
      ...history,
      { role: 'user', content: trimmedMessage },
    ];

    try {
      for (let iteration = 0; iteration < budget; iteration++) {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 2048,
          system: this.buildSystemPrompt(docCounts),
          tools: ONBOARDING_TOOLS,
          messages,
        });
        callsUsed += 1;

        messages = [...messages, { role: 'assistant', content: response.content }];

        const toolUses = response.content.filter((block) => block.type === 'tool_use');
        if (toolUses.length === 0) {
          const textBlock = response.content.find((block) => block.type === 'text');
          finalText = textBlock && textBlock.type === 'text' ? textBlock.text : finalText;
          break;
        }

        const toolResults: Anthropic.ContentBlockParam[] = [];
        for (const toolUse of toolUses) {
          const outcome = this.applyToolCall(toolUse.name, toolUse.input, draft);
          if (outcome.ok && outcome.readyToFinalize) readyToFinalize = true;

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            // כשל אימות חוזר למודל כ-is_error כדי שיתקן בתור הבא,
            // במקום שקלט פגום ייכתב ל-DB (כפי ש-`as unknown as X` עשה).
            is_error: !outcome.ok,
            content: outcome.ok ? JSON.stringify({ ok: true }) : outcome.error,
          });
        }

        messages = [...messages, { role: 'user', content: toolResults }];

        if (iteration === budget - 1) {
          finalText = 'קלטתי את הפרטים - נמשיך משם. יש עוד משהו שתרצה להוסיף?';
        }
      }
    } catch (err: unknown) {
      // מחזירים את התקציב שלא נוצל, ומשחררים את הנעילה כדי שהמשתמש
      // יוכל לנסות שוב. `catch` ריק אסור — השגיאה נרשמת ומוחזרת.
      await this.releaseReservation(sessionId, reservedVersion, budget - callsUsed);
      this.logger.error({ err, sessionId }, 'Onboarding LLM turn failed');
      throw new HttpException(
        'The onboarding assistant is temporarily unavailable - please retry',
        HttpStatus.BAD_GATEWAY,
      );
    }

    // --- כתיבה תחת אותה נעילה אופטימית -----------------------------------
    const written = await this.prisma.untenanted.onboardingSession.updateMany({
      where: { id: sessionId, version: reservedVersion },
      data: {
        conversationHistory: messages as unknown as Prisma.InputJsonValue,
        companyInfo: draft.companyInfo ?? undefined,
        teamMembers: draft.teamMembers,
        priceCodes: draft.priceCodes,
        jobTypes: draft.jobTypes,
        status: readyToFinalize ? 'READY_TO_FINALIZE' : undefined,
        version: { increment: 1 },
        llmCallCount: { decrement: budget - callsUsed },
      },
    });
    if (written.count === 0) {
      throw new ConflictException('Onboarding session changed concurrently - please retry');
    }

    return { reply: finalText, status: readyToFinalize ? 'READY_TO_FINALIZE' : 'IN_PROGRESS' };
  }

  private async releaseReservation(
    sessionId: string,
    reservedVersion: number,
    unused: number,
  ): Promise<void> {
    try {
      await this.prisma.untenanted.onboardingSession.updateMany({
        where: { id: sessionId, version: reservedVersion },
        data: { version: { increment: 1 }, llmCallCount: { decrement: Math.max(unused, 0) } },
      });
    } catch (err: unknown) {
      // כשל כאן משאיר את הסשן נעול עד שיפוג — מצב בטוח, אבל צריך להיראות.
      this.logger.error({ err, sessionId }, 'Failed to release onboarding session reservation');
    }
  }

  /**
   * מאמתת קריאת tool ומחילה אותה על ה-draft.
   * כל קלט עובר סכמת Zod — `as unknown as X` הוא בדיוק מה שאיפשר
   * ל-`role` שרירותי ול-`defaultPrice` שאינו מספר להגיע ל-DB.
   */
  private applyToolCall(
    name: string,
    input: unknown,
    draft: SessionDraft,
  ): { ok: true; readyToFinalize?: boolean } | { ok: false; error: string } {
    switch (name) {
      case 'record_company_info': {
        const parsed = companyInfoSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };
        draft.companyInfo = parsed.data;
        return { ok: true };
      }
      case 'add_team_member': {
        const parsed = teamMemberSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };
        if (draft.teamMembers.length >= 100) {
          return { ok: false, error: 'too many team members for one onboarding session' };
        }
        // המודל קורא לפעמים פעמיים לאותו אדם; המפתח הוא האימייל.
        const existing = draft.teamMembers.findIndex((m) => m.email === parsed.data.email);
        if (existing >= 0) draft.teamMembers[existing] = parsed.data;
        else draft.teamMembers.push(parsed.data);
        return { ok: true };
      }
      case 'add_price_code': {
        const parsed = priceCodeSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };
        if (draft.priceCodes.length >= 500) {
          return { ok: false, error: 'too many price codes for one onboarding session' };
        }
        const existing = draft.priceCodes.findIndex((p) => p.code === parsed.data.code);
        if (existing >= 0) draft.priceCodes[existing] = parsed.data;
        else draft.priceCodes.push(parsed.data);
        return { ok: true };
      }
      case 'add_job_type': {
        const parsed = jobTypeSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };
        if (draft.jobTypes.length >= 100) {
          return { ok: false, error: 'too many job types for one onboarding session' };
        }
        const existing = draft.jobTypes.findIndex((j) => j.name === parsed.data.name);
        if (existing >= 0) draft.jobTypes[existing] = parsed.data;
        else draft.jobTypes.push(parsed.data);
        return { ok: true };
      }
      case 'ready_to_finalize': {
        const parsed = readyToFinalizeSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };
        return { ok: true, readyToFinalize: true };
      }
      default:
        this.logger.warn({ tool: name }, 'Unknown tool called by LLM');
        return { ok: false, error: `unknown tool: ${name}` };
    }
  }

  async getSessionSummary(sessionId: string, sessionSecret: string) {
    const session = await this.validateSession(sessionId, sessionSecret);
    const docCounts = await this.getDocumentCounts(sessionId);
    return {
      status: session.status,
      expiresAt: session.expiresAt,
      companyInfo: session.draft.companyInfo,
      teamMembers: session.draft.teamMembers,
      priceCodes: session.draft.priceCodes,
      jobTypes: session.draft.jobTypes,
      documentCounts: docCounts,
      llmCallsUsed: session.llmCallCount,
      llmCallsLimit: this.maxLlmCalls,
    };
  }

  private async getDocumentCounts(
    sessionId: string,
  ): Promise<{ quotes: number; materialOrders: number }> {
    const counts = await this.prisma.untenanted.onboardingDocument.groupBy({
      by: ['docType'],
      where: { sessionId },
      _count: { _all: true },
    });
    const quotes = counts.find((c) => c.docType === 'QUOTE')?._count?._all ?? 0;
    const materialOrders = counts.find((c) => c.docType === 'MATERIAL_ORDER')?._count?._all ?? 0;
    return { quotes, materialOrders };
  }

  private buildSystemPrompt(docCounts: { quotes: number; materialOrders: number }): string {
    return `אתה מנהל שיחת onboarding עבור עסק חדש שמצטרף למערכת ניהול עבודה. תפקידך לאסוף בהדרגה, בשיחה טבעית וידידותית בעברית:

1. פרטי חברה בסיסיים (שם רשמי, ח.פ/עוסק מורשה, סוג העסק - חברת אחזקה/נגרייה/חנות קמעונאית, מייל ליצירת קשר) - קרא ל-record_company_info כשיש לך את כולם.
2. אנשי צוות - לפחות בעל העסק עצמו, עם תפקיד ומייל - קרא ל-add_team_member לכל אחד.
3. "קודי סגירה" / קודי מחירון - פעולות שהעסק מתמחר בנפרד (למשל "החלפת פילטר - 80 ש"ח") - קרא ל-add_price_code לכל אחד שמוזכר.
4. סוגי עבודה (למשל "התקנת מזגן") - אילו שדות רלוונטיים ואילו פעולות/checklist נדרשות לסגירה - קרא ל-add_job_type.
5. אחרי כל אלה, בקש מהמשתמש להעלות עד 10 הצעות מחיר ישנות ועד 10 הזמנות חומרים אחרונות (דרך כפתור ההעלאה בממשק - אתה לא מקבל את הקבצים ישירות בצ'אט, רק מציין שזה הזמן להעלות).
   סטטוס נוכחי של העלאות: ${docCounts.quotes} הצעות מחיר, ${docCounts.materialOrders} הזמנות חומרים הועלו עד כה.
6. כשיש לך פרטי חברה מלאים, לפחות איש צוות אחד, ולפחות סוג עבודה אחד - קרא ל-ready_to_finalize עם סיכום קצר. אל תמהר לקרוא לזה לפני שיש מספיק מידע, אבל גם אל תעכב מעבר לצורך אם המשתמש כבר ענה על הכל.

חשוב: תמיד תשאל שאלה אחת בכל פעם, לא רשימה ארוכה של שאלות יחד. תהיה טבעי וקצר.`;
  }
}

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}
