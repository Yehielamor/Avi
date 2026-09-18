import { Prisma, PrismaClient } from '@prisma/client';

import { PrismaService } from '../../src/database/prisma.service';
import { BriefService } from '../../src/modules/dashboard/brief.service';

/**
 * תדריך הבוקר מול Postgres אמיתי: גבולות "היום" לפי שעון ישראל, כסף שמחכה,
 * הערכה שלא ממציאה מספר, בידוד טננט ורישום יום פעילות.
 */
describe('BriefService', () => {
  const A = '77777777-0000-0000-0000-00000000000a';
  const B = '77777777-0000-0000-0000-00000000000b';
  let prisma: PrismaService;
  let privileged: PrismaClient;
  let service: BriefService;
  let customer: string;
  let owner: string;

  const DAY = 86_400_000;
  /** צהריים של היום לפי שעון ישראל, בהזזת ימים. בטוח גם בשעון חורף (±1 שעה). */
  const israelNoon = (offsetDays: number) => {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    return new Date(Date.parse(`${d}T12:00:00+03:00`) + offsetDays * DAY);
  };

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();
    service = new BriefService(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  async function cleanup() {
    for (const id of [A, B]) {
      await privileged.$executeRaw`DELETE FROM invoice_line_items WHERE "invoiceId" IN (SELECT id FROM invoices WHERE "tenantId" = ${id}::uuid)`;
      for (const t of ['activity_days', 'public_links', 'quote_lines', 'quotes', 'invoices', 'tasks', 'equipment', 'price_list_items', 'customers', 'users']) {
        await privileged.$executeRawUnsafe(`DELETE FROM ${t} WHERE "tenantId" = $1::uuid`, id);
      }
      await privileged.$executeRaw`DELETE FROM tenants WHERE id = ${id}::uuid`;
    }
  }

  beforeEach(async () => {
    await cleanup();
    for (const [id, sub] of [[A, 'brief-a'], [B, 'brief-b']] as const) {
      await privileged.tenant.create({ data: { id, name: sub, vertical: 'MAINTENANCE', subdomain: sub } });
    }
    customer = (await privileged.customer.create({ data: { tenantId: A, name: 'מסעדה' } })).id;
    owner = (await privileged.user.create({ data: { tenantId: A, email: 'o@b.test', passwordHash: 'x', name: 'בעלים', role: 'OWNER' } })).id;
  });

  const task = (data: Partial<Prisma.TaskUncheckedCreateInput> & { tenantId?: string }) =>
    privileged.task.create({
      data: { tenantId: A, customerId: customer, title: 't', source: 'MANUAL', ...data } as Prisma.TaskUncheckedCreateInput,
    });

  it('lists only visits scheduled for today in Israel, and flags confirmation', async () => {
    await task({ title: 'היום', scheduledStart: israelNoon(0), customerConfirmedAt: new Date() });
    await task({ title: 'אתמול', scheduledStart: israelNoon(-1) });
    await task({ title: 'מחר', scheduledStart: israelNoon(1) });
    await task({ title: 'בוטל', scheduledStart: israelNoon(0), status: 'CANCELLED' });

    const b = await service.brief(A, owner);
    expect(b.today.map((t) => t.title)).toEqual(['היום']);
    expect(b.today[0]).toMatchObject({ confirmed: true, onTheWay: false, customerName: 'מסעדה' });
  });

  it('surfaces reschedule requests on open tasks only', async () => {
    await task({ title: 'פתוח', rescheduleRequest: 'אחה"צ', rescheduleRequestedAt: new Date() });
    await task({ title: 'סגור', status: 'CLOSED', closedAt: new Date(), rescheduleRequest: 'x', rescheduleRequestedAt: new Date() });
    const b = await service.brief(A, owner);
    expect(b.needsReply.reschedules.map((r) => r.title)).toEqual(['פתוח']);
  });

  it('counts approved-but-unscheduled quotes and estimates unbilled closed jobs', async () => {
    await privileged.priceListItem.create({ data: { tenantId: A, code: 'FIX', description: 'תיקון', price: new Prisma.Decimal('400.50') } });
    const open = await task({ status: 'NEW' });
    await privileged.quote.create({
      data: { tenantId: A, customerId: customer, quoteNumber: 1, status: 'APPROVED', totalAmount: new Prisma.Decimal('750.25'), validUntil: israelNoon(10), taskId: open.id },
    });
    await task({
      status: 'CLOSED',
      closedAt: new Date(),
      checklist: [
        { label: 'a', done: true, priceCode: 'FIX' },
        { label: 'b', done: true, priceCode: 'FIX' },
      ],
    });

    const b = await service.brief(A, owner);
    expect(b.moneyWaiting.approvedUnscheduled).toEqual({ count: 1, amount: '750.25' });
    expect(b.moneyWaiting.closedUnbilled).toEqual({ count: 1, estimatedAmount: '400.50' });
  });

  it('gives a maintenance count without an amount when there is no history', async () => {
    await privileged.equipment.create({
      data: { tenantId: A, customerId: customer, kind: 'מזגן', serviceIntervalMonths: 6, createdAt: new Date(Date.now() - 365 * DAY) },
    });
    const b = await service.brief(A, owner);
    expect(b.moneyWaiting.maintenanceDue).toEqual({ count: 1, estimatedAmount: null });
  });

  it('estimates maintenance from past billed equipment jobs', async () => {
    const eq = await privileged.equipment.create({
      data: { tenantId: A, customerId: customer, kind: 'מזגן', serviceIntervalMonths: 6, lastServicedAt: new Date(Date.now() - 200 * DAY) },
    });
    const done = await task({ status: 'CLOSED', closedAt: new Date(Date.now() - 200 * DAY), equipmentId: eq.id });
    const inv = await privileged.invoice.create({
      data: { tenantId: A, customerId: customer, invoiceNumber: 1, periodStart: new Date(), periodEnd: new Date(), totalAmount: new Prisma.Decimal('350') },
    });
    await privileged.invoiceLineItem.create({ data: { invoiceId: inv.id, taskId: done.id, priceCode: 'SVC', description: 'טיפול', amount: new Prisma.Decimal('350') } });

    const b = await service.brief(A, owner);
    expect(b.moneyWaiting.maintenanceDue).toEqual({ count: 1, estimatedAmount: '350.00' });
  });

  it('summarises the last 7 days', async () => {
    await task({ source: 'CUSTOMER_LINK' });
    await task({ source: 'CUSTOMER_LINK', createdAt: new Date(Date.now() - 8 * DAY) });
    await task({ status: 'CLOSED', closedAt: new Date(), customerConfirmedAt: new Date() });
    await privileged.quote.create({
      data: { tenantId: A, customerId: customer, quoteNumber: 1, status: 'APPROVED', approvedAt: new Date(), totalAmount: new Prisma.Decimal('100.10'), validUntil: israelNoon(10) },
    });
    const b = await service.brief(A, owner);
    expect(b.week).toEqual({
      bookedByCustomers: 1,
      quotesApproved: 1,
      quotesApprovedAmount: '100.10',
      visitsConfirmed: 1,
      statusLinksSent: 0,
      jobsClosed: 1,
    });
  });

  it('never includes another tenant’s data', async () => {
    const other = (await privileged.customer.create({ data: { tenantId: B, name: 'זר' } })).id;
    await task({ tenantId: B, customerId: other, scheduledStart: israelNoon(0), rescheduleRequest: 'x', rescheduleRequestedAt: new Date() });
    const b = await service.brief(A, owner);
    expect(b.today).toEqual([]);
    expect(b.needsReply.reschedules).toEqual([]);
  });

  it('records one activity day per user per day, however many times the brief loads', async () => {
    await service.brief(A, owner);
    await service.brief(A, owner);
    expect(await privileged.activityDay.count({ where: { tenantId: A, userId: owner } })).toBe(1);
  });

  it('derives activation from real data', async () => {
    expect((await service.activation(A)).completed).toBe(0);
    await privileged.priceListItem.create({ data: { tenantId: A, code: 'FIX', description: 'x', price: new Prisma.Decimal('1') } });
    await privileged.quote.create({
      data: { tenantId: A, customerId: customer, quoteNumber: 1, status: 'DRAFT', totalAmount: new Prisma.Decimal('1'), validUntil: israelNoon(10) },
    });
    const a = await service.activation(A);
    // טיוטה לא נחשבת "נשלחה".
    expect(a.steps.filter((s) => s.done).map((s) => s.key)).toEqual(['priceList']);
  });
});
