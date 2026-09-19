import { z } from 'zod';

/* ---------------------------------------------------------------------------
   לקוח HTTP.

   זהו עותק של `frontend-web/src/lib/api.ts` עם תוספת אחת: `requestCached`,
   שמחזיר גם את מצא הטריות של התשובה. שני היישומים יתבדרו (ה-PWA צריך
   אופליין, ה-web לא), ולכן שכפול עדיף כאן על תלות משותפת.

   שתי ההחלטות מה-web נשמרות:

   1. כל תשובה עוברת סכמת Zod. ה-API הוא גבול — טיפוס TypeScript לבדו
      הוא הבטחה בזמן קומפילציה על נתונים שמגיעים בזמן ריצה.

   2. הטוקן ב-`sessionStorage` ולא ב-`localStorage`. XSS מגיע לשניהם,
      אבל sessionStorage לא שורד סגירת טאב ולא משותף בין טאבים.
      הפתרון הנכון הוא cookie מסוג HttpOnly; מסומן כשלב הבא ב-docs.
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

  /** status 0 = הבקשה לא יצאה כלל. במובייל זה כמעט תמיד היעדר קליטה. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

/** נורה כשהשרת מחזיר 401 — ה-router מאזין ומעביר להתחברות. */
export const UNAUTHORIZED_EVENT = 'craftmind:unauthorized';

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  schema?: z.ZodType<T, z.ZodTypeDef, unknown>;
  signal?: AbortSignal;
  idempotencyKey?: string;
}

/**
 * תשובה יחד עם מקורה.
 *
 * `fromCache` אינו נוחות — הוא חוזה: מסך שמציג נתון שמור **חייב**
 * לומר זאת. הצגת נתון בן שעתיים כאילו הוא חי היא הדרך שבה טכנאי
 * נוסע לכתובת של משימה שבוטלה.
 */
export interface Fresh<T> {
  data: T;
  fromCache: boolean;
  /** מתי ה-service worker שמר את התשובה. null כשהיא הגיעה מהרשת. */
  cachedAt: string | null;
}

/**
 * בסיס ה-API.
 *
 * בפיתוח: נתיב יחסי, וה-proxy של Vite מעביר ל-localhost:3100 — מה
 * ששומר על ה-Host המקורי, שממנו השרת מזהה את הטננט.
 *
 * בפרודקשן: VITE_API_URL מוגדר בזמן הבנייה.
 */
const BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/v1`;

async function send(path: string, opts: RequestOptions<unknown>): Promise<Response> {
  const { method = 'GET', body, signal, idempotencyKey } = opts;

  const headers: Record<string, string> = { Accept: 'application/json' };

  // זיהוי הטננט. כשהממשק והשרת על דומיינים שונים, ה-Host שמגיע
  // לשרת אינו נושא את תת-הדומיין של הטננט, ולכן מצהירים במפורש.
  // זו הצהרה בלבד, לא הרשאה — השרת עדיין דורש סיסמה תקפה של אותו
  // טננט, ו-JwtAuthGuard דוחה טוקן שה-tenantId שלו אינו תואם.
  const tenant = import.meta.env.VITE_TENANT;
  if (tenant) headers['X-Tenant'] = tenant;
  const token = tokenStore.get();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  try {
    return await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      credentials: import.meta.env.VITE_API_URL ? 'include' : 'same-origin',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'אין חיבור לשרת', path);
  }
}

async function parse<T>(res: Response, path: string, schema?: RequestOptions<T>['schema']): Promise<T> {
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
        typeof (payload).message === 'string'
      ) {
        message = (payload as { message: string }).message;
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

export async function request<T = unknown>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  return parse<T>(await send(path, opts), path, opts.schema);
}

/**
 * כמו `request`, אבל מדווח אם התשובה הוגשה מהמטמון של ה-service
 * worker. הכותרות נוספות ב-`src/sw.ts`.
 *
 * בפיתוח אין service worker רשום, ולכן `fromCache` תמיד false —
 * וזה נכון: אין שם מטמון שיכול להגיש נתון ישן.
 */
export async function requestCached<T>(path: string, opts: RequestOptions<T> = {}): Promise<Fresh<T>> {
  const res = await send(path, opts);
  const fromCache = res.headers.get('X-From-Cache') === '1';
  const cachedAt = fromCache ? res.headers.get('X-Cached-At') : null;
  return { data: await parse<T>(res, path, opts.schema), fromCache, cachedAt };
}

/**
 * ניקוי הנתונים השמורים. נקרא בהתנתקות: ה-Cache API שורד סגירת
 * טאב, בניגוד ל-sessionStorage שמחזיק את הטוקן, ובלי זה המשתמש
 * הבא במכשיר היה רואה את המשימות של הקודם.
 */
export function clearApiCache(): void {
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_API_CACHE' });
}
