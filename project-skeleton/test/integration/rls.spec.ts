import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';

/**
 * בדיקת בידוד הטננטים.
 *
 * הקובץ rls-policies.sql הישן קרא לבדיקה הזו "קריטית ל-CI" בהערה
 * משלו — והיא מעולם לא נכתבה. בדיוק בגלל זה אף אחד לא שם לב שכל
 * ה-policies היו קוד מת: הן הופעלו על טבלאות שהאפליקציה *הייתה
 * הבעלים שלהן*, ו-Postgres פוטר בעלים מה-policies שלו עצמו.
 *
 * הבדיקות כאן רצות כ-craftmind_app מול Postgres אמיתי. הן נכשלות
 * אם מישהו:
 *   • מוסיף טבלה עם tenantId בלי policy
 *   • מחזיר את DATABASE_URL לתפקיד ה-migrator
 *   • מסיר FORCE ROW LEVEL SECURITY
 *   • מריץ שאילתה מחוץ ל-forTenant()
 */

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

// כל הטבלאות שחייבות להיות מוגנות. הרשימה מפורשת בכוונה: טבלה
// חדשה עם tenantId שלא נוספה לכאן *וגם* למיגרציה לא תיתפס אחרת.
const TENANT_SCOPED_TABLES = [
  'tenant_configs',
  'job_type_templates',
  'users',
  'customers',
  'tasks',
  'inventory_items',
  'stock_movements',
  'price_list_items',
  'invoices',
  'tenant_integrations',
  'audit_logs',
  'outbox_events',
  'idempotency_keys',
  'llm_usage',
  'tenants',
  'invoice_line_items',
] as const;

