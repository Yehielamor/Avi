import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { InvoicingService } from './invoicing.service';
import { generateInvoicePdf } from './invoice-pdf.util';
import type { PrismaService, TenantClient } from '../../database/prisma.service';
import type { IntegrationsService } from '../integrations/integrations.service';

jest.mock('./invoice-pdf.util', () => ({
  generateInvoicePdf: jest.fn(),
}));

const generatePdfMock = generateInvoicePdf as jest.MockedFunction<typeof generateInvoicePdf>;

/**
 * הפקת חשבונית.
 *
 * ארבעה דברים נבדקים כאן, וכל אחד מהם היה באג בפועל:
 *
 *   • כסף שעבר דרך `Number()` — `totalAmount` לא הסתדר עם SUM של
 *     השורות של אותה חשבונית עצמה, בגרושים.
 *   • priceCode שאין לו שורת מחירון פעילה חויב באפס במקום להידלג.
 *   • משימה חויבה פעמיים, כי הבדיקה הייתה findFirst-ואז-create.
 *   • שני מנהלים שלחצו "הפק" יחד קיבלו את אותו invoiceNumber.
 */
describe('InvoicingService', () => {
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const OTHER_TENANT = '33333333-3333-3333-3333-333333333333';
  const CUSTOMER = '22222222-2222-2222-2222-222222222222';
  const PERIOD = { periodStart: new Date('2026-01-01T00:00:00Z'), periodEnd: new Date('2026-01-31T23:59:59Z') };

  /** לוג קריאות לפי הטרנזקציה שבה בוצעו — כדי להוכיח מה רץ *באותה* טרנזקציה. */
  let trace: string[];
  let txDepth: number;
  /** ה-tx שנמסר ל-forTenant. נשמר כדי שבדיקות שמחליפות את המימוש
   *  יוכלו למסור בדיוק את אותו לקוח ולא כפיל חלקי. */
  let txClient: TenantClient;

  let customerFindFirst: jest.Mock;
  let tenantFindFirstOrThrow: jest.Mock;
  let lineItemFindMany: jest.Mock;
  let lineItemCreateMany: jest.Mock;
  let taskFindMany: jest.Mock;
  let taskFindFirst: jest.Mock;
  let priceListFindMany: jest.Mock;
  let invoiceCreate: jest.Mock;
  let invoiceUpdate: jest.Mock;
  let invoiceFindFirstOrThrow: jest.Mock;
  let executeRaw: jest.Mock;
  let queryRaw: jest.Mock;
  let forTenant: jest.Mock;
  let driveSend: jest.Mock;
  let getConnector: jest.Mock;
  let service: InvoicingService;

  /** עוטף mock כך שכל קריאה נרשמת עם מספר הטרנזקציה הפעילה. */
  const traced =
    (name: string, mock: jest.Mock) =>
    (...args: unknown[]): unknown => {
      trace.push(`tx${txDepth}:${name}`);
      return mock(...args);
    };

  const decimal = (v: string) => new Prisma.Decimal(v);

  const priceItem = (code: string, price: string, description = `desc-${code}`) => ({
    code,
    description,
    price: decimal(price),
  });

  const lineItemArgs = () => lineItemCreateMany.mock.calls[0]?.[0] as {
    data: Array<{ invoiceId: string; taskId: string; priceCode: string; description: string; amount: Prisma.Decimal }>;
  };

  const invoiceArgs = () => invoiceCreate.mock.calls[0]?.[0] as {
    data: { invoiceNumber: number; totalAmount: Prisma.Decimal; status: string; tenantId: string };
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    trace = [];
    txDepth = 0;

    customerFindFirst = jest.fn().mockResolvedValue({ id: CUSTOMER, name: 'לקוח א' });
    tenantFindFirstOrThrow = jest.fn().mockResolvedValue({ name: 'עסק בע"מ' });
    lineItemFindMany = jest.fn().mockResolvedValue([]);
    lineItemCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    taskFindMany = jest.fn().mockResolvedValue([
      { id: 'task-1', checklist: [{ label: 'a', done: true, priceCode: 'AC-FIX' }] },
    ]);
    taskFindFirst = jest.fn().mockResolvedValue(null);
    priceListFindMany = jest.fn().mockResolvedValue([priceItem('AC-FIX', '100.00')]);
    invoiceCreate = jest.fn().mockResolvedValue({ id: 'inv-1', invoiceNumber: 7 });
    invoiceUpdate = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => ({
      id: 'inv-1',
      ...args.data,
    }));
    invoiceFindFirstOrThrow = jest.fn().mockResolvedValue({ id: 'inv-1', status: 'DRAFT' });
    executeRaw = jest.fn().mockResolvedValue(1);
    queryRaw = jest.fn().mockResolvedValue([{ next: 7n }]);

    txClient = {
      customer: { findFirst: traced('customer.findFirst', customerFindFirst) },
      tenant: { findFirstOrThrow: traced('tenant.findFirstOrThrow', tenantFindFirstOrThrow) },
      invoiceLineItem: {
        findMany: traced('lineItem.findMany', lineItemFindMany),
        createMany: traced('lineItem.createMany', lineItemCreateMany),
      },
      task: {
        findMany: traced('task.findMany', taskFindMany),
        findFirst: traced('task.findFirst', taskFindFirst),
      },
      priceListItem: { findMany: traced('priceList.findMany', priceListFindMany) },
      invoice: {
        create: traced('invoice.create', invoiceCreate),
        update: traced('invoice.update', invoiceUpdate),
        findFirstOrThrow: traced('invoice.findFirstOrThrow', invoiceFindFirstOrThrow),
      },
      $executeRaw: traced('$executeRaw', executeRaw),
      $queryRaw: traced('$queryRaw', queryRaw),
    } as unknown as TenantClient;

    forTenant = jest.fn(async (_tenantId: string, fn: (t: TenantClient) => Promise<unknown>) => {
      txDepth += 1;
      return fn(txClient);
    });
    const prisma = { forTenant } as unknown as PrismaService;

    driveSend = jest.fn().mockResolvedValue({ fileId: 'drive-file-1' });
    getConnector = jest.fn().mockResolvedValue({ send: driveSend });
    const integrations = { getConnector } as unknown as IntegrationsService;

    generatePdfMock.mockResolvedValue(Buffer.from('pdf'));

    service = new InvoicingService(prisma, integrations);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==========================================================
  // כסף. הבדיקה החשובה ביותר בקובץ.
  // ==========================================================
  describe('money stays in Prisma.Decimal', () => {
    it('sums 0.1 + 0.2 to exactly 0.3, not 0.30000000000000004', async () => {
      // הסכומים האלה נבחרו כי הם חושפים את שגיאת ה-float הבינארית.
      // עם `Number()` ו-reduce התוצאה הייתה 0.30000000000000004,
      // ו-totalAmount לא היה שווה ל-SUM של השורות שלו עצמו.
      priceListFindMany.mockResolvedValue([priceItem('A', '0.1'), priceItem('B', '0.2')]);
      taskFindMany.mockResolvedValue([
        {
          id: 'task-1',
          checklist: [
            { label: 'a', done: true, priceCode: 'A' },
            { label: 'b', done: true, priceCode: 'B' },
          ],
        },
      ]);

      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      const total = invoiceArgs().data.totalAmount;
      expect(total).toBeInstanceOf(Prisma.Decimal);
      expect(total.toString()).toBe('0.3');
      expect(total.equals(decimal('0.3'))).toBe(true);
      // ההוכחה שזה לא היה יוצא מעצמו:
      expect(0.1 + 0.2).not.toBe(0.3);
    });

    it('writes a totalAmount that equals the sum of the line items it was written with', async () => {
      // זו התכונה היחידה שחשובה באמת: החשבונית מסתדרת עם עצמה.
      priceListFindMany.mockResolvedValue([
        priceItem('A', '0.1'),
        priceItem('B', '0.2'),
        priceItem('C', '1.15'),
        priceItem('D', '33.33'),
      ]);
      taskFindMany.mockResolvedValue([
        {
          id: 'task-1',
          checklist: ['A', 'B', 'C', 'D'].map((priceCode) => ({ label: priceCode, done: true, priceCode })),
        },
      ]);

      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      const rows = lineItemArgs().data;
      const sum = rows.reduce((acc, li) => acc.add(li.amount), decimal('0'));
      const total = invoiceArgs().data.totalAmount;
      expect(total.equals(sum)).toBe(true);
      expect(total.toString()).toBe('34.78');
    });

    it('keeps every line item amount a Decimal, never a number', async () => {
      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });
      for (const li of lineItemArgs().data) {
        expect(li.amount).toBeInstanceOf(Prisma.Decimal);
        expect(typeof li.amount).not.toBe('number');
      }
    });

    it('does not drift when the same price repeats across many line items', async () => {
      // 300 שורות של 0.07 — בדיוק המקרה שבו שגיאת float מצטברת עד
      // לגרושים שלמים.
      priceListFindMany.mockResolvedValue([priceItem('A', '0.07')]);
      taskFindMany.mockResolvedValue(
        Array.from({ length: 300 }, (_unused, i) => ({
          id: `task-${i}`,
          checklist: [{ label: 'a', done: true, priceCode: 'A' }],
        })),
      );

      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      expect(invoiceArgs().data.totalAmount.toString()).toBe('21');
    });

    it('passes the same Decimal total to the PDF as to the database row', async () => {
      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });
      const pdfArg = generatePdfMock.mock.calls[0]?.[0];
      expect(pdfArg?.totalAmount.equals(invoiceArgs().data.totalAmount)).toBe(true);
    });
  });

  // ==========================================================
  // בניית השורות מה-checklist
  // ==========================================================
  describe('line items are built from matched checklist entries', () => {
    it('bills one line per done checklist entry whose priceCode is in the active price list', async () => {
      priceListFindMany.mockResolvedValue([priceItem('A', '10', 'תיקון'), priceItem('B', '20', 'החלפה')]);
      taskFindMany.mockResolvedValue([
        {
          id: 'task-1',
          checklist: [
            { label: 'a', done: true, priceCode: 'A' },
            { label: 'b', done: true, priceCode: 'B' },
          ],
        },
      ]);

      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      expect(lineItemArgs().data).toEqual([
        { invoiceId: 'inv-1', taskId: 'task-1', priceCode: 'A', description: 'תיקון', amount: decimal('10') },
        { invoiceId: 'inv-1', taskId: 'task-1', priceCode: 'B', description: 'החלפה', amount: decimal('20') },
      ]);
    });

    it('skips a priceCode with no active price list entry instead of billing it at zero', async () => {
      // חיוב באפס נראה כמו שורה תקינה בחשבונית ולא מתגלה עד שהלקוח
      // משלם פחות ממה שהוא חייב.
      priceListFindMany.mockResolvedValue([priceItem('A', '10')]);
      taskFindMany.mockResolvedValue([
        {
          id: 'task-1',
          checklist: [
            { label: 'a', done: true, priceCode: 'A' },
            { label: 'ghost', done: true, priceCode: 'NO-SUCH-CODE' },
          ],
        },
      ]);

      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      const rows = lineItemArgs().data;
      expect(rows).toHaveLength(1);
      expect(rows.map((r) => r.priceCode)).toEqual(['A']);
      expect(invoiceArgs().data.totalAmount.toString()).toBe('10');
    });

    it('only asks for active price list entries', async () => {
      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });
      expect(priceListFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT, isActive: true } }),
      );
    });

    it('ignores checklist entries that are not done, and entries with no priceCode', async () => {
      priceListFindMany.mockResolvedValue([priceItem('A', '10'), priceItem('B', '20')]);
      taskFindMany.mockResolvedValue([
        {
          id: 'task-1',
          checklist: [
            { label: 'undone', done: false, priceCode: 'B' },
            { label: 'no code', done: true },
            { label: 'a', done: true, priceCode: 'A' },
          ],
        },
      ]);

      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      expect(lineItemArgs().data.map((r) => r.priceCode)).toEqual(['A']);
    });

    it('tolerates a task with a null checklist', async () => {
      taskFindMany.mockResolvedValue([
        { id: 'task-0', checklist: null },
        { id: 'task-1', checklist: [{ label: 'a', done: true, priceCode: 'AC-FIX' }] },
      ]);

      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      expect(lineItemArgs().data.map((r) => r.taskId)).toEqual(['task-1']);
    });

    it('refuses to create an empty invoice when nothing matched the price list', async () => {
      priceListFindMany.mockResolvedValue([]);
      await expect(service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(invoiceCreate).not.toHaveBeenCalled();
    });

    it('refuses when there are no un-invoiced closed tasks in the period', async () => {
      taskFindMany.mockResolvedValue([]);
      await expect(service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(invoiceCreate).not.toHaveBeenCalled();
    });

    it('rejects a customer that does not belong to the tenant', async () => {
      customerFindFirst.mockResolvedValue(null);
      await expect(service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ==========================================================
  // חיוב כפול
  // ==========================================================
  describe('a task is never billed twice', () => {
    it('excludes tasks that already have a line item for this customer', async () => {
      lineItemFindMany.mockResolvedValue([{ taskId: 'task-old' }, { taskId: null }, { taskId: 'task-older' }]);

      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      expect(taskFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'CLOSED',
            id: { notIn: ['task-old', 'task-older'] },
          }),
        }),
      );
    });

    it('turns the unique violation on (taskId, priceCode) into a 409 instead of a double charge', async () => {
      // הערובה היא ה-constraint, לא בדיקת קריאה מראש: שתי הפקות
      // מקבילות עוברות שתיהן את ה-findMany ורק ה-DB עוצר את השנייה.
      lineItemCreateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['taskId', 'priceCode'] },
        }),
      );

      await expect(service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('does not produce a PDF for an invoice whose line items were rejected', async () => {
      lineItemCreateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.0.0' }),
      );

      await expect(service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD })).rejects.toThrow();

      expect(generatePdfMock).not.toHaveBeenCalled();
      expect(getConnector).not.toHaveBeenCalled();
    });

    it('writes the invoice header and its line items in one transaction, so neither survives alone', async () => {
      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });
      const writeTx = trace.filter((t) => t.startsWith('tx2:'));
      expect(writeTx).toContain('tx2:invoice.create');
      expect(writeTx).toContain('tx2:lineItem.createMany');
    });

    it('rethrows a non-unique database error untouched', async () => {
      // בליעה של כל שגיאה כ-409 הייתה מסתירה תקלת DB אמיתית מאחורי
      // "כבר חויב".
      const boom = new Prisma.PrismaClientKnownRequestError('deadlock', {
        code: 'P2034',
        clientVersion: '5.0.0',
      });
      lineItemCreateMany.mockRejectedValue(boom);

      await expect(service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD })).rejects.toBe(boom);
    });

    it('creates all line items in a single write, so a conflict rolls back every one of them', async () => {
      priceListFindMany.mockResolvedValue([priceItem('A', '10'), priceItem('B', '20')]);
      taskFindMany.mockResolvedValue([
        {
          id: 'task-1',
          checklist: [
            { label: 'a', done: true, priceCode: 'A' },
            { label: 'b', done: true, priceCode: 'B' },
          ],
        },
      ]);

      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      expect(lineItemCreateMany).toHaveBeenCalledTimes(1);
      expect(lineItemArgs().data).toHaveLength(2);
    });
  });

  // ==========================================================
  // מספר חשבונית רץ
  // ==========================================================
  describe('running invoice number', () => {
    const rawSql = (mock: jest.Mock, call = 0): string => {
      const parts = mock.mock.calls[call]?.[0] as { raw?: string[] } | string[] | undefined;
      const raw = Array.isArray(parts) ? parts : (parts?.raw ?? []);
      return raw.join('?');
    };

    it('takes a per-tenant advisory lock before reading the next number', async () => {
      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      expect(rawSql(executeRaw)).toContain('pg_advisory_xact_lock');
      expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(queryRaw.mock.invocationCallOrder[0] ?? 0);
    });

    it('holds the lock in the same transaction that creates the invoice', async () => {
      // נעילה בטרנזקציה נפרדת משתחררת לפני ה-INSERT ולא מונעת כלום.
      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      expect(trace).toEqual(
        expect.arrayContaining(['tx2:$executeRaw', 'tx2:$queryRaw', 'tx2:invoice.create']),
      );
      expect(trace.indexOf('tx2:$executeRaw')).toBeLessThan(trace.indexOf('tx2:invoice.create'));
    });

    it('uses MAX + 1 scoped to the tenant', async () => {
      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      const sql = rawSql(queryRaw);
      expect(sql).toContain('MAX("invoiceNumber")');
      expect(sql).toContain('"tenantId"');
      expect(queryRaw.mock.calls[0]?.slice(1)).toEqual([TENANT]);
    });

    it('writes the allocated number onto the invoice', async () => {
      queryRaw.mockResolvedValue([{ next: 42n }]);
      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });
      expect(invoiceArgs().data.invoiceNumber).toBe(42);
      expect(typeof invoiceArgs().data.invoiceNumber).toBe('number');
    });

    it('serialises two runs of the same tenant on the same lock key', async () => {
      // מפתח נעילה שאינו יציב = שתי הפקות מקבילות שלא רואות זו את זו
      // ומקבלות את אותו מספר.
      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });
      const first = executeRaw.mock.calls[0]?.[1];
      executeRaw.mockClear();
      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });
      expect(executeRaw.mock.calls[0]?.[1]).toBe(first);
      expect(typeof first).toBe('bigint');
    });

    it('does not let one tenant block another', async () => {
      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });
      const first = executeRaw.mock.calls[0]?.[1];
      executeRaw.mockClear();
      await service.generateInvoice(OTHER_TENANT, { customerId: CUSTOMER, ...PERIOD });
      expect(executeRaw.mock.calls[0]?.[1]).not.toBe(first);
    });

    it('keeps the lock key inside the non-negative bigint range', async () => {
      // hash חתום היה מייצר מפתח שלילי לחלק מה-UUID-ים.
      for (const tenant of [TENANT, OTHER_TENANT, 'ffffffff-ffff-ffff-ffff-ffffffffffff']) {
        executeRaw.mockClear();
        await service.generateInvoice(tenant, { customerId: CUSTOMER, ...PERIOD });
        const key = executeRaw.mock.calls[0]?.[1] as bigint;
        expect(key).toBeGreaterThanOrEqual(0n);
        expect(key).toBeLessThan(2n ** 32n);
      }
    });

    it('fails loudly rather than inventing a number when the allocation query returns nothing', async () => {
      queryRaw.mockResolvedValue([]);
      await expect(service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD })).rejects.toThrow(
        /allocate an invoice number/i,
      );
      expect(invoiceCreate).not.toHaveBeenCalled();
    });
  });

  // ==========================================================
  // PDF / Drive — מחוץ לטרנזקציה
  // ==========================================================
  describe('pdf and drive upload', () => {
    it('finalises the invoice with the uploaded file id', async () => {
      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      expect(invoiceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: expect.objectContaining({ status: 'FINALIZED', pdfDriveFileId: 'drive-file-1' }),
        }),
      );
    });

    it('leaves the invoice in DRAFT and does not throw when Drive is unavailable', async () => {
      // איבוד החשבונית בגלל Drive מנותק היה מאלץ הקלדה מחדש של כל
      // השורות.
      getConnector.mockRejectedValue(new Error('Drive not connected'));

      const result = await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      expect(invoiceUpdate).not.toHaveBeenCalled();
      expect(invoiceFindFirstOrThrow).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ status: 'DRAFT' }));
    });

    it('keeps the invoice when PDF rendering itself fails', async () => {
      generatePdfMock.mockRejectedValue(new Error('missing Hebrew font'));

      await expect(service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD })).resolves.toBeDefined();

      expect(invoiceUpdate).not.toHaveBeenCalled();
    });

    it('does not run the PDF or the upload inside a transaction', async () => {
      // קריאת רשת בתוך forTenant מחזיקה חיבור DB לדקות (קונבנציות, §1).
      let insideTx = false;
      generatePdfMock.mockImplementation(async () => {
        insideTx = pendingTx > 0;
        return Buffer.from('pdf');
      });
      let pendingTx = 0;
      forTenant.mockImplementation(async (_t: string, fn: (t: TenantClient) => Promise<unknown>) => {
        txDepth += 1;
        pendingTx += 1;
        try {
          return await fn(txClient);
        } finally {
          pendingTx -= 1;
        }
      });

      await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });

      expect(insideTx).toBe(false);
      expect(driveSend).toHaveBeenCalled();
    });

  });

  // ==========================================================
  // validateClosedTask
  // ==========================================================
  describe('validateClosedTask', () => {
    it('warns about priceCodes that will be skipped at invoice time', async () => {
      taskFindFirst.mockResolvedValue({
        checklist: [
          { label: 'a', done: true, priceCode: 'A' },
          { label: 'b', done: true, priceCode: 'MISSING' },
        ],
      });
      priceListFindMany.mockResolvedValue([{ code: 'A' }]);

      await service.validateClosedTask({ tenantId: TENANT, taskId: 'task-1' });

      expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('MISSING'));
    });

    it('stays quiet when every priceCode resolves', async () => {
      taskFindFirst.mockResolvedValue({ checklist: [{ label: 'a', done: true, priceCode: 'A' }] });
      priceListFindMany.mockResolvedValue([{ code: 'A' }]);

      await service.validateClosedTask({ tenantId: TENANT, taskId: 'task-1' });

      expect(Logger.prototype.warn).not.toHaveBeenCalled();
    });

    it('does not throw for a task that has no checklist', async () => {
      taskFindFirst.mockResolvedValue({ checklist: null });
      await expect(service.validateClosedTask({ tenantId: TENANT, taskId: 'task-1' })).resolves.toBeUndefined();
      expect(priceListFindMany).not.toHaveBeenCalled();
    });

    it('only accepts active price list entries as a match', async () => {
      taskFindFirst.mockResolvedValue({ checklist: [{ label: 'a', done: true, priceCode: 'A' }] });
      priceListFindMany.mockResolvedValue([{ code: 'A' }]);

      await service.validateClosedTask({ tenantId: TENANT, taskId: 'task-1' });

      expect(priceListFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true, tenantId: TENANT }),
        }),
      );
    });
  });

  // ==========================================================
  // קריאה
  // ==========================================================
  describe('reads', () => {
    it('turns another tenant’s invoice id into a 404 instead of null', async () => {
      // בלי זה, חשבונית של טננט אחר נראית בדיוק כמו "לא קיימת".
      const findFirst = jest.fn().mockResolvedValue(null);
      forTenant.mockImplementation(async (_t: string, fn: (t: TenantClient) => Promise<unknown>) =>
        fn({ invoice: { findFirst } } as unknown as TenantClient),
      );

      await expect(service.findOne(TENANT, 'inv-x')).rejects.toBeInstanceOf(NotFoundException);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inv-x', tenantId: TENANT } }),
      );
    });

    it('scopes findAll to the tenant and orders by invoice number', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      forTenant.mockImplementation(async (_t: string, fn: (t: TenantClient) => Promise<unknown>) =>
        fn({ invoice: { findMany } } as unknown as TenantClient),
      );

      await service.findAll(TENANT, CUSTOMER);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, customerId: CUSTOMER },
          orderBy: { invoiceNumber: 'desc' },
        }),
      );
    });
  });

  it('never reaches the database outside forTenant', async () => {
    await service.generateInvoice(TENANT, { customerId: CUSTOMER, ...PERIOD });
    for (const call of forTenant.mock.calls) {
      expect(call[0]).toBe(TENANT);
    }
  });
});
