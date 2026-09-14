import { z } from 'zod';
import { request } from '@/lib/api';

/* ---------------------------------------------------------------------------
   שכבת ה-API של ה-onboarding.

   שתי הבחנות שחשוב לשמר:

   1. הזרימה כולה **אנונימית** — אין טננט ואין משתמש, כי הם עדיין לא
      קיימים. הזיהוי היחיד הוא `sessionSecret`, שהשרת מחזיר פעם אחת
      ב-start ואינו ניתן לשחזור.

   2. הסוד נשלח ב**גוף** הבקשה, או בכותרת `X-Onboarding-Secret` כשאין
      גוף. **לעולם לא ב-query string** — שם הוא נוחת בלוגים של הפרוקסי,
      בהיסטוריית הדפדפן וב-Referer.
   --------------------------------------------------------------------------- */

export const SESSION_SECRET_HEADER = 'X-Onboarding-Secret';
const STORAGE_KEY = 'craftmind.onboarding';

const startSchema = z.object({
  sessionId: z.string().uuid(),
  sessionSecret: z.string().length(64),
  message: z.string(),
});

const messageSchema = z.object({
  reply: z.string(),
  status: z.enum(['IN_PROGRESS', 'READY_TO_FINALIZE', 'FINALIZED', 'ABANDONED']),
});

const companyInfoSchema = z
  .object({
    legalName: z.string().nullish(),
    businessId: z.string().nullish(),
    vertical: z.enum(['MAINTENANCE', 'CARPENTRY', 'RETAIL']).nullish(),
    contactEmail: z.string().nullish(),
  })
  .nullish();

export const summarySchema = z.object({
  status: z.enum(['IN_PROGRESS', 'READY_TO_FINALIZE', 'FINALIZED', 'ABANDONED']),
  expiresAt: z.string(),
  companyInfo: companyInfoSchema,
  teamMembers: z
    .array(z.object({ name: z.string(), email: z.string(), role: z.string() }))
    .nullish(),
  priceCodes: z
    .array(z.object({ code: z.string(), description: z.string(), defaultPrice: z.number() }))
    .nullish(),
  jobTypes: z.array(z.object({ name: z.string(), requiredSkill: z.string().nullish() })).nullish(),
  documentCounts: z.object({ quotes: z.number(), materialOrders: z.number() }),
  llmCallsUsed: z.number(),
  llmCallsLimit: z.number(),
});
export type OnboardingSummary = z.infer<typeof summarySchema>;

const finalizeSchema = z.object({
  tenantId: z.string().uuid(),
  subdomain: z.string(),
  users: z.array(z.object({ email: z.string(), name: z.string(), role: z.string() })),
  jobTypesCreated: z.number(),
  priceCodesCreated: z.number(),
});
export type FinalizeResult = z.infer<typeof finalizeSchema>;

export interface StoredSession {
  sessionId: string;
  sessionSecret: string;
}

/**
 * הסשן נשמר ב-`sessionStorage`.
 *
 * שיחת onboarding היא ארוכה — רענון בטעות באמצע לא אמור לאבד אותה,
 * ולכן היא לא מוחזקת בזיכרון בלבד. מנגד היא גם לא ב-`localStorage`:
 * הסוד נותן גישה מלאה ליצירת הטננט, ואין סיבה שישרוד סגירת טאב על
 * מחשב משותף.
 */
export const sessionStore = {
  get(): StoredSession | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      const result = z
        .object({ sessionId: z.string().uuid(), sessionSecret: z.string().length(64) })
        .safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  },
  set(s: StoredSession): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* מצב פרטי — השיחה תעבוד, פשוט לא תשרוד רענון */
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};

export const onboardingApi = {
  start: () => request('/onboarding/start', { method: 'POST', schema: startSchema }),

  sendMessage: (s: StoredSession, message: string, signal?: AbortSignal) =>
    request(`/onboarding/${s.sessionId}/message`, {
      method: 'POST',
      body: { sessionSecret: s.sessionSecret, message },
      schema: messageSchema,
      signal,
    }),

  summary: (s: StoredSession, signal?: AbortSignal) =>
    request(`/onboarding/${s.sessionId}/summary`, {
      schema: summarySchema,
      headers: { [SESSION_SECRET_HEADER]: s.sessionSecret },
      signal,
    }),

  finalize: (s: StoredSession) =>
    request(`/onboarding/${s.sessionId}/finalize`, {
      method: 'POST',
      body: { sessionSecret: s.sessionSecret },
      schema: finalizeSchema,
    }),

  /** העלאה היא multipart, ולכן היא לא עוברת דרך `request` שמסרלז JSON. */
  async uploadDocument(
    s: StoredSession,
    file: File,
    docType: 'QUOTE' | 'MATERIAL_ORDER',
  ): Promise<void> {
    const form = new FormData();
    form.append('file', file);

    const res = await fetch(
      `${import.meta.env.VITE_API_URL ?? ''}/v1/onboarding/${s.sessionId}/documents?docType=${docType}`,
      { method: 'POST', body: form, headers: { [SESSION_SECRET_HEADER]: s.sessionSecret } },
    );

    if (!res.ok) {
      let message = `העלאת הקובץ נכשלה (${res.status})`;
      try {
        const payload: unknown = await res.json();
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'message' in payload &&
          typeof (payload as { message: unknown }).message === 'string'
        ) {
          message = (payload as { message: string }).message;
        }
      } catch {
        /* גוף שאינו JSON */
      }
      throw new Error(message);
    }
  },
};
