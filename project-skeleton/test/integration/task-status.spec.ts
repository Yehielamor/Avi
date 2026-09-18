import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, UserRole } from '@prisma/client';

import type { AppEnv } from '../../src/config/env.schema';
import { PrismaService } from '../../src/database/prisma.service';
import { PublicLinkService } from '../../src/modules/public-links/public-link.service';
import { TaskStatusService } from '../../src/modules/task-status/task-status.service';

/**
 * דף הסטטוס ללקוח, מול Postgres אמיתי.
 *
 * זה הנתיב היחיד במערכת שבו אדם לא מזוהה קורא ומשנה נתונים. כל הבדיקות
 * כאן שואלות שאלה אחת בצורות שונות: האם הטוקן נותן בדיוק את מה שהוא אמור,
 * ולא טיפה יותר?
 */
describe('TaskStatusService (public links)', () => {
  const A = '99999999-0000-0000-0000-00000000000a';
  const B = '99999999-0000-0000-0000-00000000000b';

  let prisma: PrismaService;
  let privileged: PrismaClient;
  let service: TaskStatusService;
  let ids: { taskA: string; customerA: string; techA: string; otherTechA: string; taskB: string };

  const tokenOf = (url: string) => url.split('/').pop()!;

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();
    const config = new ConfigService({ PUBLIC_APP_URL: 'https://example.test' }) as unknown as ConfigService<AppEnv, true>;
    service = new TaskStatusService(prisma, new PublicLinkService(prisma, config));
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  async function cleanup() {
    for (const id of [A, B]) {
      await privileged.$executeRaw`DELETE FROM audit_logs WHERE "tenantId" = ${id}::uuid`;
      await privileged.$executeRaw`DELETE FROM public_links WHERE "tenantId" = ${id}::uuid`;
      await privileged.$executeRaw`DELETE FROM tasks WHERE "tenantId" = ${id}::uuid`;
      await privileged.$executeRaw`DELETE FROM users WHERE "tenantId" = ${id}::uuid`;
      await privileged.$executeRaw`DELETE FROM customers WHERE "tenantId" = ${id}::uuid`;
      await privileged.$executeRaw`DELETE FROM tenants WHERE id = ${id}::uuid`;
    }
  }

  beforeEach(async () => {
    await cleanup();
    const mk = async (tenantId: string, sub: string, name: string) => {
      await privileged.tenant.create({ data: { id: tenantId, name, vertical: 'MAINTENANCE', subdomain: sub } });
      const customer = await privileged.customer.create({
        data: { tenantId, name: 'דנה לוי', phone: '050-1234567', address: 'רחוב סודי 5' },
      });
      const tech = await privileged.user.create({
        data: { tenantId, email: `tech@${sub}.test`, passwordHash: 'x', name: 'יוסי כהן', role: UserRole.FIELD },
      });
      const other = await privileged.user.create({
        data: { tenantId, email: `other@${sub}.test`, passwordHash: 'x', name: 'אבי', role: UserRole.FIELD },
      });
      const task = await privileged.task.create({
        data: { tenantId, customerId: customer.id, title: 'מזגן מטפטף', source: 'MANUAL', assignedToUserId: tech.id },
      });
      return { task: task.id, customer: customer.id, tech: tech.id, other: other.id };
    };
    const a = await mk(A, 'status-a', 'מיזוג א');
    const b = await mk(B, 'status-b', 'מיזוג ב');
    ids = { taskA: a.task, customerA: a.customer, techA: a.tech, otherTechA: a.other, taskB: b.task };
  });

  const techA = () => ({ id: ids.techA, role: UserRole.FIELD });

  it('shares a link the customer can open, showing only the minimum', async () => {
    const { url, waUrl } = await service.share(A, ids.taskA, techA());
    expect(url).toMatch(/^https:\/\/example\.test\/c\/s\/[A-Za-z0-9_-]{43}$/);
    expect(waUrl).toMatch(/^https:\/\/wa\.me\/972501234567\?text=/);

    const view = await service.view(tokenOf(url));
    expect(view).toMatchObject({
      businessName: 'מיזוג א',
      technicianFirstName: 'יוסי',
      title: 'מזגן מטפטף',
      status: 'received',
      canConfirm: false,
    });
    // תיקון 13: הדף לא מחזיר כתובת, טלפון או שם מלא.
    const json = JSON.stringify(view);
    expect(json).not.toContain('רחוב סודי');
    expect(json).not.toContain('050');
    expect(json).not.toContain('כהן');
    // גם לא שם הלקוח: הקישור יכול להיות מועבר הלאה.
    expect(json).not.toContain('דנה');
  });

  it('stores only a hash of the token', async () => {
    const { url } = await service.share(A, ids.taskA, techA());
    const rows = await privileged.publicLink.findMany({ where: { tenantId: A } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(tokenOf(url));
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a technician sharing a task that is not theirs, as 404', async () => {
    await expect(service.share(A, ids.taskA, { id: ids.otherTechA, role: UserRole.FIELD })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await privileged.publicLink.count({ where: { tenantId: A } })).toBe(0);
  });

  it('refuses a task from another tenant, as 404', async () => {
    await expect(service.share(A, ids.taskB, { id: ids.techA, role: UserRole.OWNER })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['a malformed token', 'not-a-token'],
    ['a well-formed token that does not exist', 'A'.repeat(43)],
  ])('answers %s with the same 404', async (_l, token) => {
    await expect(service.view(token)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('kills the old link when a new one is shared', async () => {
    const first = await service.share(A, ids.taskA, techA());
    await service.share(A, ids.taskA, techA());
    await expect(service.view(tokenOf(first.url))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an expired link', async () => {
    const { url } = await service.share(A, ids.taskA, techA());
    await privileged.publicLink.updateMany({ where: { tenantId: A }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(service.view(tokenOf(url))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a link used for another purpose', async () => {
    const { url } = await service.share(A, ids.taskA, techA());
    await privileged.publicLink.updateMany({ where: { tenantId: A }, data: { purpose: 'QUOTE' } });
    await expect(service.view(tokenOf(url))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cannot confirm before a visit time exists', async () => {
    const { url } = await service.share(A, ids.taskA, techA());
    await expect(service.confirm(tokenOf(url))).rejects.toBeInstanceOf(ConflictException);
  });

  it('confirms a scheduled visit, and a new time clears the confirmation', async () => {
    await service.schedule(A, ids.taskA, { scheduledStart: '2026-10-01T07:00:00.000Z', scheduledEnd: '2026-10-01T09:00:00.000Z' }, ids.techA);
    const { url } = await service.share(A, ids.taskA, techA());

    const confirmed = await service.confirm(tokenOf(url));
    expect(confirmed.status).toBe('scheduled');
    expect(confirmed.customerConfirmedAt).not.toBeNull();

    await service.schedule(A, ids.taskA, { scheduledStart: '2026-10-02T07:00:00.000Z' }, ids.techA);
    expect((await service.view(tokenOf(url))).customerConfirmedAt).toBeNull();
  });

  it('treats a repeated confirm as a no-op: same timestamp, one audit row (QA F16)', async () => {
    await service.schedule(A, ids.taskA, { scheduledStart: '2026-10-01T07:00:00.000Z' }, ids.techA);
    const { url } = await service.share(A, ids.taskA, techA());

    const first = await service.confirm(tokenOf(url));
    const again = await service.confirm(tokenOf(url));
    await service.confirm(tokenOf(url));

    expect(again.customerConfirmedAt).toEqual(first.customerConfirmedAt);
    expect(
      await privileged.auditLog.count({ where: { tenantId: A, action: 'task.customer_confirmed', entityId: ids.taskA } }),
    ).toBe(1);

    // אחרי בקשת שינוי, אישור חדש הוא אישור אמיתי ונרשם.
    await service.requestReschedule(tokenOf(url), 'אולי מחר');
    const reconfirmed = await service.confirm(tokenOf(url));
    expect(reconfirmed).toMatchObject({ rescheduleRequested: false });
    expect(reconfirmed.customerConfirmedAt).not.toBeNull();
    expect(
      await privileged.auditLog.count({ where: { tenantId: A, action: 'task.customer_confirmed', entityId: ids.taskA } }),
    ).toBe(2);
  });

  it('refuses to schedule a finished task with 409, and an unknown one with 404 (QA F18)', async () => {
    await privileged.task.update({ where: { id: ids.taskA }, data: { status: 'CLOSED', closedAt: new Date() } });
    const at = { scheduledStart: '2026-10-01T07:00:00.000Z' };
    await expect(service.schedule(A, ids.taskA, at, ids.techA)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.schedule(A, ids.taskB, at, ids.techA)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records a reschedule request and drops the confirmation', async () => {
    await service.schedule(A, ids.taskA, { scheduledStart: '2026-10-01T07:00:00.000Z' }, ids.techA);
    const { url } = await service.share(A, ids.taskA, techA());
    await service.confirm(tokenOf(url));

    const view = await service.requestReschedule(tokenOf(url), '  אני בעבודה עד 16:00  ');
    expect(view.rescheduleRequested).toBe(true);
    expect(view.customerConfirmedAt).toBeNull();
    const task = await privileged.task.findUniqueOrThrow({ where: { id: ids.taskA } });
    expect(task.rescheduleRequest).toBe('אני בעבודה עד 16:00');
  });

  it('logs public actions without a user and without the customer’s text', async () => {
    await service.schedule(A, ids.taskA, { scheduledStart: '2026-10-01T07:00:00.000Z' }, ids.techA);
    const { url } = await service.share(A, ids.taskA, techA());
    await service.requestReschedule(tokenOf(url), 'טקסט פרטי של לקוח');

    const log = await privileged.auditLog.findFirstOrThrow({
      where: { tenantId: A, action: 'task.customer_requested_reschedule' },
    });
    expect(log.userId).toBeNull();
    expect(JSON.stringify(log.metadata)).not.toContain('טקסט פרטי');
  });

  it('shows "on the way" once the technician says so', async () => {
    const { url } = await service.onTheWay(A, ids.taskA, techA());
    expect((await service.view(tokenOf(url))).status).toBe('on_the_way');
  });

  it('stops accepting customer changes once the job is closed', async () => {
    await service.schedule(A, ids.taskA, { scheduledStart: '2026-10-01T07:00:00.000Z' }, ids.techA);
    const { url } = await service.share(A, ids.taskA, techA());
    await privileged.task.update({ where: { id: ids.taskA }, data: { status: 'CLOSED', closedAt: new Date() } });

    const view = await service.view(tokenOf(url));
    expect(view).toMatchObject({ status: 'done', canConfirm: false, canRequestReschedule: false });
    await expect(service.requestReschedule(tokenOf(url), 'x')).rejects.toBeInstanceOf(ConflictException);
  });
});