describe('Row-Level Security — tenant isolation', () => {
  let prisma: PrismaService;
  /** תפקיד ה-migrator: בעל הטבלאות. משמש רק להכנת הזירה. */
  let privileged: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    privileged = new PrismaClient({
      datasources: { db: { url: process.env.DIRECT_DATABASE_URL } },
    });
    await privileged.$connect();

    await seedTwoTenants();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  async function seedTwoTenants(): Promise<void> {
    await cleanup();
    await privileged.$executeRaw`
      INSERT INTO tenants (id, name, vertical, subdomain, "isActive", "createdAt", "updatedAt")
      VALUES (${TENANT_A}::uuid, 'Tenant A', 'MAINTENANCE', 'rls-test-a', true, now(), now()),
             (${TENANT_B}::uuid, 'Tenant B', 'CARPENTRY',   'rls-test-b', true, now(), now())
    `;
    await privileged.$executeRaw`
      INSERT INTO customers (id, "tenantId", name, email, "isActive", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${TENANT_A}::uuid, 'Customer of A', 'a@example.com', true, now(), now()),
             (gen_random_uuid(), ${TENANT_B}::uuid, 'Customer of B', 'b@example.com', true, now(), now())
    `;
  }

  async function cleanup(): Promise<void> {
    await privileged.$executeRaw`
      DELETE FROM customers WHERE "tenantId" IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)
    `;
    await privileged.$executeRaw`
      DELETE FROM tenants WHERE id IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)
    `;
  }

  // ---------------------------------------------------------------------------

  describe('database configuration', () => {
    it('connects as a role that is NOT the table owner', async () => {
      const rows =
        await prisma.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`;
      expect(rows[0]!.current_user).toBe('craftmind_app');
    });

    it('connects as a role that cannot bypass RLS', async () => {
      const [row] = await prisma.$queryRaw<Array<{ rolbypassrls: boolean; rolsuper: boolean }>>`
        SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user
      `;
      // אם אחד מאלה true, כל שאר הקובץ הזה חסר משמעות.
      expect(row!.rolbypassrls).toBe(false);
      expect(row!.rolsuper).toBe(false);
    });

    it.each(TENANT_SCOPED_TABLES)('table %s has RLS enabled AND forced', async (table) => {
      const [row] = await prisma.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
        SELECT relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE oid = ${`public.${table}`}::regclass
      `;
      expect(row!.relrowsecurity).toBe(true);
      // בלי FORCE, בעל הטבלה פטור — וזה היה הבאג המקורי.
      expect(row!.relforcerowsecurity).toBe(true);
    });

    it.each(TENANT_SCOPED_TABLES)('table %s has a policy with WITH CHECK', async (table) => {
      const rows = await prisma.$queryRaw<Array<{ policyname: string; with_check: string | null }>>`
        SELECT policyname, with_check FROM pg_policies
        WHERE schemaname = 'public' AND tablename = ${table}
      `;
      expect(rows.length).toBeGreaterThan(0);
      // USING לבדו מסנן קריאה בלבד; בלי WITH CHECK אפשר לכתוב
      // שורה עם tenantId של טננט אחר.
      expect(rows.some((r) => r.with_check !== null)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------

  describe('read isolation', () => {
    it('tenant A sees only its own customers', async () => {
      const names = await prisma.forTenant(TENANT_A, (tx) =>
        tx.customer.findMany({ select: { name: true } }),
      );
      expect(names.map((c) => c.name)).toEqual(['Customer of A']);
    });

    it('tenant B sees only its own customers', async () => {
      const names = await prisma.forTenant(TENANT_B, (tx) =>
        tx.customer.findMany({ select: { name: true } }),
      );
      expect(names.map((c) => c.name)).toEqual(['Customer of B']);
    });

    it("an explicit WHERE on another tenant's id returns nothing", async () => {
      // זו ההתקפה מ-audit C2/C3: שאילתה שאיבדה את סינון הטננט
      // בקוד האפליקציה. ה-DB חייב לעצור אותה.
      const leaked = await prisma.forTenant(TENANT_A, (tx) =>
        tx.customer.findMany({ where: { tenantId: TENANT_B } }),
      );
      expect(leaked).toHaveLength(0);
    });

    it("findUnique by another tenant's row id returns null", async () => {
      const victim = await privileged.customer.findFirstOrThrow({
        where: { tenantId: TENANT_B },
      });
      const stolen = await prisma.forTenant(TENANT_A, (tx) =>
        tx.customer.findUnique({ where: { id: victim.id } }),
      );
      expect(stolen).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------

  describe('write isolation', () => {
    it("rejects an INSERT tagged with another tenant's id", async () => {
      await expect(
        prisma.forTenant(TENANT_A, (tx) =>
          tx.customer.create({
            data: { tenantId: TENANT_B, name: 'Injected by A' },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("an UPDATE targeting another tenant's row affects zero rows", async () => {
      const result = await prisma.forTenant(TENANT_A, (tx) =>
        tx.customer.updateMany({
          where: { tenantId: TENANT_B },
          data: { name: 'HIJACKED' },
        }),
      );
      expect(result.count).toBe(0);

      const victim = await privileged.customer.findFirstOrThrow({ where: { tenantId: TENANT_B } });
      expect(victim.name).toBe('Customer of B');
    });

    it("a DELETE targeting another tenant's row affects zero rows", async () => {
      const result = await prisma.forTenant(TENANT_A, (tx) =>
        tx.customer.deleteMany({ where: { tenantId: TENANT_B } }),
      );
      expect(result.count).toBe(0);
      expect(await privileged.customer.count({ where: { tenantId: TENANT_B } })).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------

  describe('fail-closed behaviour', () => {
    it('throws loudly when a query runs with no tenant context', async () => {
      // כשל שקט (אפס שורות) נראה בדיוק כמו "אין נתונים" ושורד שנים.
      // הפונקציה current_tenant_id() זורקת במכוון.
      await expect(prisma.customer.findMany()).rejects.toThrow(/tenant context is not set/i);
    });

    it('rejects a non-UUID tenantId before reaching the database', async () => {
      await expect(
        prisma.forTenant("' OR '1'='1", async (tx) => tx.customer.findMany()),
      ).rejects.toThrow(/non-UUID tenantId/);
    });

    it('resets the context after the transaction ends', async () => {
      await prisma.forTenant(TENANT_A, (tx) => tx.customer.findMany());
      // set_config(..., true) הוא transaction-local. אם הוא היה
      // session-level, החיבור היה חוזר ל-pool "מזוהם".
      await expect(prisma.customer.findMany()).rejects.toThrow(/tenant context is not set/i);
    });
  });

  // ---------------------------------------------------------------------------

  describe('subdomain resolution', () => {
    it('resolves a known subdomain without any tenant context', async () => {
      expect(await prisma.resolveTenantBySubdomain('rls-test-a')).toBe(TENANT_A);
    });

    it('returns null for an unknown subdomain', async () => {
      expect(await prisma.resolveTenantBySubdomain('does-not-exist')).toBeNull();
    });

    it('returns null for an inactive tenant', async () => {
      await privileged.$executeRaw`UPDATE tenants SET "isActive" = false WHERE id = ${TENANT_A}::uuid`;
      expect(await prisma.resolveTenantBySubdomain('rls-test-a')).toBeNull();
      await privileged.$executeRaw`UPDATE tenants SET "isActive" = true WHERE id = ${TENANT_A}::uuid`;
    });
  });
});
