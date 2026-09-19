import { Prisma, PrismaClient, UserRole } from '@prisma/client';

import { PrismaService } from '../../src/database/prisma.service';
import { FieldRouteService } from '../../src/modules/field-route/field-route.service';

/**
 * "היום שלי" מול Postgres אמיתי: רק המשימות של המשתמש, גבולות יום לפי
 * שעון ישראל, סדר נסיעה, ולימוד מיקום שלא דורס מיקום קיים.
 */
describe('FieldRouteService', () => {
  const A = '88888888-0000-0000-0000-00000000000a';
  const B = '88888888-0000-0000-0000-00000000000b';
  let prisma: PrismaService;
  let privileged: PrismaClient;
  let service: FieldRouteService;
  let tech: string;
  let other: string;
  let customer: string;

  const DAY = 86_400_000;
  const israelDate = (offsetDays = 0) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(Date.now() + offsetDays * DAY));
  /** שעה ביום בישראל (IDT +03:00; בחורף השעה זזה בשעה אחת — עדיין אותו יום). */
  const at = (offsetDays: number, hour: number) =>
    new Date(Date.parse(`${israelDate(offsetDays)}T${String(hour).padStart(2, '0')}:00:00+03:00`));

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();
    service = new FieldRouteService(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  async function cleanup() {
    for (const id of [A, B]) {
      for (const t of ['audit_logs', 'tasks', 'customers', 'users']) {
        await privileged.$executeRawUnsafe(`DELETE FROM ${t} WHERE "tenantId" = $1::uuid`, id);
      }
      await privileged.$executeRaw`DELETE FROM tenants WHERE id = ${id}::uuid`;
    }
  }

  beforeEach(async () => {
    await cleanup();
    for (const [id, sub] of [[A, 'route-a'], [B, 'route-b']] as const) {
      await privileged.tenant.create({ data: { id, name: sub, vertical: 'MAINTENANCE', subdomain: sub } });
    }
    tech = (await privileged.user.create({ data: { tenantId: A, email: 't@r.test', passwordHash: 'x', name: 'יוסי', role: 'FIELD' } })).id;
    other = (await privileged.user.create({ data: { tenantId: A, email: 'o@r.test', passwordHash: 'x', name: 'דני', role: 'FIELD' } })).id;
    customer = (await privileged.customer.create({ data: { tenantId: A, name: 'מסעדה', address: 'הרצל 1 חיפה' } })).id;
  });

  const task = (data: Partial<Prisma.TaskUncheckedCreateInput>) =>
    privileged.task.create({
      data: { tenantId: A, customerId: customer, title: 't', source: 'MANUAL', status: 'ASSIGNED', assignedToUserId: tech, ...data },
    });

  it('shows my visits today in time order, then unscheduled open jobs, and never someone else’s', async () => {
    await task({ title: '14:00', scheduledStart: at(0, 14) });
    await task({ title: '09:00', scheduledStart: at(0, 9) });
    await task({ title: 'בלי מועד' });
    await task({ title: 'מחר', scheduledStart: at(1, 9) });
    await task({ title: 'של דני', scheduledStart: at(0, 10), assignedToUserId: other });
    await task({ title: 'בוטל', scheduledStart: at(0, 11), status: 'CANCELLED' });

    const r = await service.myDay(A, tech);
    expect(r.isToday).toBe(true);
    expect(r.stops.map((s) => s.title)).toEqual(['09:00', '14:00', 'בלי מועד']);
  });

  it('puts an open job from a past day first and flags it overdue', async () => {
    await task({ title: 'היום', scheduledStart: at(0, 9) });
    await task({ title: 'אתמול', scheduledStart: at(-1, 9) });
    const r = await service.myDay(A, tech);
    expect(r.stops.map((s) => [s.title, s.overdue])).toEqual([['אתמול', true], ['היום', false]]);
  });

  it('lists jobs finished today separately from what is still ahead', async () => {
    await task({ title: 'נסגר', scheduledStart: at(0, 8), status: 'CLOSED', closedAt: new Date() });
    await task({ title: 'פתוח', scheduledStart: at(0, 12) });
    const r = await service.myDay(A, tech);
    expect(r.stops.map((s) => s.title)).toEqual(['פתוח']);
    expect(r.done.map((s) => s.title)).toEqual(['נסגר']);
  });

  it('shows only that day for another date, without unscheduled work', async () => {
    await task({ title: 'מחר', scheduledStart: at(1, 9) });
    await task({ title: 'בלי מועד' });
    const r = await service.myDay(A, tech, israelDate(1));
    expect(r).toMatchObject({ isToday: false });
    expect(r.stops.map((s) => s.title)).toEqual(['מחר']);
  });

  it('builds a Waze link from coordinates, falling back to the address', async () => {
    const located = (await privileged.customer.create({ data: { tenantId: A, name: 'x', lat: 32.8, lng: 35 } })).id;
    await task({ title: 'עם מיקום', customerId: located, scheduledStart: at(0, 9) });
    await task({ title: 'רק כתובת', scheduledStart: at(0, 10) });
    const [first, second] = (await service.myDay(A, tech)).stops;
    expect(first!.wazeUrl).toBe('https://waze.com/ul?ll=32.800000,35.000000&navigate=yes');
    expect(second!.wazeUrl).toContain('q=%D7%94%D7%A8%D7%A6%D7%9C');
  });

  it('keeps each tenant apart', async () => {
    const cB = (await privileged.customer.create({ data: { tenantId: B, name: 'זר' } })).id;
    await privileged.task.create({ data: { tenantId: B, customerId: cB, title: 'B', source: 'MANUAL', scheduledStart: at(0, 9) } });
    expect((await service.myDay(A, tech)).stops).toEqual([]);
  });

  describe('learnSiteLocation', () => {
    const actor = () => ({ id: tech, role: UserRole.FIELD });

    it('saves an accurate location to a customer who has none', async () => {
      const t = await task({});
      await expect(service.learnSiteLocation(A, t.id, { lat: 32.79, lng: 34.99, accuracyM: 20 }, actor())).resolves.toEqual({ saved: true, reason: null });
      expect(await privileged.customer.findUnique({ where: { id: customer } })).toMatchObject({ lat: 32.79, lng: 34.99 });
    });

    it('never overwrites a known location', async () => {
      await privileged.customer.update({ where: { id: customer }, data: { lat: 31, lng: 34 } });
      const t = await task({});
      const r = await service.learnSiteLocation(A, t.id, { lat: 32.79, lng: 34.99, accuracyM: 5 }, actor());
      expect(r).toEqual({ saved: false, reason: 'already_known' });
      expect(await privileged.customer.findUnique({ where: { id: customer } })).toMatchObject({ lat: 31, lng: 34 });
    });

    it('ignores an inaccurate fix', async () => {
      const t = await task({});
      expect(await service.learnSiteLocation(A, t.id, { lat: 32.79, lng: 34.99, accuracyM: 800 }, actor())).toEqual({ saved: false, reason: 'inaccurate' });
      expect((await privileged.customer.findUnique({ where: { id: customer } }))!.lat).toBeNull();
    });

    it('refuses another technician’s task with 404', async () => {
      const t = await task({ assignedToUserId: other });
      await expect(service.learnSiteLocation(A, t.id, { lat: 32, lng: 35, accuracyM: 5 }, actor())).rejects.toMatchObject({ status: 404 });
    });
  });
});
