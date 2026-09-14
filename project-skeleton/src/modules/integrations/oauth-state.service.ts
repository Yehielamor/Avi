import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

// ============================================================
// טוקן ה-state של OAuth (audit C6).
//
// ------------------------------------------------------------
// מה היה שבור
// ------------------------------------------------------------
// ה-state נחתם ב-`JWT_SECRET` — אותו סוד שחותם טוקני התחברות —
// וה-guard לא בדק `aud` או `purpose`. טוקן ה-state נוסע ב-query
// string: הוא יושב בהיסטוריית הדפדפן, ב-Referer, בלוגים של Google
// ובלוגים של כל proxy בדרך. מי שהשיג אותו יכול היה להגיש אותו
// כ-`Authorization: Bearer` ולקבל גישה מלאה לטננט.
//
// שלוש הגנות, כל אחת עומדת בפני עצמה:
//
//   1. **סוד נפרד** — `OAUTH_STATE_SECRET`. חתימה בסוד הזה לא
//      מאומתת ע"י `AuthService.verifyToken`, ולהיפך. ה-env schema
//      אוכף שהם שונים.
//   2. **`aud` + `purpose`** — גם אם מישהו יאחד בטעות את הסודות,
//      ה-audience לא תואם ו-ה-guard דוחה.
//   3. **חד-פעמיות** — ה-jti נצרך בשימוש הראשון. הפעלה חוזרת של
//      אותו callback URL (רענון דף, כפתור "אחורה", לוג שהודלף)
//      נדחית.
//
// ובנוסף, קשירה ל-CSRF: nonce שנשמר ב-cookie ‏HttpOnly/SameSite=Lax
// ו-ה-hash שלו חתום בתוך ה-state. תוקף שמפתה את הדפדפן של הקורבן
// ל-callback עם `code` *שלו* לא מחזיק את ה-cookie, ולכן לא יכול
// לחבר את חשבון Google שלו לטננט של הקורבן (account-linking CSRF).
// ============================================================

export const OAUTH_STATE_AUDIENCE = 'craftmind:oauth-state';
export const OAUTH_STATE_ISSUER = 'craftmind:api';
export const OAUTH_NONCE_COOKIE = 'cm_oauth_nonce';
const STATE_TTL_SECONDS = 600; // 10 דקות

export interface OAuthStateClaims {
  /** subject — הטננט שיזם את החיבור. */
  tenantId: string;
  purpose: 'google_oauth_state';
  /** hash של ה-nonce שנשמר ב-cookie אצל הדפדפן היוזם. */
  nonceHash: string;
  jti: string;
}

export interface IssuedOAuthState {
  state: string;
  /** הערך הגולמי ל-cookie. ה-hash שלו בלבד נכנס לטוקן. */
  nonce: string;
  cookieMaxAgeMs: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * מעקב אחרי jti שנצרכו, לאכיפת חד-פעמיות.
 *
 * מימוש בזיכרון בכוונה, עם הסתייגות מפורשת: בפריסה מרובת-מופעים
 * הוא מכסה רק את המופע שקיבל את הבקשה. **הערובה החוצה-מופעים היא
 * ה-nonce cookie**, שנמחק ב-callback הראשון — ולכן ניסיון חוזר
 * נדחה בכל מופע. המבנה כאן מבודד מאחורי המתודות `consume`/`isConsumed`
 * כדי שהחלפה ל-Redis תהיה שינוי מקומי.
 */
class ConsumedStateStore {
  private readonly consumed = new Map<string, number>();

  /** מחזיר false אם ה-jti כבר נצרך. */
  consume(jti: string, ttlMs: number): boolean {
    this.sweep();
    if (this.consumed.has(jti)) return false;
    this.consumed.set(jti, Date.now() + ttlMs);
    return true;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [jti, expiresAt] of this.consumed) {
      if (expiresAt <= now) this.consumed.delete(jti);
    }
  }
}

export class OAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthStateError';
  }
}

@Injectable()
export class OAuthStateService {
  private readonly logger = new Logger(OAuthStateService.name);
  private readonly consumedStates = new ConsumedStateStore();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get secret(): string {
    // אם זה חסר, האפליקציה כבר לא הייתה עולה (env.schema) — הבדיקה
    // כאן היא רק כדי לא לחתום בטעות ב-undefined.
    const secret = this.config.get<string>('OAUTH_STATE_SECRET');
    if (!secret) throw new Error('OAUTH_STATE_SECRET is not configured');
    return secret;
  }

