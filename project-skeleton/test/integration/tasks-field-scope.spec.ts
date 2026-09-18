import { NotFoundException } from '@nestjs/common';
import { PrismaClient, TaskStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../../src/database/prisma.service';
import { TasksService, type TaskActor } from '../../src/modules/tasks/tasks.service';

/**
 * טכנאי רואה וסוגר רק משימות שהוקצו לו (QA 18.09, F2), מול Postgres אמיתי.
 *
 * לפני התיקון `GET /tasks`, `GET /tasks/:id` ו-`POST /tasks/:id/close` לא
 * קיבלו את התפקיד בכלל: טכנאי ראה את פרטי הלקוח של עמית, וסגר לו עבודה עם
 * צ'קליסט שרירותי (חשבונית, מלאי, "טופל לאחרונה").
 */
describe('TasksService — FIELD scope', () => {
  const A = 'f2f2f2f2-0000-0000-0000-00000000000a';

  let prisma: PrismaService;
  let privileged: PrismaClient;
  let service: TasksService;
  let ids: { mine: string; theirs: string; tech: string; other: string; owner: string };

  const tech = (): TaskActor => ({ id: ids.tech, role: UserRole.FIELD });
  const owner = (): TaskActor => ({ id: ids.owner, role: UserRole.OWNER });

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();
    service = new TasksService(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  async function cleanup() {
    for (const t of ['audit_logs', 'outbox_events', 'tasks', 'users', 'customers']) {
      await privileged.$executeRawUnsafe(`DELETE FROM ${t} WHERE "tenantId" = $1::uuid`, A);
    }
    await privileged.$executeRaw`DELETE FROM tenants WHERE id = ${A}::uuid`;
  }

  beforeEach(async () => {
    await cleanup();
    await privileged.tenant.create({ data: { id: A, name: 'היקף טכנאי', vertical: 'MAINTENANCE', subdomain: 'field-scope-a' } });
    const customer = await privileged.customer.create({ data: { tenantId: A, name: 'לקוח', phone: '0501234567' } });
    const mkUser = (email: string, role: UserRole) =>
      privileged.user.create({ data: { tenantId: A, email, passwordHash: 'x', name: email, role } });
    const t = await mkUser('tech@field-scope.test', UserRole.FIELD);
    const o = await mkUser('other@field-scope.test', UserRole.FIELD);
    const w = await mkUser('owner@field-scope.test', UserRole.OWNER);
    const mkTask = (assignedToUserId: string) =>
      privileged.task.create({ data: { tenantId: A, customerId: customer.id, title: 't', source: 'MANUAL', assignedToUserId } });
    ids = { mine: (await mkTask(t.id)).id, theirs: (await mkTask(o.id)).id, tech: t.id, other: o.id, owner: w.id };
  });

  it('lists only the technician’s own tasks, even without assignedToMe', async () => {
    const { items } = await service.findAll(A, {}, tech());
    expect(items.map((i) => i.id)).toEqual([ids.mine]);
  });

  it('still lists every task for the owner', async () => {
    const { items } = await service.findAll(A, {}, owner());
    expect(items.map((i) => i.id).sort()).toEqual([ids.mine, ids.theirs].sort());
  });

  it('answers another technician’s task with 404', async () => {
    await expect(service.findOne(A, ids.theirs, tech())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findOne(A, ids.mine, tech())).resolves.toMatchObject({ id: ids.mine });
  });

  it('refuses to close another technician’s task, as 404, and changes nothing', async () => {
    await expect(service.close(A, ids.theirs, [{ label: 'x', done: true }], tech())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const row = await privileged.task.findUniqueOrThrow({ where: { id: ids.theirs } });
    expect(row.status).not.toBe(TaskStatus.CLOSED);
    expect(await privileged.outboxEvent.count({ where: { tenantId: A } })).toBe(0);
  });

  it('answers 404, not "already closed", for a closed task of someone else', async () => {
    await service.close(A, ids.theirs, [], owner());
    await expect(service.close(A, ids.theirs, [], tech())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets the technician close their own task, and the owner close any', async () => {
    await expect(service.close(A, ids.mine, [], tech())).resolves.toMatchObject({ alreadyClosed: false });
    await expect(service.close(A, ids.theirs, [], owner())).resolves.toMatchObject({ alreadyClosed: false });
  });
});
