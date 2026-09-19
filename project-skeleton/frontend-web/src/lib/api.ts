import { z } from 'zod';

/* ---------------------------------------------------------------------------
   לקוח HTTP.

   שתי החלטות:

   1. כל תשובה עוברת סכמת Zod. ה-API הוא גבול — טיפוס TypeScript לבדו
      הוא הבטחה בזמן קומפילציה על נתונים שמגיעים בזמן ריצה. שינוי בשרת
      שלא סונכרן ייתפס כאן, עם הודעה ברורה, ולא כ-`undefined is not an
      object` שלושה רכיבים למטה.

   2. הטוקן ב-`sessionStorage` ולא ב-`localStorage`. XSS מגיע לשניהם,
      אבל sessionStorage לא שורד סגירת טאב ולא משותף בין טאבים — מה
      שמצמצם את חלון הזמן. הפתרון הנכון הוא cookie מסוג HttpOnly;
      זה מסומן כשלב הבא ב-docs.
   --------------------------------------------------------------------------- */

const TOKEN_KEY = 'craftmind.token';

export const tokenStore = {
  get: (): string | null => {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string): void => {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* מצב פרטי — נמשיך בלי התמדה */
    }
  },
  clear: (): void => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** האם כדאי להציע למשתמש לנסות שוב. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 429 || this.status === 0;
  }
}

/** נורה כשהשרת מחזיר 401 — ה-router מאזין ומעביר להתחברות. */
export const UNAUTHORIZED_EVENT = 'craftmind:unauthorized';

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  schema?: z.ZodType<T, z.ZodTypeDef, unknown>;
  signal?: AbortSignal;
  /** מפתח אידמפוטנטיות לפעולות שמשנות מצב. */
  idempotencyKey?: string;
  /** כותרות נוספות. משמש ל-X-Onboarding-Secret, שאין לו גוף לשבת בו. */
  headers?: Record<string, string>;
}

/**
 * בסיס ה-API.
 *
 * בפיתוח: נתיב יחסי, וה-proxy של Vite מעביר ל-localhost:3000. זה
 * גם שומר על ה-Host המקורי, שממנו השרת מזהה את הטננט.
 *
 * בפרודקשן: השרת אינו מתארח יחד עם ה-SPA (הוא מונוליט stateful עם
 * Postgres ו-Redis), ולכן צריך מקור מלא. VITE_API_URL מוגדר בזמן
 * הבנייה. אם הוא חסר — נופלים לנתיב יחסי, מה שעובד כשמגישים את
 * שניהם מאותו דומיין דרך Caddy.
 */
const BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/v1`;

export async function request<T = unknown>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', body, schema, signal, idempotencyKey, headers: extra } = opts;

  const headers: Record<string, string> = { Accept: 'application/json' };

  // זיהוי הטננט.
  //
  // כשהממשק והשרת על אותו דומיין, ה-Host נושא את תת-הדומיין של
  // הטננט והשרת פותר אותו לבד. כשהם על דומיינים שונים — SPA ב-Vercel
  // מול API במקום אחר — ה-Host כבר לא נושא אותו, ולכן מצהירים במפורש.
  //
  // זו הצהרה בלבד, לא הרשאה: השרת עדיין דורש סיסמה תקפה של אותו
  // טננט בהתחברות, ו-JwtAuthGuard דוחה טוקן שה-tenantId שלו אינו תואם.
  const tenant = import.meta.env.VITE_TENANT;
  if (tenant) headers['X-Tenant'] = tenant;
  const token = tokenStore.get();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (extra) Object.assign(headers, extra);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      credentials: import.meta.env.VITE_API_URL ? 'include' : 'same-origin',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'לא ניתן להתחבר לשרת', path);
  }

  if (res.status === 401) {
    tokenStore.clear();
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    throw new ApiError(401, 'נדרשת התחברות מחדש', path);
  }

  if (!res.ok) {
    let message = `שגיאה ${res.status}`;
    try {
      const payload: unknown = await res.json();
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'message' in payload &&
        typeof payload.message === 'string'
      ) {
        message = payload.message;
      }
    } catch {
      /* גוף שאינו JSON — נשארים עם הודעת ברירת המחדל */
    }
    throw new ApiError(res.status, message, path);
  }

  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json();

  if (!schema) return data as T;

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    // חוזה שבור בין שרת ללקוח. רועש בכוונה — עדיף מ-undefined שמתפשט.
    console.error('API response failed validation', { path, issues: parsed.error.issues });
    throw new ApiError(500, 'תשובת השרת אינה בפורמט צפוי', path);
  }
  return parsed.data;
}
