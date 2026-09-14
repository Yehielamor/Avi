import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';

/**
 * בדיקות ה-outbox.
 *
 * הן מכסות שלוש תכונות שבלעדיהן התור מזיק יותר מתועיל, וכולן נבדקות
 * מול Postgres אמיתי כי כולן נאכפות ב-DB ולא בקוד:
 *
 *   1. הבידוד עדיין תקף. הפונקציות SECURITY DEFINER שנוספו למען
 *      העובד הן חור פוטנציאלי — הבדיקות מוודאות שהן חושפות בדיוק
 *      את מה שהן אמורות ולא יותר.
 *   2. שני מופעים לא תופסים את אותה שורה (FOR UPDATE SKIP LOCKED).
 *   3. אירוע נכתב באותה טרנזקציה כמו השינוי העסקי — או ששניהם
 *      קורים או שאף אחד.
 */

const TENANT_A = '33333333-3333-3333-3333-333333333333';
const TENANT_B = '44444444-4444-4444-4444-444444444444';

interface ClaimedRow {
  id: string;
  tenant_id: string;
  event_name: string;
  payload: unknown;
  attempts: number;
}

describe('Outbox dispatch', () => {
  let prisma: PrismaService;
  let privileged: PrismaClient;

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  beforeEach(async () => {
    await privileged.$executeRaw`
      DELETE FROM outbox_events WHERE "tenantId" IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)
    `;
  });

  async function seed(): Promise<void> {
    await cleanup();
    await privileged.$executeRaw`
      INSERT INTO tenants (id, name, vertical, subdomain, "isActive", "createdAt", "updatedAt")
      VALUES (${TENANT_A}::uuid, 'Outbox A', 'MAINTENANCE', 'outbox-test-a', true, now(), now()),
             (${TENANT_B}::uuid, 'Outbox B', 'CARPENTRY',   'outbox-test-b', true, now(), now())
    `;
  }

  async function cleanup(): Promise<void> {
    await privileged.$executeRaw`
      DELETE FROM outbox_events WHERE "tenantId" IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)
    `;
    await privileged.$executeRaw`
      DELETE FROM tenants WHERE id IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)
    `;
  }

  const claim = (limit: number) =>
    prisma.untenanted.$queryRaw<ClaimedRow[]>`SELECT * FROM public.claim_outbox_batch(${limit}::int)`;

  async function writeEvent(tenantId: string, eventName: string): Promise<string> {
    const id = randomUUID();
    await privileged.$executeRaw`
      INSERT INTO outbox_events (id, "tenantId", "eventName", payload, status, attempts, "nextAttemptAt", "createdAt")
      VALUES (${id}::uuid, ${tenantId}::uuid, ${eventName}, '{"taskId":"x"}'::jsonb, 'PENDING', 0, now(), now())
    `;
    return id;
  }

  // ---------------------------------------------------------------------------

  describe('claim_outbox_batch', () => {
    it('claims pending events across tenants and marks them PROCESSING', async () => {
      await writeEvent(TENANT_A, 'task.created');
      await writeEvent(TENANT_B, 'task.closed');

      const claimed = await claim(10);
      const ours = claimed.filter((r) => [TENANT_A, TENANT_B].includes(r.tenant_id));

      // חוצה טננטים במכוון — זו כל מטרת הפונקציה.
      expect(ours).toHaveLength(2);
      expect(new Set(ours.map((r) => r.tenant_id))).toEqual(new Set([TENANT_A, TENANT_B]));

      const rows = await privileged.outboxEvent.findMany({
        where: { id: { in: ours.map((r) => r.id) } },
        select: { status: true },
      });
      expect(rows.every((r) => r.status === 'PROCESSING')).toBe(true);
    });

    it('does not return the same row twice', async () => {
      await writeEvent(TENANT_A, 'task.created');

      const first = (await claim(10)).filter((r) => r.tenant_id === TENANT_A);
      const second = (await claim(10)).filter((r) => r.tenant_id === TENANT_A);

      expect(first).toHaveLength(1);
      // אחרי התפיסה השורה כבר PROCESSING, ולכן היא מחוץ לקריטריון.
      // זה מה שמונע עיבוד כפול בין שני מופעים.
      expect(second).toHaveLength(0);
    });

    it('skips events whose nextAttemptAt is in the future', async () => {
      const id = await writeEvent(TENANT_A, 'task.created');
      await privileged.$executeRaw`
        UPDATE outbox_events SET "nextAttemptAt" = now() + interval '1 hour' WHERE id = ${id}::uuid
      `;

      const claimed = (await claim(10)).filter((r) => r.tenant_id === TENANT_A);
      expect(claimed).toHaveLength(0);
    });

    it('honours the batch limit', async () => {
      for (let i = 0; i < 5; i++) await writeEvent(TENANT_A, 'task.created');

      const claimed = (await claim(2)).filter((r) => r.tenant_id === TENANT_A);
      expect(claimed).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------

  describe('settle_outbox_event', () => {
    it('marks an event DONE and stamps processedAt', async () => {
      const id = await writeEvent(TENANT_A, 'task.closed');
      await claim(10);

      await prisma.untenanted
        .$executeRaw`SELECT public.settle_outbox_event(${id}::uuid, 'DONE', NULL, NULL, NULL)`;

      const row = await privileged.outboxEvent.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('DONE');
      expect(row.processedAt).not.toBeNull();
    });

    it('records the error and attempt count on failure', async () => {
      const id = await writeEvent(TENANT_A, 'task.closed');
      await claim(10);

      await prisma.untenanted.$executeRaw`
        SELECT public.settle_outbox_event(${id}::uuid, 'DEAD', ${5}::int, ${'boom'}, NULL)
      `;

      const row = await privileged.outboxEvent.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('DEAD');
      expect(row.attempts).toBe(5);
      expect(row.lastError).toBe('boom');
    });

    it('rejects a status outside the enum', async () => {
      const id = await writeEvent(TENANT_A, 'task.closed');
      await expect(
        prisma.untenanted.$executeRaw`SELECT public.settle_outbox_event(${id}::uuid, 'NONSENSE', NULL, NULL, NULL)`,
      ).rejects.toThrow(/invalid outbox status/i);
    });
  });

  // ---------------------------------------------------------------------------

  describe('the SECURITY DEFINER functions do not widen access', () => {
    it('still blocks a normal cross-tenant read of outbox_events', async () => {
      await writeEvent(TENANT_A, 'task.created');

      // הפונקציות נוספו עבור העובד. הן לא אמורות לפתוח את הטבלה
      // לקוד רגיל — ובלי הבדיקה הזו, רגרסיה כאן הייתה שקטה.
      await expect(prisma.outboxEvent.findMany()).rejects.toThrow(/tenant context is not set/i);
    });

    it("does not let tenant A read tenant B's events through forTenant", async () => {
      await writeEvent(TENANT_B, 'task.closed');

      const seen = await prisma.forTenant(TENANT_A, (tx) => tx.outboxEvent.findMany());
      expect(seen).toHaveLength(0);
    });

    it('list_intake_tenants returns ids only, never tokens', async () => {
      const rows = await prisma.untenanted.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM public.list_intake_tenants('GMAIL')
      `;
      for (const row of rows) {
        // אם מישהו יוסיף עמודות לפונקציה, זה ייכשל — וזו הכוונה.
        expect(Object.keys(row)).toEqual(['tenant_id']);
      }
    });
  });

  // ---------------------------------------------------------------------------

  describe('transactional write', () => {
    it('does not leave an event behind when the transaction rolls back', async () => {
      // זו כל הסיבה לקיום ה-outbox: האירוע והשינוי העסקי חולקים
      // גורל. אם הטרנזקציה נכשלת, אסור שיישלח מייל על משימה שלא נסגרה.
      await expect(
        prisma.forTenant(TENANT_A, async (tx) => {
          await tx.outboxEvent.create({
            data: { tenantId: TENANT_A, eventName: 'task.closed', payload: { taskId: 'x' } },
          });
          throw new Error('business logic failed');
        }),
      ).rejects.toThrow('business logic failed');

      const count = await privileged.outboxEvent.count({ where: { tenantId: TENANT_A } });
      expect(count).toBe(0);
    });
  });
});
