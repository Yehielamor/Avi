import { Prisma, PrismaClient } from '@prisma/client';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../src/database/prisma.service';
import { PriceListService } from '../../src/modules/price-list/price-list.service';

/**
 * המחירון, מול Postgres אמיתי.
 *
 * כמעט כל מה שחשוב כאן הוא SQL: מחיר שעובר הלוך-חזור בלי לעבור
 * דרך float, ייחודיות שנאכפת ב-DB, נעילת שורה, ספירה מתוך JSON של
 * תבניות, ו-RLS. mock לא היה מוכיח אף אחד מהם.
 */
describe('PriceListService', () => {
  const A = '77777777-7777-7777-7777-777777777777';
  const B = '88888888-8888-8888-8888-888888888888';

  let prisma: PrismaService;
  let privileged: PrismaClient;
  let service: PriceListService;

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    await privileged.$connect();
    service = new PriceListService(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await privileged.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
    for (const [id, sub] of [
      [A, 'price-a'],
      [B, 'price-b'],
    ] as const) {
      await privileged.$executeRaw`
        INSERT INTO tenants (id, name, vertical, subdomain, "isActive", "createdAt", "updatedAt")
        VALUES (${id}::uuid, ${sub}, 'MAINTENANCE', ${sub}, true, now(), now())
      `;
    }
  });

  async function cleanup(): Promise<void> {
    for (const id of [A, B]) {
      await privileged.$executeRaw`DELETE FROM audit_logs WHERE "tenantId" = ${id}::uuid`;
      await privileged.$executeRaw`DELETE FROM job_type_templates WHERE "tenantId" = ${id}::uuid`;
      await privileged.$executeRaw`DELETE FROM price_list_items WHERE "tenantId" = ${id}::uuid`;
      await privileged.$executeRaw`DELETE FROM tenants WHERE id = ${id}::uuid`;
    }
  }

  async function template(tenantId: string, name: string, checklist: unknown, isActive = true) {
    await privileged.$executeRaw`
      INSERT INTO job_type_templates (id, "tenantId", name, fields, "defaultPriority", "defaultChecklist", "isActive", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${name}, '[]'::jsonb, 2, ${JSON.stringify(checklist)}::jsonb, ${isActive}, now(), now())
    `;
  }

  describe('money', () => {
    it('stores the exact price it was given and returns it unchanged', async () => {
      const item = await service.create(A, { code: 'AC-FIX', description: 'תיקון מזגן', price: '149.90' });
      expect(item.price).toBeInstanceOf(Prisma.Decimal);
      expect(item.price.toString()).toBe('149.9');

      const [row] = await privileged.$queryRaw<Array<{ price: string }>>`
        SELECT price::text AS price FROM price_list_items WHERE id = ${item.id}::uuid
      `;
      expect(row?.price).toBe('149.90');
    });

    it('keeps a large price exact, where a double would drift', async () => {
      // 99999999.99 אינו ניתן לייצוג מדויק ב-double. אם המחיר עבר
      // דרך number בדרך, הערך השמור יהיה שונה.
      const item = await service.create(A, { code: 'BIG', description: 'x', price: '99999999.99' });
      const [row] = await privileged.$queryRaw<Array<{ price: string }>>`
        SELECT price::text AS price FROM price_list_items WHERE id = ${item.id}::uuid
      `;
      expect(row?.price).toBe('99999999.99');
    });
  });

  describe('create', () => {
    it('rejects a duplicate code with 409, enforced by the database', async () => {
      await service.create(A, { code: 'DUP', description: 'first', price: '10' });
      await expect(service.create(A, { code: 'DUP', description: 'second', price: '20' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects a duplicate even when both requests race', async () => {
      // בדיקה מקדימה הייתה מעבירה את שתיהן. הייחודיות ב-DB לא.
      const results = await Promise.allSettled([
        service.create(A, { code: 'RACE', description: 'one', price: '1' }),
        service.create(A, { code: 'RACE', description: 'two', price: '2' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
    });

    it('allows the same code in another tenant', async () => {
      await service.create(A, { code: 'SHARED', description: 'a', price: '10' });
      await expect(service.create(B, { code: 'SHARED', description: 'b', price: '20' })).resolves.toBeDefined();
    });

    it('writes an audit entry', async () => {
      const item = await service.create(A, { code: 'AUD', description: 'x', price: '5.50' });
      const logs = await privileged.auditLog.findMany({ where: { tenantId: A, entityId: item.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.action).toBe('price_list_item.created');
      expect(logs[0]?.metadata).toEqual({ code: 'AUD', price: '5.5' });
    });
  });

  describe('update', () => {
    it('changes the price and records from and to in the audit log', async () => {
      const item = await service.create(A, { code: 'P', description: 'x', price: '100' });
      const updated = await service.update(A, item.id, { price: '120.50' });

      expect(updated.price.toString()).toBe('120.5');
      const log = await privileged.auditLog.findFirstOrThrow({
        where: { tenantId: A, entityId: item.id, action: 'price_list_item.updated' },
      });
      expect(log.metadata).toEqual({ code: 'P', changes: { price: { from: '100', to: '120.5' } } });
    });

    it('does not write an audit entry when nothing actually changed', async () => {
      const item = await service.create(A, { code: 'SAME', description: 'x', price: '100.00' });
      await service.update(A, item.id, { price: '100' });
      const logs = await privileged.auditLog.findMany({
        where: { tenantId: A, entityId: item.id, action: 'price_list_item.updated' },
      });
      expect(logs).toHaveLength(0);
    });

    it('records the true "from" for each of two concurrent price changes', async () => {
      // בלי FOR UPDATE שני העדכונים קוראים 100 כ"לפני", והיומן מתעד
      // שני שינויים מ-100 — היסטוריה שלא התרחשה.
      const item = await service.create(A, { code: 'CONC', description: 'x', price: '100' });
      await Promise.all([service.update(A, item.id, { price: '200' }), service.update(A, item.id, { price: '300' })]);

      const logs = await privileged.auditLog.findMany({
        where: { tenantId: A, entityId: item.id, action: 'price_list_item.updated' },
        orderBy: { createdAt: 'asc' },
      });
      const froms = logs.map((l) => (l.metadata as { changes: { price: { from: string } } }).changes.price.from);
      expect(froms).toContain('100');
      expect(new Set(froms).size).toBe(2);
    });

    it('rejects an empty update', async () => {
      const item = await service.create(A, { code: 'E', description: 'x', price: '1' });
      await expect(service.update(A, item.id, {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns 404 for an item that belongs to another tenant, and leaves it untouched', async () => {
      const bItem = await service.create(B, { code: 'MINE', description: 'b', price: '50' });
      await expect(service.update(A, bItem.id, { price: '0' })).rejects.toBeInstanceOf(NotFoundException);

      const row = await privileged.priceListItem.findUniqueOrThrow({ where: { id: bItem.id } });
      expect(row.price.toString()).toBe('50');
    });

    it('deactivates without deleting, so past references stay resolvable', async () => {
      const item = await service.create(A, { code: 'OLD', description: 'x', price: '1' });
      await service.update(A, item.id, { isActive: false });

      expect(await service.findAll(A, {})).toHaveLength(0);
      const all = await service.findAll(A, { includeInactive: true });
      expect(all.map((i) => i.code)).toEqual(['OLD']);
    });
  });

  describe('findAll', () => {
    it('never returns another tenant’s prices', async () => {
      await service.create(A, { code: 'A1', description: 'a', price: '1' });
      await service.create(B, { code: 'B1', description: 'b', price: '2' });
      expect((await service.findAll(A, {})).map((i) => i.code)).toEqual(['A1']);
    });

    it('counts the active templates that reference each code', async () => {
      await service.create(A, { code: 'USED', description: 'x', price: '1' });
      await service.create(A, { code: 'UNUSED', description: 'x', price: '1' });

      await template(A, 't1', [{ label: 'a', priceCode: 'USED' }, { label: 'b', priceCode: 'USED' }]);
      await template(A, 't2', [{ label: 'a', priceCode: 'USED' }]);
      // תבנית מושבתת אינה מייצרת חשבוניות, ולכן אינה נספרת.
      await template(A, 't3', [{ label: 'a', priceCode: 'USED' }], false);
      // תבנית של טננט אחר עם אותו קוד — אסור שתיספר.
      await template(B, 't4', [{ label: 'a', priceCode: 'USED' }]);

      const byCode = Object.fromEntries((await service.findAll(A, {})).map((i) => [i.code, i.usedByTemplates]));
      // t1 מפנה פעמיים לאותו קוד — עדיין תבנית אחת.
      expect(byCode).toEqual({ UNUSED: 0, USED: 2 });
    });

    it('does not fail on a template whose checklist is not an array', async () => {
      // נתונים ישנים או ידניים. שבירה כאן הייתה מפילה את כל דף המחירון.
      await service.create(A, { code: 'X', description: 'x', price: '1' });
      await template(A, 'broken', { not: 'an array' });
      await expect(service.findAll(A, {})).resolves.toHaveLength(1);
    });
  });
});
