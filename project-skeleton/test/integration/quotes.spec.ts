import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';

import type { AppEnv } from '../../src/config/env.schema';
import { PrismaService } from '../../src/database/prisma.service';
import { PublicLinkService } from '../../src/modules/public-links/public-link.service';
import { QuotesService } from '../../src/modules/quotes/quotes.service';

/**
 * הצעות מחיר, מול Postgres אמיתי.
 *
 * ההבטחה ללקוח: מה שאישרת הוא מה שתחויב עליו. לכן הבדיקות מתמקדות בשלוש
 * נקודות שבהן זה יכול להישבר — מחיר שהשתנה אחרי השליחה, אישור כפול, ושורה
 * שלא נמצאת במחירון.
 */
describe('QuotesService', () => {
  const A = '77777777-0000-0000-0000-00000000000a';
  let prisma: PrismaService;
  let privileged: PrismaClient;
  let service: QuotesService;
  let customerId: string;
  let actor: string;

  const tokenOf = (url: string) => url.split('/').pop()!;

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();
    const config = new ConfigService({ PUBLIC_APP_URL: 'https://example.test' }) as unknown as ConfigService<AppEnv, true>;
    service = new QuotesService(prisma, new PublicLinkService(prisma, config));
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  async function cleanup() {
    for (const t of ['audit_logs', 'outbox_events', 'public_links', 'quote_lines', 'quotes', 'tasks', 'price_list_items', 'customers', 'users']) {
      await privileged.$executeRawUnsafe(`DELETE FROM ${t} WHERE "tenantId" = $1::uuid`, A);
    }
    await privileged.$executeRaw`DELETE FROM tenants WHERE id = ${A}::uuid`;
  }

  beforeEach(async () => {
    await cleanup();
    await privileged.tenant.create({ data: { id: A, name: 'מיזוג בדיקה', vertical: 'MAINTENANCE', subdomain: 'quote-a' } });
    customerId = (await privileged.customer.create({ data: { tenantId: A, name: 'לקוח', phone: '0541112233' } })).id;
    actor = (await privileged.user.create({ data: { tenantId: A, email: 'o@q.test', passwordHash: 'x', name: 'o', role: 'OWNER' } })).id;
    await privileged.priceListItem.createMany({
      data: [
        { tenantId: A, code: 'INSTALL', description: 'התקנת מזגן', price: new Prisma.Decimal('1850.10') },
        { tenantId: A, code: 'PIPE', description: 'צנרת נוספת', price: new Prisma.Decimal('0.20') },
        { tenantId: A, code: 'OLD', description: 'ישן', price: new Prisma.Decimal('10'), isActive: false },
      ],
    });
  });

  const createAndSend = async (codes = ['INSTALL', 'PIPE']) => {
    const quote = await service.create(A, { customerId, priceCodes: codes }, actor);
    const sent = await service.send(A, quote.id, actor);
    return { quote, token: tokenOf(sent.url), sent };
  };

  it('prices from the list, sums in Decimal, and numbers quotes per tenant', async () => {
    const first = await service.create(A, { customerId, priceCodes: ['INSTALL', 'PIPE'] }, actor);
    const second = await service.create(A, { customerId, priceCodes: ['PIPE'] }, actor);
    expect(first.totalAmount.toString()).toBe('1850.3');
    expect(first.lines.map((l) => l.description)).toEqual(['התקנת מזגן', 'צנרת נוספת']);
    expect([first.quoteNumber, second.quoteNumber]).toEqual([1, 2]);
  });

  it('never hands out the same quote number twice under concurrency', async () => {
    const made = await Promise.all(
      Array.from({ length: 6 }, () => service.create(A, { customerId, priceCodes: ['PIPE'] }, actor)),
    );
    expect(new Set(made.map((q) => q.quoteNumber)).size).toBe(6);
  });

  it.each([
    ['an unknown code', ['NOPE']],
    ['an inactive code', ['OLD']],
  ])('rejects %s instead of pricing it at zero', async (_l, codes) => {
    await expect(service.create(A, { customerId, priceCodes: codes }, actor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the sent price even after the price list changes', async () => {
    const { token } = await createAndSend();
    await privileged.priceListItem.updateMany({ where: { tenantId: A, code: 'INSTALL' }, data: { price: new Prisma.Decimal('9999') } });
    const view = await service.publicView(token);
    expect(view.totalAmount).toBe('1850.3');
    expect(view.lines[0]!.amount).toBe('1850.1');
  });

  it('turns an approval into one task whose checklist is the approved lines', async () => {
    const { quote, token } = await createAndSend();
    const view = await service.approve(token);
    expect(view).toMatchObject({ status: 'APPROVED', canRespond: false });

    const saved = await privileged.quote.findUniqueOrThrow({ where: { id: quote.id } });
    const task = await privileged.task.findUniqueOrThrow({ where: { id: saved.taskId! } });
    expect(task.source).toBe('QUOTE');
    expect(task.checklist).toEqual([
      { label: 'התקנת מזגן', done: false, priceCode: 'INSTALL' },
      { label: 'צנרת נוספת', done: false, priceCode: 'PIPE' },
    ]);
  });

  it('creates one task even when the customer approves twice at once', async () => {
    const { token } = await createAndSend();
    const results = await Promise.allSettled([service.approve(token), service.approve(token)]);
    // שתי הלחיצות מסתיימות בהצלחה (השנייה אידמפוטנטית) — אבל משימה אחת.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await privileged.task.count({ where: { tenantId: A } })).toBe(1);
  });

  it('cannot approve an expired quote, and shows it as expired', async () => {
    const { quote, token } = await createAndSend();
    await privileged.quote.update({ where: { id: quote.id }, data: { validUntil: new Date(Date.now() - 1000) } });
    expect((await service.publicView(token)).status).toBe('EXPIRED');
    await expect(service.approve(token)).rejects.toBeInstanceOf(ConflictException);
    expect(await privileged.task.count({ where: { tenantId: A } })).toBe(0);
  });

  it('cannot approve after declining', async () => {
    const { token } = await createAndSend();
    await service.decline(token);
    await expect(service.approve(token)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to re-send an answered quote', async () => {
    const { quote, token } = await createAndSend();
    await service.approve(token);
    await expect(service.send(A, quote.id, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not open a quote link as a booking link', async () => {
    const { token } = await createAndSend();
    await privileged.publicLink.updateMany({ where: { tenantId: A }, data: { purpose: 'BOOKING' } });
    await expect(service.publicView(token)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not expose the customer or the price codes on the public page', async () => {
    const { token } = await createAndSend();
    const json = JSON.stringify(await service.publicView(token));
    expect(json).not.toContain('INSTALL');
    expect(json).not.toContain('0541112233');
  });
});