  /** ה-cookie חוצה תתי-דומיינים: ה-connect רץ על תת-הדומיין של הטננט, ה-callback על דומיין הבסיס. */
  cookieOptions(): {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    domain: string;
    path: string;
    maxAge: number;
  } {
    const baseDomain = this.config.get<string>('BASE_DOMAIN') ?? '';
    return {
      httpOnly: true,
      sameSite: 'lax', // ה-redirect מ-Google הוא ניווט top-level GET, ולכן Lax מספיק ולא שובר את ה-flow
      secure: this.config.get<string>('NODE_ENV') === 'production',
      domain: `.${baseDomain}`,
      path: '/',
      maxAge: STATE_TTL_SECONDS * 1_000,
    };
  }

  issue(tenantId: string): IssuedOAuthState {
    const nonce = randomBytes(32).toString('base64url');
    const jti = randomBytes(16).toString('hex');

    const state = this.jwt.sign(
      { tenantId, purpose: 'google_oauth_state', nonceHash: sha256(nonce) } satisfies Omit<
        OAuthStateClaims,
        'jti'
      >,
      {
        secret: this.secret,
        expiresIn: STATE_TTL_SECONDS,
        audience: OAUTH_STATE_AUDIENCE,
        issuer: OAUTH_STATE_ISSUER,
        jwtid: jti,
      },
    );

    return { state, nonce, cookieMaxAgeMs: STATE_TTL_SECONDS * 1_000 };
  }

  /**
   * מאמת חתימה + aud/iss + purpose, קושר ל-nonce מה-cookie, וצורך
   * את ה-jti. זורק `OAuthStateError` בכל כשל — הקורא מתרגם ל-400
   * אחיד, בלי לספר לתוקף מה בדיוק נכשל.
   */
  verifyAndConsume(state: string, nonceFromCookie: string | undefined): OAuthStateClaims {
    if (!nonceFromCookie) {
      throw new OAuthStateError(
        'Missing OAuth nonce cookie — the callback was not initiated by this browser',
      );
    }

    let claims: OAuthStateClaims & { exp?: number };
    try {
      claims = this.jwt.verify<OAuthStateClaims & { exp?: number }>(state, {
        secret: this.secret,
        audience: OAUTH_STATE_AUDIENCE,
        issuer: OAUTH_STATE_ISSUER,
      });
    } catch (err: unknown) {
      throw new OAuthStateError(
        `OAuth state failed verification: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }

    if (claims.purpose !== 'google_oauth_state') {
      throw new OAuthStateError('OAuth state has the wrong purpose claim');
    }
    if (!claims.jti) {
      throw new OAuthStateError('OAuth state has no jti and cannot be made single-use');
    }

    // השוואה בזמן קבוע — ה-nonce הוא סוד קצר, ו-`===` על מחרוזות
    // דולף את אורך הקידומת המשותפת.
    const expected = Buffer.from(claims.nonceHash ?? '', 'utf8');
    const actual = Buffer.from(sha256(nonceFromCookie), 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new OAuthStateError('OAuth nonce does not match the initiating browser');
    }

    const ttlMs = claims.exp
      ? Math.max(claims.exp * 1_000 - Date.now(), 0)
      : STATE_TTL_SECONDS * 1_000;
    if (!this.consumedStates.consume(claims.jti, ttlMs + 60_000)) {
      this.logger.warn({ jti: claims.jti }, 'OAuth state replay rejected');
      throw new OAuthStateError('OAuth state has already been used');
    }

    return claims;
  }

  /**
   * קריאת cookie ישירות מה-header. `cookie-parser` לא רשום באפליקציה,
   * וה-callback הוא ה-route היחיד שצריך cookie — עדיף פונקציה של
   * חמש שורות מאשר middleware גלובלי חדש בשביל endpoint אחד.
   */
  static readCookie(cookieHeader: string | undefined, name: string): string | undefined {
    if (!cookieHeader) return undefined;
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() !== name) continue;
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined; // cookie משובש — מטופל כחסר
      }
    }
    return undefined;
  }
}
