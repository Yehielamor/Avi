import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * לקוח Prisma בתוך טרנזקציה. זה מה שקוד עסקי מקבל — לא את הלקוח
 * הגולמי — כדי שלא תהיה דרך לשכוח את קונטקסט הטננט.
 */
export type TenantClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }

  // ---------------------------------------------------------------------------
  // הליבה של בידוד הטננטים.
  // ---------------------------------------------------------------------------

  /**
   * מריץ יחידת עבודה תחת קונטקסט הטננט, בתוך טרנזקציה אחת.
   *
   * למה טרנזקציה ולא `SET` פשוט:
   *
   *   הגרסה הקודמת קראה `$executeRawUnsafe("SET app.current_tenant_id = ...")`
   *   ישירות על הלקוח המאוגד (pooled). `SET` ברמת session נדבק *לחיבור*,
   *   לא לבקשה — והשאילתות שאחריו מקבלות חיבור אחר מה-pool. שני כשלים:
   *
   *     • דליפה: החיבור חוזר ל-pool כשהמשתנה של טננט A עדיין עליו.
   *       הבקשה הבאה של טננט B מקבלת אותו ורואה את הנתונים של A.
   *       זה RLS שנכשל *פתוח אל הטננט הלא נכון* — גרוע מבלי RLS.
   *
   *     • שבירה: ה-SET נוחת על חיבור אחד והשאילתה על אחר, המשתנה לא
   *       מוגדר, וכל שאילתה מחזירה אפס שורות.
   *
   *   ההערה בקוד הישן תלתה את זה ב-PgBouncer. זה היה שגוי: ה-pool
   *   הפנימי של Prisma מספיק כדי להפעיל את הבאג.
   *
   * `set_config(..., true)` הוא transaction-local: הוא מתאפס אוטומטית
   * ב-COMMIT/ROLLBACK, ולכן לא יכול לדלוף לבקשה הבאה. הוא גם פרמטרי,
   * מה שמסלק את אינטרפולציית המחרוזת שהייתה בשורה הרגישה ביותר בקוד.
   *
   * ראו docs/10-audit-findings.md#C1 ו-docs/03-security-and-multitenancy.md.
   *
   * חשוב: אל תריצו קריאות רשת (LLM, Google) בתוך `fn`. הטרנזקציה
   * מחזיקה חיבור DB לכל משך הריצה.
   */
  async forTenant<T>(
    tenantId: string,
    fn: (tx: TenantClient) => Promise<T>,
    options?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<T> {
    if (!UUID_RE.test(tenantId)) {
      // חוסם גם קלט זדוני וגם את מחרוזת ה-uuid הריקה שמגיעה מבאגים.
      throw new Error(`forTenant called with a non-UUID tenantId: ${JSON.stringify(tenantId)}`);
    }

    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return fn(tx);
      },
      {
        timeout: options?.timeoutMs ?? 10_000,
        maxWait: options?.maxWaitMs ?? 5_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  /**
   * תרגום subdomain -> tenantId.
   *
   * זו השאילתה היחידה שרצה בלי קונטקסט טננט, מהסיבה הפשוטה שהיא זו
   * שמייצרת אותו. היא לא עוקפת RLS דרך תפקיד מיוחד אלא דרך פונקציית
   * SECURITY DEFINER שחושפת בדיוק עמודה אחת — ראו מיגרציה 0002.
   *
   * מחזירה null לתת-דומיין לא מוכר, כדי ש-ה-caller יוכל להחזיר תשובה
   * אחידה ולא לאפשר מניית טננטים.
   */
  async resolveTenantBySubdomain(subdomain: string): Promise<string | null> {
    const rows = await this.$queryRaw<Array<{ tenant_id: string | null }>>`
      SELECT public.resolve_tenant_by_subdomain(${subdomain}) AS tenant_id
    `;
    return rows[0]?.tenant_id ?? null;
  }

  /**
   * hash של טוקן ציבורי -> tenantId.
   *
   * כמו resolveTenantBySubdomain: רצה בלי קונטקסט כי היא זו שמייצרת אותו,
   * דרך פונקציית SECURITY DEFINER שמחזירה עמודה אחת לקישור בתוקף בלבד
   * (מיגרציה 0006). null לכל מקרה אחר — פג, בוטל, לא קיים — בלי להבחין.
   */
  async resolveTenantByPublicLink(tokenHash: string): Promise<string | null> {
    const rows = await this.$queryRaw<Array<{ tenant_id: string | null }>>`
      SELECT public.resolve_public_link(${tokenHash}) AS tenant_id
    `;
    return rows[0]?.tenant_id ?? null;
  }

  /**
   * ה-Proxy שהקונסטרוקטור של PrismaClient מחזיר.
   *
   * נקבע ע"י ה-factory ב-DatabaseModule. ראו `untenanted`.
   */
  private proxiedSelf?: PrismaClient;


  /**
   * **הדרך היחידה ליצור את השירות.** אל תשתמשו ב-`new PrismaService()`.
   *
   * `new PrismaClient()` מחזיר Proxy, וה-`get` trap שלו קורא מהיעד
   * בלי להעביר receiver — כך ש-`this` בתוך מתודה של המחלקה הוא היעד
   * הגולמי ולא ה-Proxy, וליעד הגולמי אין model accessors. לכן צריך
   * לתפוס את ה-Proxy מבחוץ, וזה המקום היחיד שבו זה קורה.
   *
   * ה-factory קיים כדי שלא תהיינה שתי דרכים ליצור את השירות, שאחת
   * מהן שבורה בשקט.
   */
  static create(): PrismaService {
    const service = new PrismaService();
    service.proxiedSelf = service as unknown as PrismaClient;
    return service;
  }

  /**
   * גישה ללא קונטקסט טננט, לטבלאות שאין להן tenantId מעצם טבען
   * (onboarding_sessions, onboarding_documents).
   *
   * השם מכוון להיות לא נוח. כל שימוש בו הוא החלטה שצריכה הצדקה,
   * ואסור להשתמש בו לטבלה שיש לה tenantId — ה-RLS יזרוק שם ממילא.
   *
   * למה זה לא `return this`:
   *
   *   זה מה שהיה כאן, וזה היה שבור. `this` הוא היעד הגולמי, שעליו
   *   אין `onboardingSession` ואין שום מודל אחר — רק המתודות
   *   האמיתיות כמו `$queryRaw`. התוצאה הייתה ש-raw SQL עבד ו**כל
   *   קריאת מודל נכשלה ב-`Cannot read properties of undefined`**.
   *   מודול ה-onboarding כולו לא עבד, ואיש לא ידע כי לא היה לו
   *   ממשק ולא הייתה לו בדיקה.
   */
  get untenanted(): PrismaClient {
    if (!this.proxiedSelf) {
      throw new Error(
        'PrismaService was constructed with `new` instead of PrismaService.create(). ' +
          'Model accessors are missing on a raw instance — see the comment on this getter.',
      );
    }
    return this.proxiedSelf;
  }
}
