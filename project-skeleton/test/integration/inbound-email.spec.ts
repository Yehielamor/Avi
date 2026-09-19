import type { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { PrismaService } from '../../src/database/prisma.service';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { EmailIntakeService } from '../../src/modules/intake/email-intake.service';
import { InboundEmailService } from '../../src/modules/intake/inbound/inbound-email.service';
import type { IntakeExtractionService } from '../../src/modules/intake/intake-extraction.service';
import type { IntegrationsService } from '../../src/modules/integrations/integrations.service';
import { TasksService } from '../../src/modules/tasks/tasks.service';

/**
 * קליטת מייל בהעברה, מול Postgres אמיתי: כתובת → טננט דרך פונקציית
 * ה-SECURITY DEFINER, משימה נוצרת פעם אחת, קוד אימות של Gmail נשמר ולא
 * הופך למשימה, ובידוד בין טננטים. ה-LLM מוחלף בתשובה ריקה — הוא לא
 * מה שנבדק כאן.
 */
describe('InboundEmailService', () => {
  const A = '99999999-0000-0000-0000-00000000000a';
  const B = '99999999-0000-0000-0000-00000000000b';
  const DOMAIN = 'in.test.local';
  let prisma: PrismaService;
  let privileged: PrismaClient;
  let service: InboundEmailService;
  let addressA: string;

  const config = (secret: string) =>
    ({ get: (k: string) => (k === 'INBOUND_EMAIL_DOMAIN' ? DOMAIN : secret) }) as unknown as ConfigService<never, true>;

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();
    const extraction = {
      extractFromEmail: jest.fn().mockResolvedValue({ matchedTemplateId: null, confidence: 0, extractedFields: {}, priority: 2, customerAddressHint: null }),
      shouldAutoAssignTemplate: () => false,
    } as unknown as IntakeExtractionService;
    const intake = new EmailIntakeService(prisma, {} as IntegrationsService, new TasksService(prisma), new CustomersService(prisma), extraction);
    service = new InboundEmailService(prisma, intake, config('s'.repeat(32)));
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  async function cleanup() {
    for (const id of [A, B]) {
      for (const t of ['outbox_events', 'audit_logs', 'tasks', 'customers', 'inbound_mailboxes', 'users']) {
        await privileged.$executeRawUnsafe(`DELETE FROM ${t} WHERE "tenantId" = $1::uuid`, id);
      }
      await privileged.$executeRaw`DELETE FROM tenants WHERE id = ${id}::uuid`;
    }
  }

  beforeEach(async () => {
    await cleanup();
    for (const [id, sub] of [[A, 'inbound-a'], [B, 'inbound-b']] as const) {
      await privileged.tenant.create({ data: { id, name: sub, vertical: 'MAINTENANCE', subdomain: sub } });
    }
    addressA = (await service.mailbox(A)).address;
  });

  const mail = (over: Record<string, unknown> = {}) => ({
    to: addressA,
    from: 'רינה לוי <rina@walla.co.il>',
    subject: 'המזגן מטפטף',
    text: 'שלום, המזגן בסלון מטפטף מים. אפשר להגיע מחר?',
    messageId: '<abc-1@mail.gmail.com>',
    ...over,
  });

  it('gives each business a stable, unguessable address', async () => {
    expect(addressA).toMatch(/^inbound-a-[a-z2-7]{10}@in\.test\.local$/);
    expect((await service.mailbox(A)).address).toBe(addressA);
    expect((await service.mailbox(B)).address).not.toBe(addressA);
  });

  it('turns a forwarded email into one task and one customer, and counts it', async () => {
    const r = await service.receive(mail());
    expect(r.kind).toBe('created');
    const tasks = await privileged.task.findMany({ where: { tenantId: A }, include: { customer: true } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'המזגן מטפטף', source: 'EMAIL', sourceEmailId: 'mid:abc-1@mail.gmail.com' });
    expect(tasks[0]!.customer).toMatchObject({ name: 'רינה לוי', email: 'rina@walla.co.il' });
    expect(await service.mailbox(A)).toMatchObject({ receivedCount: 1 });
  });

  it('ignores the same message delivered twice', async () => {
    await service.receive(mail());
    await expect(service.receive(mail())).resolves.toEqual({ kind: 'duplicate' });
    expect(await privileged.task.count({ where: { tenantId: A } })).toBe(1);
  });

  it('stores Gmail’s confirmation code instead of creating a task', async () => {
    const r = await service.receive(
      mail({
        from: 'Gmail Team <forwarding-noreply@google.com>',
        subject: '(#987654321) Gmail Forwarding Confirmation',
        text: 'Confirmation code: 987654321\nhttps://mail-settings.google.com/mail/vf-xyz',
      }),
    );
    expect(r).toEqual({ kind: 'verification' });
    expect(await service.mailbox(A)).toMatchObject({ verificationCode: '987654321', verificationUrl: 'https://mail-settings.google.com/mail/vf-xyz' });
    expect(await privileged.task.count({ where: { tenantId: A } })).toBe(0);
  });

  it('uses the original sender of a manual forward', async () => {
    await service.receive(
      mail({
        from: 'Owner <owner@gmail.com>',
        subject: 'Fwd: תקלה',
        text: '---------- Forwarded message ---------\nFrom: דני <dani@gmail.com>\nSubject: תקלה במזגן\n\nלא מקרר',
      }),
    );
    const task = await privileged.task.findFirst({ where: { tenantId: A }, include: { customer: true } });
    expect(task).toMatchObject({ title: 'תקלה במזגן', description: 'לא מקרר' });
    expect(task!.customer.email).toBe('dani@gmail.com');
  });

  it('does not create tasks from auto-replies', async () => {
    await expect(service.receive(mail({ autoSubmitted: 'auto-replied' }))).resolves.toEqual({ kind: 'ignored', reason: 'auto-submitted' });
    expect(await privileged.task.count({ where: { tenantId: A } })).toBe(0);
  });

  it('refuses an unknown address with 404, and never lands in another tenant', async () => {
    await expect(service.receive(mail({ to: 'inbound-a-zzzzzzzzzz@in.test.local' }))).rejects.toMatchObject({ status: 404 });
    await expect(service.receive(mail({ to: addressA.replace('in.test.local', 'evil.com') }))).rejects.toMatchObject({ status: 404 });
    expect(await privileged.task.count({ where: { tenantId: { in: [A, B] } } })).toBe(0);
  });

  it('stops accepting the old address after a rotation', async () => {
    const owner = await privileged.user.create({ data: { tenantId: A, email: 'o@i.test', passwordHash: 'x', name: 'o', role: 'OWNER' } });
    const rotated = await service.rotate(A, owner.id);
    expect(rotated.address).not.toBe(addressA);
    await expect(service.receive(mail())).rejects.toMatchObject({ status: 404 });
    await expect(service.receive(mail({ to: rotated.address }))).resolves.toMatchObject({ kind: 'created' });
  });

  it('refuses a deactivated business', async () => {
    await privileged.tenant.update({ where: { id: A }, data: { isActive: false } });
    await expect(service.receive(mail())).rejects.toMatchObject({ status: 404 });
  });

  it('is off (503) without a secret', async () => {
    const off = new InboundEmailService(prisma, {} as EmailIntakeService, config(''));
    await expect(off.receive(mail())).rejects.toMatchObject({ status: 503 });
    expect((await off.mailbox(A)).enabled).toBe(false);
  });
});
