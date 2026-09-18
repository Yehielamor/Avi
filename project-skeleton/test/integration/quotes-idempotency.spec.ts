import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { IdempotencyInterceptor } from '../../src/common/interceptors/idempotency.interceptor';
import { buildGlobalPipes } from '../../src/common/validation/global-pipes';
import { PrismaService } from '../../src/database/prisma.service';
import { PublicLinkService } from '../../src/modules/public-links/public-link.service';
import { QuotesController } from '../../src/modules/quotes/quotes.controller';
import { QuotesService } from '../../src/modules/quotes/quotes.service';

/**
 * POST /quotes עם Idempotency-Key, דרך HTTP ומול Postgres אמיתי (QA 18.09, F5).
 *
 * ניסיון חוזר של אותה הגשה מקבל את ההצעה שכבר נוצרה — לא הצעה שנייה עם
 * מספר רץ חדש. זה ה-interceptor הגלובלי, והבדיקה מוודאת שהוא אכן חל על
 * הנתיב הזה ושהתשובה המשוחזרת היא אותה הצעה.
 */
describe('POST /quotes — idempotency', () => {
  const A = 'f5f5f5f5-0000-0000-0000-00000000000a';

  let app: INestApplication;
  let prisma: PrismaService;
  let privileged: PrismaClient;
  let customerId: string;
  let actor: string;

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();

    const moduleRef = await Test.createTestingModule({
      controllers: [QuotesController],
      providers: [
        QuotesService,
        PublicLinkService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: new ConfigService({ PUBLIC_APP_URL: 'https://example.test' }) },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.tenantId = A;
      (req as unknown as { user: object }).user = { id: actor, role: 'OWNER' };
      next();
    });
    app.useGlobalPipes(...buildGlobalPipes(false));
    await app.init();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  async function cleanup() {
    for (const t of ['audit_logs', 'idempotency_keys', 'quote_lines', 'quotes', 'price_list_items', 'customers', 'users']) {
      await privileged.$executeRawUnsafe(`DELETE FROM ${t} WHERE "tenantId" = $1::uuid`, A);
    }
    await privileged.$executeRaw`DELETE FROM tenants WHERE id = ${A}::uuid`;
  }

  beforeEach(async () => {
    await cleanup();
    await privileged.tenant.create({ data: { id: A, name: 'הצעות', vertical: 'MAINTENANCE', subdomain: 'quote-idem-a' } });
    customerId = (await privileged.customer.create({ data: { tenantId: A, name: 'לקוח', phone: '0541112233' } })).id;
    actor = (await privileged.user.create({ data: { tenantId: A, email: 'o@qi.test', passwordHash: 'x', name: 'o', role: 'OWNER' } })).id;
    await privileged.priceListItem.create({
      data: { tenantId: A, code: 'SERVICE', description: 'טיפול', price: new Prisma.Decimal('350') },
    });
  });

  const post = (key?: string) => {
    const r = request(app.getHttpServer()).post('/quotes');
    if (key) r.set('Idempotency-Key', key);
    return r.send({ customerId, priceCodes: ['SERVICE'], notes: 'retry' });
  };

  it('replays the first quote on a retry with the same key, and creates only one', async () => {
    const first = await post('quote-retry-key-1');
    // התשובה נשמרת מיד אחרי שהיא נשלחת (לא לפני), אז ניסיון חוזר מיידי
    // יכול לקבל 409 "still in progress" לרגע. לקוח אמיתי מנסה שוב — כמו כאן.
    let second = await post('quote-retry-key-1');
    for (let i = 0; second.status === 409 && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      second = await post('quote-retry-key-1');
    }

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.quoteNumber).toBe(first.body.quoteNumber);
    expect(await privileged.quote.count({ where: { tenantId: A } })).toBe(1);
  });

  it('creates exactly one quote from concurrent requests with the same key', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => post('quote-race-key-1')));
    const created = results.filter((r) => r.status === 201 && r.headers['idempotent-replay'] !== 'true');

    expect(created).toHaveLength(1);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(await privileged.quote.count({ where: { tenantId: A } })).toBe(1);
  });

  it('still creates a new quote for a new key', async () => {
    await post('quote-key-aaaaaaaa');
    await post('quote-key-bbbbbbbb');
    expect(await privileged.quote.count({ where: { tenantId: A } })).toBe(2);
  });
});
