import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Observable, from, of, switchMap, tap } from 'rxjs';

import { PrismaService } from '../../database/prisma.service';

/* ---------------------------------------------------------------------------
   אידמפוטנטיות ברמת הבקשה.

   הלקוח כבר שלח `Idempotency-Key` בשלושה מקומות — יצירת משימה, הפקת
   חשבונית, סגירת משימה — וה-CORS התיר את הכותרת. **השרת התעלם ממנה.**
   כלומר ההבטחה הייתה ריקה: ניסיון חוזר אחרי timeout יצר חשבונית שנייה.

   התבנית:

     1. ניסיון לתפוס את המפתח בשורה חדשה. האילוץ הייחודי
        `(tenantId, key, endpoint)` הוא מה שהופך את התפיסה לאטומית —
        שתי בקשות במקביל לא יכולות שתיהן להצליח.

     2. תפיסה נכשלה (P2002) ⇒ מישהו הקדים.
          • יש תשובה שמורה → מחזירים אותה כפי שהיא.
          • אין עדיין → 409. הבקשה הראשונה עוד רצה, וניסיון שני
            במקביל אינו "ניסיון חוזר" אלא כפילות.

     3. הצליח ⇒ שומרים את התשובה לניסיונות הבאים.

     4. נכשל ⇒ **מוחקים את התפיסה.** בלי זה, כשל חולף היה נועל את
        המפתח לצמיתות והמשתמש לא היה יכול לנסות שוב.

   אותו מפתח עם גוף *שונה* נדחה ב-422 ולא מוחזר בשקט: זה כמעט תמיד
   באג בלקוח, והחזרת תשובה של בקשה אחרת הייתה מסתירה אותו.
   --------------------------------------------------------------------------- */

const HEADER = 'idempotency-key';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TTL_HOURS = 24;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const key = req.header(HEADER)?.trim();

    // ללא כותרת, או בקשה שאינה משנה מצב — שום דבר לא משתנה.
    if (!key || !MUTATING.has(req.method)) return next.handle();

    const tenantId = req.tenantId;
    if (!tenantId) {
      // הטבלה מסונפת לטננט. זרימות ללא טננט (onboarding) מוגנות
      // במנגנון אחר — נעילה אופטימית ותקרת קריאות לסשן.
      return next.handle();
    }

    if (key.length < 8 || key.length > 200) {
      throw new UnprocessableEntityException('Idempotency-Key must be between 8 and 200 characters');
    }

    const endpoint = `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? req.path}`;
    const requestHash = hashBody(req.body);

    return from(this.claim(tenantId, key, endpoint, requestHash)).pipe(
      switchMap((existing) => {
        if (existing) {
          const res = context.switchToHttp().getResponse<Response>();
          res.status(existing.statusCode);
          // כותרת שמסבירה למה התשובה זהה — בלעדיה זה נראה כאילו
          // הפעולה בוצעה שוב.
          res.setHeader('Idempotent-Replay', 'true');
          return of(existing.body);
        }

        return next.handle().pipe(
          tap({
            next: (body: unknown) => {
              void this.store(tenantId, key, endpoint, body, context);
            },
            error: () => {
              // שחרור התפיסה: כשל חולף לא אמור לנעול את המפתח.
              void this.release(tenantId, key, endpoint);
            },
          }),
        );
      }),
    );
  }

  /**
   * מחזיר את התשובה השמורה אם הבקשה הזו כבר טופלה, או null אם זו
   * הפעם הראשונה ותפסנו את המפתח.
   */
  private async claim(
    tenantId: string,
    key: string,
    endpoint: string,
    requestHash: string,
  ): Promise<{ statusCode: number; body: unknown } | null> {
    try {
      await this.prisma.forTenant(tenantId, (tx) =>
        tx.idempotencyKey.create({
          data: {
            tenantId,
            key,
            endpoint,
            requestHash,
            expiresAt: new Date(Date.now() + TTL_HOURS * 3_600_000),
          },
        }),
      );
      return null;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    }

    const prior = await this.prisma.forTenant(tenantId, (tx) =>
      tx.idempotencyKey.findFirst({ where: { tenantId, key, endpoint } }),
    );

    if (!prior) {
      // נדיר: השורה נמחקה בין ה-INSERT שנכשל לקריאה. ניסיון חוזר
      // מיידי יצליח.
      throw new ConflictException('Idempotency key is being processed — retry shortly');
    }

    if (prior.requestHash !== requestHash) {
      throw new UnprocessableEntityException(
        'This Idempotency-Key was already used with a different request body',
      );
    }

    if (prior.statusCode === null) {
      throw new ConflictException('A request with this Idempotency-Key is still in progress');
    }

    return { statusCode: prior.statusCode, body: prior.responseBody };
  }

  private async store(
    tenantId: string,
    key: string,
    endpoint: string,
    body: unknown,
    context: ExecutionContext,
  ): Promise<void> {
    const statusCode = context.switchToHttp().getResponse<Response>().statusCode;
    try {
      await this.prisma.forTenant(tenantId, (tx) =>
        tx.idempotencyKey.updateMany({
          where: { tenantId, key, endpoint },
          data: { statusCode, responseBody: body as Prisma.InputJsonValue },
        }),
      );
    } catch (err) {
      // כישלון בשמירה אינו מצדיק להפיל בקשה שהצליחה. ההשלכה היחידה
      // היא שניסיון חוזר יבוצע שוב — ולכן זה נרשם.
      this.logger.error({ err, key, endpoint }, 'Failed to store idempotent response');
    }
  }

  private async release(tenantId: string, key: string, endpoint: string): Promise<void> {
    try {
      await this.prisma.forTenant(tenantId, (tx) =>
        tx.idempotencyKey.deleteMany({ where: { tenantId, key, endpoint, statusCode: null } }),
      );
    } catch (err) {
      this.logger.error({ err, key, endpoint }, 'Failed to release idempotency claim');
    }
  }
}

/**
 * חתימת הגוף, לזיהוי שימוש חוזר במפתח עם תוכן אחר.
 *
 * המפתחות ממוינים כדי ששינוי סדר שדות ב-JSON לא ייחשב גוף שונה.
 */
function hashBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
