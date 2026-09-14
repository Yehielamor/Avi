import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service';

/**
 * בדיקות למספרי הסקירה.
 *
 * הם נראים תמימים — ספירות — אבל כל אחד מהם הוא שאילתה גולמית עם
 * גבול חודש, אזור זמן וסינון טננט. שגיאה כאן לא מפילה כלום: היא
 * פשוט מציגה מספר שגוי, שאיש לא יבחין בו.
 *
 * שני הדברים שנבדקים במפורש:
 *   • בידוד — הספירות של טננט אחד אינן כוללות את השני
 *   • גבול החודש — עבודה מהחודש שעבר אינה נספרת בחודש הזה
 */
describe('DashboardService', () => {
  const A = '55555555-5555-5555-5555-555555555555';
  const B = '66666666-6666-6666-6666-666666666666';

  let prisma: PrismaService;
  let privileged: PrismaClient;
  let service: DashboardService;

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();
    service = new DashboardService(prisma);
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  async function cleanup(): Promise<void> {
    for (const id of [A, B]) {
      await privileged.$executeRaw`DELETE FROM tasks WHERE "tenantId" = ${id}::uuid`;
      await privileged.$executeRaw`DELETE FROM inventory_items WHERE "tenantId" = ${id}::uuid`;
      await privileged.$executeRaw`DELETE FROM customers WHERE "tenantId" = ${id}::uuid`;
      await privileged.$executeRaw`DELETE FROM tenants WHERE id = ${id}::uuid`;
    }
  }

  async function seed(): Promise<void> {
    await cleanup();

    for (const [id, sub] of [
      [A, 'dash-a'],
      [B, 'dash-b'],
    ] as const) {
      await privileged.$executeRaw`
        INSERT INTO tenants (id, name, vertical, subdomain, "isActive", "createdAt", "updatedAt")
        VALUES (${id}::uuid, ${sub}, 'MAINTENANCE', ${sub}, true, now(), now())
      `;
      await privileged.$executeRaw`
        INSERT INTO customers (id, "tenantId", name, "isActive", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), ${id}::uuid, 'c', true, now(), now())
      `;
    }

    const custA = await privileged.customer.findFirstOrThrow({ where: { tenantId: A } });
    const custB = await privileged.customer.findFirstOrThrow({ where: { tenantId: B } });

    const task = (tenantId: string, customerId: string, opts: {
      status: string; priority?: number; assigned?: boolean; createdAgo?: string; closedAgo?: string;
    }) => privileged.$executeRawUnsafe(
      `INSERT INTO tasks (id,"tenantId","customerId",title,status,priority,source,
         "assignedToUserId","createdAt","updatedAt","closedAt")
       VALUES (gen_random_uuid(),$1::uuid,$2::uuid,'t',$3::"TaskStatus",$4,'MANUAL',
         NULL, now() - $5::interval, now(), ${opts.closedAgo ? `now() - '${opts.closedAgo}'::interval` : 'NULL'})`,
      tenantId, customerId, opts.status, opts.priority ?? 2, opts.createdAgo ?? '1 hour',
    );

    // טננט A: 2 פתוחות (אחת דחופה וישנה), 1 סגורה החודש, 1 סגורה בחודש שעבר
    await task(A, custA.id, { status: 'NEW' });
    await task(A, custA.id, { status: 'IN_PROGRESS', priority: 1, createdAgo: '30 hours' });
    await task(A, custA.id, { status: 'CLOSED', closedAgo: '1 hour' });
    await task(A, custA.id, { status: 'CLOSED', createdAgo: '45 days', closedAgo: '40 days' });

    // טננט B: נתונים משלו, שאסור שידלפו ל-A
    await task(B, custB.id, { status: 'NEW' });
    await task(B, custB.id, { status: 'NEW' });

    await privileged.$executeRaw`
      INSERT INTO inventory_items (id,"tenantId",sku,name,quantity,"lowStockThreshold","isActive","createdAt","updatedAt")
      VALUES (gen_random_uuid(), ${A}::uuid, 'LOW', 'low', 1, 5, true, now(), now()),
             (gen_random_uuid(), ${A}::uuid, 'OK',  'ok',  50, 5, true, now(), now()),
             (gen_random_uuid(), ${B}::uuid, 'B-LOW', 'b',  0, 9, true, now(), now())
    `;
  }

  it('counts only open tasks', async () => {
    const stats = await service.getStats(A);
    expect(stats.openTasks).toBe(2);
  });

  it('does not count another tenant’s work', async () => {
    // טננט B יצר שתי משימות פתוחות. אם הן נספרות כאן, הסינון שבור.
    const a = await service.getStats(A);
    const b = await service.getStats(B);
    expect(a.openTasks).toBe(2);
    expect(b.openTasks).toBe(2);
    expect(b.lowStockItems).toBe(1);
  });

  it('excludes work closed in a previous month', async () => {
    // הבדיקה שתופס טעות באזור זמן או בגבול החודש.
    const stats = await service.getStats(A);
    expect(stats.closedThisMonth).toBe(1);
  });

  it('counts urgent work still open after 24 hours', async () => {
    const stats = await service.getStats(A);
    expect(stats.overdueUrgent).toBe(1);
  });

  it('counts only items at or below their own threshold', async () => {
    // הסף הוא לכל פריט, לא קבוע. פריט עם 50 יחידות וסף 5 אינו בחוסר.
    const stats = await service.getStats(A);
    expect(stats.lowStockItems).toBe(1);
  });

  it('returns revenue as a string, never a float', async () => {
    const stats = await service.getStats(A);
    // מעבר ב-float היה מכניס שגיאת עיגול לסכום כספי.
    expect(typeof stats.revenueThisMonth).toBe('string');
    expect(stats.revenueThisMonth).toMatch(/^\d+(\.\d+)?$/);
  });
});
