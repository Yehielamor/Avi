import { Prisma, PrismaClient } from '@prisma/client';

import { PrismaService } from '../../src/database/prisma.service';
import { ReportsService } from '../../src/modules/reports/reports.service';

/**
 * דו"ח רווחיות מול Postgres אמיתי: שאילתה אחת עם הרבה מקומות לטעות —
 * גבולות יום לפי שעון ישראל, סימן של תנועת מלאי, חלק בלי עלות, וטננט אחר.
 */
describe('ReportsService.profitability', () => {
  const A = '66666666-0000-0000-0000-00000000000a';
  const B = '66666666-0000-0000-0000-00000000000b';
  let prisma: PrismaService;
  let privileged: PrismaClient;
  let service: ReportsService;
  let customer: string;
  let tech: string;

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();
    service = new ReportsService(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  async function cleanup() {
    for (const id of [A, B]) {
      await privileged.$executeRaw`DELETE FROM invoice_line_items WHERE "invoiceId" IN (SELECT id FROM invoices WHERE "tenantId" = ${id}::uuid)`;
      for (const t of ['invoices', 'stock_movements', 'inventory_items', 'tasks', 'price_list_items', 'customers', 'users']) {
        await privileged.$executeRawUnsafe(`DELETE FROM ${t} WHERE "tenantId" = $1::uuid`, id);
      }
      await privileged.$executeRaw`DELETE FROM tenants WHERE id = ${id}::uuid`;
    }
  }

  beforeEach(async () => {
    await cleanup();
    for (const [id, sub] of [[A, 'rep-a'], [B, 'rep-b']] as const) {
      await privileged.tenant.create({ data: { id, name: sub, vertical: 'MAINTENANCE', subdomain: sub } });
    }
    customer = (await privileged.customer.create({ data: { tenantId: A, name: 'מסעדה' } })).id;
    tech = (await privileged.user.create({ data: { tenantId: A, email: 't@r.test', passwordHash: 'x', name: 'יוסי', role: 'FIELD' } })).id;
    await privileged.priceListItem.create({ data: { tenantId: A, code: 'FIX', description: 'תיקון', price: new Prisma.Decimal('400') } });
  });

  /** משימה סגורה ברגע נתון (UTC), עם חיוב ו/או צריכת חלקים. */
  async function closedTask(closedAt: string, opts: { billed?: string; parts?: Array<{ qty: number; cost: string | null }>; checklist?: unknown; tenantId?: string } = {}) {
    const tenantId = opts.tenantId ?? A;
    const cust = tenantId === A ? customer : (await privileged.customer.create({ data: { tenantId, name: 'x' } })).id;
    const task = await privileged.task.create({
      data: {
        tenantId,
        customerId: cust,
        title: 't',
        source: 'MANUAL',
        status: 'CLOSED',
        closedAt: new Date(closedAt),
        assignedToUserId: tenantId === A ? tech : null,
        checklist: (opts.checklist ?? []) as Prisma.InputJsonValue,
      },
    });
    if (opts.billed) {
      const n = (await privileged.invoice.count({ where: { tenantId } })) + 1;
      const inv = await privileged.invoice.create({
        data: { tenantId, customerId: cust, invoiceNumber: n, periodStart: new Date(), periodEnd: new Date(), totalAmount: new Prisma.Decimal(opts.billed) },
      });
      await privileged.invoiceLineItem.create({
        data: { invoiceId: inv.id, taskId: task.id, priceCode: 'FIX', description: 'תיקון', amount: new Prisma.Decimal(opts.billed) },
      });
    }
    for (const [i, p] of (opts.parts ?? []).entries()) {
      const item = await privileged.inventoryItem.create({
        data: { tenantId, sku: `SKU-${task.id.slice(0, 6)}-${i}`, name: 'חלק', quantity: 10, unitCost: p.cost === null ? null : new Prisma.Decimal(p.cost) },
      });
      await privileged.stockMovement.create({
        data: { tenantId, inventoryItemId: item.id, taskId: task.id, delta: -p.qty, quantityAfter: 10 - p.qty, reason: 'TASK_CONSUMPTION' },
      });
    }
    return task.id;
  }

  it('computes revenue minus parts cost, with consumption counted as a positive cost', async () => {
    await closedTask('2026-09-10T09:00:00Z', { billed: '500.00', parts: [{ qty: 2, cost: '35.50' }] });
    const r = await service.profitability(A, '2026-09-01', '2026-09-30');
    expect(r.total).toMatchObject({ jobs: 1, revenue: '500.00', partsCost: '71.00', grossProfit: '429.00', partial: false });
    expect(r.byTechnician[0]!.key).toBe('יוסי');
  });

  it('marks the result partial when a consumed part has no cost', async () => {
    await closedTask('2026-09-10T09:00:00Z', { billed: '500', parts: [{ qty: 1, cost: null }] });
    const r = await service.profitability(A, '2026-09-01', '2026-09-30');
    expect(r.total).toMatchObject({ partsCost: '0.00', partial: true });
  });

  it('estimates an unbilled job from its checklist and says so', async () => {
    await closedTask('2026-09-10T09:00:00Z', {
      checklist: [
        { label: 'a', done: true, priceCode: 'FIX' },
        { label: 'b', done: false, priceCode: 'FIX' },
        // אותו קוד פעמיים — מחויב פעם אחת, כמו בחשבונית.
        { label: 'c', done: true, priceCode: 'FIX' },
      ],
    });
    const r = await service.profitability(A, '2026-09-01', '2026-09-30');
    expect(r.total).toMatchObject({ revenue: '400.00', hasEstimates: true });
  });

  it('uses Israel day boundaries, not UTC', async () => {
    // 30.9 בשעה 23:30 בישראל (UTC+3) = 20:30Z — שייך לספטמבר.
    await closedTask('2026-09-30T20:30:00Z', { billed: '100' });
    // 1.10 בשעה 00:30 בישראל = 30.9 21:30Z — כבר אוקטובר, אף שב-UTC זה עוד ספטמבר.
    await closedTask('2026-09-30T21:30:00Z', { billed: '999' });
    const r = await service.profitability(A, '2026-09-01', '2026-09-30');
    expect(r.total).toMatchObject({ jobs: 1, revenue: '100.00' });
  });

  it('never includes another tenant’s jobs', async () => {
    await closedTask('2026-09-10T09:00:00Z', { billed: '100' });
    await closedTask('2026-09-10T09:00:00Z', { billed: '5000', tenantId: B });
    const r = await service.profitability(A, '2026-09-01', '2026-09-30');
    expect(r.total).toMatchObject({ jobs: 1, revenue: '100.00' });
  });

  it('gives two different customers and technicians with the same name their own rows (QA F6)', async () => {
    const first = await closedTask('2026-09-10T09:00:00Z', { billed: '1000' });
    const second = await closedTask('2026-09-11T09:00:00Z', { billed: '200' });
    const twinCustomer = (await privileged.customer.create({ data: { tenantId: A, name: 'מסעדה' } })).id;
    const twinTech = (
      await privileged.user.create({ data: { tenantId: A, email: 't2@r.test', passwordHash: 'x', name: 'יוסי', role: 'FIELD' } })
    ).id;
    await privileged.task.update({ where: { id: second }, data: { customerId: twinCustomer, assignedToUserId: twinTech } });

    const r = await service.profitability(A, '2026-09-01', '2026-09-30');
    expect(r.byCustomer.map((l) => [l.id, l.key, l.revenue])).toEqual([
      [customer, 'מסעדה', '1000.00'],
      [twinCustomer, 'מסעדה', '200.00'],
    ]);
    expect(r.byTechnician.map((l) => [l.id, l.key, l.jobs])).toEqual([
      [tech, 'יוסי', 1],
      [twinTech, 'יוסי', 1],
    ]);
    expect(r.total).toMatchObject({ id: null, jobs: 2 });
    expect(first).toBeDefined();
  });

  it('returns no total for an empty period', async () => {
    expect((await service.profitability(A, '2026-01-01', '2026-01-31')).total).toBeNull();
  });
});
