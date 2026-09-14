import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';

/**
 * בדיקות ל-PrismaService עצמו.
 *
 * הן קיימות בגלל באג ספציפי: `untenanted` היה `return this`, ו-`this`
 * בתוך מתודה של המחלקה הוא היעד הגולמי ולא ה-Proxy ש-PrismaClient
 * מחזיר מהקונסטרוקטור. ליעד הגולמי יש את המתודות האמיתיות
 * (`$queryRaw`, `$transaction`) אבל **אין לו אף model accessor**.
 *
 * התוצאה: raw SQL עבד, וכל קריאת מודל נכשלה ב-
 * `Cannot read properties of undefined`. מודול ה-onboarding כולו לא
 * עבד — ואיש לא ידע, כי לא היה לו ממשק ולא הייתה לו בדיקה.
 *
 * ההבחנה בין "raw עובד" ל-"מודלים שבורים" היא מה שהסתיר את זה, ולכן
 * הבדיקות כאן בודקות את שניהם במפורש.
 */
describe('PrismaService', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    // בדיוק כמו ב-DatabaseModule. אם החיווט שם ישתנה, הבדיקה הזו
    // תפסיק לשקף את המציאות — ולכן היא מתועדת כאן.
    prisma = PrismaService.create();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('untenanted', () => {
    it('exposes model accessors, not just raw query methods', () => {
      // זו הבדיקה שהייתה תופסת את הבאג.
      const db: PrismaClient = prisma.untenanted;
      expect(typeof db.onboardingSession).toBe('object');
      expect(typeof db.onboardingDocument).toBe('object');
      expect(typeof db.onboardingSession.create).toBe('function');
    });

    it('can actually query an untenanted table', async () => {
      // onboarding_sessions אינה מוגנת ב-RLS (אין לה tenantId), ולכן
      // ספירה עליה חייבת לעבוד ללא קונטקסט.
      await expect(prisma.untenanted.onboardingSession.count()).resolves.toBeGreaterThanOrEqual(0);
    });

    it('throws a clear error when built with `new` instead of create()', () => {
      // הכשל חייב להיות רועש ומיידי. הגרסה הקודמת החזירה לקוח
      // שנראה תקין וזרק `undefined is not an object` רק בקריאה
      // הראשונה למודל, עמוק בתוך קוד עסקי.
      const unwired = new PrismaService();
      expect(() => unwired.untenanted).toThrow(/PrismaService\.create\(\)/);
    });
  });

  describe('forTenant', () => {
    it('rejects a tenantId that is not a UUID before touching the database', async () => {
      await expect(prisma.forTenant('not-a-uuid', async (tx) => tx.customer.count())).rejects.toThrow(
        /non-UUID tenantId/,
      );
    });

    it('gives the callback a client with model accessors', async () => {
      // אותה מחלקת באג: אילו לקוח הטרנזקציה היה מגיע גולמי, כל
      // הקוד העסקי היה נופל באותה צורה.
      const TENANT = '11111111-1111-1111-1111-111111111111';
      await expect(
        prisma.forTenant(TENANT, (tx) => {
          expect(typeof tx.customer).toBe('object');
          expect(typeof tx.customer.findMany).toBe('function');
          return Promise.resolve(true);
        }),
      ).resolves.toBe(true);
    });
  });
});
