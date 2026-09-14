// ============================================================
// עטיפה אחידה לכל קריאה יוצאת (docs/20-backend-conventions.md §10):
// timeout מפורש, retry עם backoff אקספוננציאלי + jitter, וסיווג
// שגיאות שמבדיל בין "נסה שוב" לבין "ההרשאה מתה".
//
// למה זה חשוב דווקא כאן: `invalid_grant` הוא שגיאה *סופית* — הטננט
// ביטל את ההרשאה, שינה סיסמה, או שה-refresh token סובב ואנחנו
// שמרנו את הישן. retry עליה רק מבזבז זמן ומייצר 500 אטום. הגרסה
// הקודמת לא הבדילה, והאינטגרציה נשארה CONNECTED לנצח בזמן שכל
// קריאה נכשלה.
// ============================================================

export interface RetryOptions {
  /** תקרת זמן לכל *ניסיון* בודד. */
  timeoutMs?: number;
  /** מספר הניסיונות הכולל, כולל הראשון. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

const DEFAULTS = {
  timeoutMs: 15_000,
  attempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 4_000,
} as const;

/** ההרשאה מתה. אין טעם לנסות שוב; האינטגרציה עוברת ל-EXPIRED. */
export class IntegrationAuthError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IntegrationAuthError';
  }
}

/** כשל זמני שמיצה את הניסיונות. האינטגרציה נשארת CONNECTED. */
export class IntegrationTransientError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IntegrationTransientError';
  }
}

function errorFields(err: unknown): { status?: number; text: string } {
  if (typeof err !== 'object' || err === null) return { text: String(err) };

  const e = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown; data?: unknown };
    message?: unknown;
  };

  const rawStatus = e.response?.status ?? e.status ?? e.code;
  const status = typeof rawStatus === 'number' ? rawStatus : undefined;

  // google-auth-library קובר את `error: "invalid_grant"` בגוף התשובה,
  // לא ב-message — לכן גם הגוף נסרק.
  const parts = [
    typeof e.message === 'string' ? e.message : '',
    e.response?.data !== undefined ? JSON.stringify(e.response.data) : '',
  ];

  return { status, text: parts.join(' ') };
}

/** `invalid_grant`, `unauthorized_client`, 401 או 403 — הרשאה מתה. */
export function isAuthFailure(err: unknown): boolean {
  const { status, text } = errorFields(err);
  if (status === 401 || status === 403) return true;
  return /invalid_grant|unauthorized_client|invalid_client|Token has been expired or revoked/i.test(
    text,
  );
}

/** 429 ו-5xx, וכשלי רשת/timeout — שווה לנסות שוב. */
export function isRetryable(err: unknown): boolean {
  if (isAuthFailure(err)) return false;
  const { status, text } = errorFields(err);
  if (status === 429) return true;
  if (status !== undefined && status >= 500 && status < 600) return true;
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|timed out/i.test(
    text,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    // בלי זה ה-timer מחזיק את ה-event loop פתוח עד שהוא נורה, וכל
    // קריאה מהירה מוסיפה 15 שניות ל-shutdown.
    if (timer) clearTimeout(timer);
  }
}

/**
 * מריץ `fn` עם timeout ו-retry. שגיאת הרשאה עולה מיד כ-
 * `IntegrationAuthError`; כשל זמני שמיצה ניסיונות עולה כ-
 * `IntegrationTransientError`. כל שגיאה אחרת עולה כמות שהיא.
 */
export async function callExternal<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const attempts = options.attempts ?? DEFAULTS.attempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const label = options.label ?? 'external call';

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withTimeout(fn, timeoutMs, label);
    } catch (err: unknown) {
      lastError = err;

      if (isAuthFailure(err)) {
        throw new IntegrationAuthError(
          `${label} failed: credentials rejected by the provider`,
          err,
        );
      }
      if (!isRetryable(err) || attempt === attempts) break;

      // jitter מלא: בלי זה, כל הטננטים שנכשלו באותה שנייה חוזרים
      // יחד באותה שנייה ומייצרים את אותו עומס שגרם לכשל.
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(Math.round(backoff * (0.5 + Math.random() * 0.5)));
    }
  }

  if (isRetryable(lastError)) {
    throw new IntegrationTransientError(`${label} failed after ${attempts} attempts`, lastError);
  }
  throw lastError;
}
