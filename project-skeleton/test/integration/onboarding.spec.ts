import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';

/**
 * בדיקות ל-onboarding.
 *
 * המודול הזה לא עבד כלל: כל קריאת מודל דרך `prisma.untenanted` נכשלה
 * ב-`Cannot read properties of undefined`, כי ה-getter החזיר את היעד
 * הגולמי במקום את ה-Proxy של PrismaClient. זה שרד כי לא היה למודול
 * ממשק ולא הייתה לו אף בדיקה — raw SQL עבד, ולכן שאר המערכת נראתה
 * תקינה.
 *
 * הבדיקות כאן נוגעות בטבלאות ה-onboarding דרך אותו מסלול שהקוד
 * האמיתי משתמש בו.
 */
describe('Onboarding storage', () => {
  let prisma: PrismaService;
  let privileged: PrismaClient;
  const createdIds: string[] = [];

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await privileged.onboardingSession.deleteMany({ where: { id: { in: createdIds } } });
    }
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  const createSession = async (): Promise<string> => {
    const session = await prisma.untenanted.onboardingSession.create({
      data: {
        sessionSecretHash: `test-${Math.random().toString(36).slice(2)}`.padEnd(64, '0'),
        expiresAt: new Date(Date.now() + 3_600_000),
        conversationHistory: [],
      },
    });
    createdIds.push(session.id);
    return session.id;
  };

  it('creates a session through the untenanted client', async () => {
    const id = await createSession();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reads it back', async () => {
    const id = await createSession();
    const found = await prisma.untenanted.onboardingSession.findUnique({ where: { id } });
    expect(found?.status).toBe('IN_PROGRESS');
  });

  it('updates it', async () => {
    const id = await createSession();
    const { count } = await prisma.untenanted.onboardingSession.updateMany({
      where: { id },
      data: { llmCallCount: 3 },
    });
    expect(count).toBe(1);
  });

  it('groups documents by type', async () => {
    // המסלול שמזין את מונה המסמכים ב-summary.
    await expect(
      prisma.untenanted.onboardingDocument.groupBy({ by: ['docType'], _count: { _all: true } }),
    ).resolves.toBeInstanceOf(Array);
  });

  describe('these tables are deliberately outside RLS', () => {
    it('is queryable with no tenant context at all', async () => {
      // onboarding קורה *לפני* שיש טננט. אם מישהו יוסיף RLS כאן
      // מתוך הרגל, הבדיקה הזו תיפול — וזו הכוונה.
      await expect(prisma.untenanted.onboardingSession.count()).resolves.toBeGreaterThanOrEqual(0);
    });

    it('contrasts with a tenant table, which still refuses', async () => {
      await expect(prisma.untenanted.customer.count()).rejects.toThrow(/tenant context is not set/i);
    });
  });
});
