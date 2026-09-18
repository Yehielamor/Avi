import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import type { AppEnv } from '../../src/config/env.schema';
import { PrismaService } from '../../src/database/prisma.service';
import { EquipmentService, israelToday } from '../../src/modules/equipment/equipment.service';
import { PublicLinkService } from '../../src/modules/public-links/public-link.service';
import { TasksService } from '../../src/modules/tasks/tasks.service';

/**
 * תחזוקה מונעת, מול Postgres אמיתי.
 *
 * הרשימה "מגיע לטיפול" היא הבטחה לבעל העסק: כל מי שכאן באמת צריך טיפול,
 * ואף אחד שכבר טופל או שכבר יש לו משימה פתוחה. טעות לכאן או לכאן היא
 * לקוח שמקבל תזכורת מביכה, או הכנסה שלא נוצרה.
 */
describe('EquipmentService', () => {
  const A = '88888888-0000-0000-0000-00000000000a';
  const B = '88888888-0000-0000-0000-00000000000b';

  let prisma: PrismaService;
  let privileged: PrismaClient;
  let service: EquipmentService;
  let tasks: TasksService;
  let customerA: string;
  let ACTOR: string;

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const tokenOf = (url: string) => url.split('/').pop()!;
  const dayFromToday = (n: number) => {
    const d = new Date(`${israelToday()}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();
    const config = new ConfigService({ PUBLIC_APP_URL: 'https://example.test' }) as unknown as ConfigService<AppEnv, true>;
    service = new EquipmentService(prisma, new PublicLinkService(prisma, config));
    tasks = new TasksService(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  async function cleanup() {
    for (const id of [A, B]) {
      for (const t of ['audit_logs', 'outbox_events', 'public_links', 'tasks', 'equipment', 'customers', 'users']) {
        await privileged.$executeRawUnsafe(`DELETE FROM ${t} WHERE "tenantId" = $1::uuid`, id);
      }
      await privileged.$executeRaw`DELETE FROM tenants WHERE id = ${id}::uuid`;
    }
  }

  beforeEach(async () => {
    await cleanup();
    for (const [id, sub] of [[A, 'eq-a'], [B, 'eq-b']] as const) {
      await privileged.tenant.create({ data: { id, name: `עסק ${sub}`, vertical: 'MAINTENANCE', subdomain: sub } });
    }
    customerA = (await privileged.customer.create({ data: { tenantId: A, name: 'לקוח', phone: '0521234567' } })).id;
    ACTOR = (
      await privileged.user.create({ data: { tenantId: A, email: 'owner@eq-a.test', passwordHash: 'x', name: 'בעלים', role: 'OWNER' } })
    ).id;
  });

  const eq = (data: { lastServicedAt?: Date | null; createdAt?: Date; interval?: number; isActive?: boolean; tenantId?: string }) =>
    privileged.equipment.create({
      data: {
        tenantId: data.tenantId ?? A,
        customerId: customerA,
        kind: 'מזגן',
        serviceIntervalMonths: data.interval ?? 6,
        lastServicedAt: data.lastServicedAt ?? null,
        isActive: data.isActive ?? true,
        ...(data.createdAt && { createdAt: data.createdAt }),
      },
    });

  describe('due list', () => {
    it('includes what is overdue and what falls due within the window, and nothing else', async () => {
      const overdue = await eq({ lastServicedAt: daysAgo(200) });
      const soon = await eq({ lastServicedAt: daysAgo(175) }); // ~6 חודשים פחות 7 ימים
      await eq({ lastServicedAt: daysAgo(30) }); // טופל לאחרונה

      const due = await service.due(A, 14);
      expect(due.map((d) => d.equipmentId).sort()).toEqual([overdue.id, soon.id].sort());
      expect(due[0]!.equipmentId).toBe(overdue.id); // הכי דחוף ראשון
      expect(due[0]!.daysOverdue).toBeGreaterThan(0);
    });

    it('measures never-serviced equipment from when it was added', async () => {
      await eq({ createdAt: daysAgo(5) }); // חדש — לא אמור להופיע
      const old = await eq({ createdAt: daysAgo(400) });
      expect((await service.due(A, 14)).map((d) => d.equipmentId)).toEqual([old.id]);
    });

    it('leaves out equipment that already has an open task', async () => {
      const e = await eq({ lastServicedAt: daysAgo(400) });
      await privileged.task.create({
        data: { tenantId: A, customerId: customerA, equipmentId: e.id, title: 't', source: 'MANUAL' },
      });
      expect(await service.due(A, 14)).toEqual([]);
    });

    it('leaves out inactive equipment and other tenants', async () => {
      await eq({ lastServicedAt: daysAgo(400), isActive: false });
      const custB = await privileged.customer.create({ data: { tenantId: B, name: 'b' } });
      await privileged.equipment.create({
        data: { tenantId: B, customerId: custB.id, kind: 'x', lastServicedAt: daysAgo(400) },
      });
      expect(await service.due(A, 14)).toEqual([]);
    });
  });

  it('sets lastServicedAt when a task on the equipment is closed', async () => {
    const e = await eq({ lastServicedAt: daysAgo(400) });
    const task = await privileged.task.create({
      data: { tenantId: A, customerId: customerA, equipmentId: e.id, title: 't', source: 'MANUAL' },
    });
    await tasks.close(A, task.id, [], ACTOR);

    const after = await privileged.equipment.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.lastServicedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await service.due(A, 14)).toEqual([]);
  });

  describe('reminder → booking', () => {
    it('sends a link, marks the reminder, and books exactly one task', async () => {
      const e = await eq({ lastServicedAt: daysAgo(400) });
      const { url, waUrl } = await service.remind(A, e.id, ACTOR);
      expect(url).toMatch(/\/c\/b\//);
      expect(waUrl).toMatch(/^https:\/\/wa\.me\/972521234567/);
      expect((await service.due(A, 14))[0]!.remindedRecently).toBe(true);

      const view = await service.bookingView(tokenOf(url));
      expect(view).toMatchObject({ equipment: { kind: 'מזגן' }, alreadyBooked: false });

      await service.book(tokenOf(url), { windows: [{ date: dayFromToday(3), part: 'morning' }], note: 'יש כלב' });
      const created = await privileged.task.findMany({ where: { tenantId: A, equipmentId: e.id } });
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ source: 'CUSTOMER_LINK', status: 'NEW' });
      expect(created[0]!.description).toContain('בוקר');
      expect(created[0]!.description).toContain('יש כלב');
      expect(await privileged.outboxEvent.count({ where: { tenantId: A, eventName: 'task.created' } })).toBe(1);
    });

    it('books once even when the customer taps twice at the same moment', async () => {
      const e = await eq({ lastServicedAt: daysAgo(400) });
      const { url } = await service.remind(A, e.id, ACTOR);
      const body = { windows: [{ date: dayFromToday(3), part: 'noon' as const }] };

      const results = await Promise.allSettled([service.book(tokenOf(url), body), service.book(tokenOf(url), body)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
        ConflictException,
      );
      expect(await privileged.task.count({ where: { tenantId: A } })).toBe(1);
    });

    it.each([
      ['today', 0],
      ['in the past', -3],
      ['too far ahead', 61],
    ])('rejects a date %s', async (_l, offset) => {
      const e = await eq({ lastServicedAt: daysAgo(400) });
      const { url } = await service.remind(A, e.id, ACTOR);
      await expect(
        service.book(tokenOf(url), { windows: [{ date: dayFromToday(offset), part: 'morning' }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a date that does not exist', async () => {
      const e = await eq({ lastServicedAt: daysAgo(400) });
      const { url } = await service.remind(A, e.id, ACTOR);
      const year = Number(dayFromToday(30).slice(0, 4)) + (dayFromToday(30).slice(5, 7) > '02' ? 1 : 0);
      await expect(
        service.book(tokenOf(url), { windows: [{ date: `${year}-02-30`, part: 'morning' }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not open a booking link as a status link', async () => {
      const e = await eq({ lastServicedAt: daysAgo(400) });
      const { url } = await service.remind(A, e.id, ACTOR);
      await privileged.publicLink.updateMany({ where: { tenantId: A }, data: { purpose: 'TASK_STATUS' } });
      await expect(service.bookingView(tokenOf(url))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('refuses a last-service date in the future', async () => {
    await expect(
      service.create(A, customerA, { kind: 'מזגן', lastServicedOn: dayFromToday(5) }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
