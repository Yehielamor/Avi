import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';

import { TasksService } from './tasks.service';
import type { PrismaService, TenantClient } from '../../database/prisma.service';

/**
 * TasksService הוא הנקודה שבה "משימה נסגרה" נקבע, וכל שאר המודולים
 * (מלאי, חיוב, מיילים) תלויים בה. ארבעה כשלים שנמצאו בביקורת מכוסים כאן:
 *
 *   • סגירה כפולה פלטה 'task.closed' פעמיים — ניכוי מלאי כפול ומייל
 *     שני ללקוח. `updateMany` עם `status: { not: CLOSED }` ו-count=0
 *     הוא מה שמונע את זה, ולכן count=0 חייב לא לכתוב audit ולא outbox.
 *   • `where: { id }` בלי tenantId אפשר לסגור — ולקרוא בחזרה — משימה
 *     של טננט אחר.
 *   • ה-outbox נכתב באותה טרנזקציה של שינוי המצב; אחרת האירוע והשינוי
 *     יכולים להיפרד.
 *   • `assignedToMe` נגזר מהטוקן, לא ממזהה שהלקוח שולח.
 */
describe('TasksService', () => {
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const OTHER_TENANT = '99999999-9999-9999-9999-999999999999';
  const TASK = '22222222-2222-2222-2222-222222222222';
  const ACTOR = '33333333-3333-3333-3333-333333333333';
  const CUSTOMER = '44444444-4444-4444-4444-444444444444';
  const TEMPLATE = '55555555-5555-5555-5555-555555555555';

  /** יומן קריאות; 'BEGIN'/'COMMIT' מסמנים את גבולות הטרנזקציה. */
  let log: string[];
  let tx: {
    task: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
    customer: { findFirst: jest.Mock };
    jobTypeTemplate: { findFirst: jest.Mock };
    auditLog: { create: jest.Mock };
    outboxEvent: { create: jest.Mock };
  };
  let forTenant: jest.Mock;
  let service: TasksService;

  /** מעטפת שמתעדת את שם הקריאה ביומן לפני שהיא מחזירה ערך. */
  const traced = (name: string, impl: (args: unknown) => unknown): jest.Mock =>
    jest.fn((args: unknown) => {
      log.push(name);
      return Promise.resolve(impl(args));
    });

  beforeEach(() => {
    log = [];
    tx = {
      task: {
        findMany: traced('task.findMany', () => []),
        findFirst: traced('task.findFirst', () => ({ id: TASK })),
        create: traced('task.create', () => ({ id: TASK })),
        updateMany: traced('task.updateMany', () => ({ count: 1 })),
      },
      customer: { findFirst: traced('customer.findFirst', () => ({ id: CUSTOMER })) },
      jobTypeTemplate: {
        findFirst: traced('template.findFirst', () => ({
          id: TEMPLATE,
          defaultChecklist: [{ label: 'check', done: false }],
          defaultPriority: 1,
        })),
      },
      auditLog: { create: traced('audit.create', () => ({ id: 'audit-1' })) },
      outboxEvent: { create: traced('outbox.create', () => ({ id: 'outbox-1' })) },
    };

    forTenant = jest.fn(async (_tenantId: string, fn: (c: TenantClient) => Promise<unknown>) => {
      log.push('BEGIN');
      try {
        return await fn(tx as unknown as TenantClient);
      } finally {
        log.push('COMMIT');
      }
    });

    // הלקוח החשוף מכיל *רק* forTenant. כל ניסיון לכתוב מחוץ לטרנזקציה
    // ייפול כאן על undefined, בדיוק כמו שהוא נופל ב-RLS בפרודקשן.
    service = new TasksService({ forTenant } as unknown as PrismaService);
  });

  const whereOf = (call: jest.Mock): Record<string, unknown> =>
    (call.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;

  // ---------------------------------------------------------------------------

  describe('findAll', () => {
    it('runs through forTenant with the tenant from the request', async () => {
      await service.findAll(TENANT);
      expect(forTenant).toHaveBeenCalledWith(TENANT, expect.any(Function));
    });

    it('never loads the whole assigned user row (it holds passwordHash)', async () => {
      await service.findAll(TENANT);
      expect(tx.task.findMany.mock.calls[0]?.[0].include.assignedTo).toEqual({
        select: { id: true, name: true, role: true },
      });
    });

    it('defaults the page size to 50', async () => {
      await service.findAll(TENANT);
      expect(tx.task.findMany.mock.calls[0]?.[0]).toMatchObject({ take: 50 });
    });

    it('honours an explicit take', async () => {
      await service.findAll(TENANT, { take: 10 });
      expect(tx.task.findMany.mock.calls[0]?.[0]).toMatchObject({ take: 10 });
    });

    it('does not clamp an oversized take — the only cap is the DTO', async () => {
      // מתעד פער ידוע: `@Max(100)` יושב ב-ListTasksQueryDto בלבד, ולכן
      // כל קורא פנימי (worker, שירות אחר) יכול לבקש עמוד בכל גודל.
      await service.findAll(TENANT, { take: 100_000 });
      expect(tx.task.findMany.mock.calls[0]?.[0]).toMatchObject({ take: 100_000 });
    });

    it('scopes the query to the tenant', async () => {
      await service.findAll(TENANT, { status: TaskStatus.NEW });
      expect(whereOf(tx.task.findMany)).toMatchObject({ tenantId: TENANT, status: TaskStatus.NEW });
    });

    it('filters assignedToMe by the actor from the token', async () => {
      await service.findAll(TENANT, { assignedToMe: true }, ACTOR);
      expect(whereOf(tx.task.findMany)).toMatchObject({ assignedToUserId: ACTOR });
    });

    it('rejects assignedToMe without an authenticated actor instead of listing everything', async () => {
      // נפילה אחורה ל"בלי סינון" הייתה נותנת לטכנאי את כל תור הטננט.
      await expect(service.findAll(TENANT, { assignedToMe: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(tx.task.findMany).not.toHaveBeenCalled();
    });

    it('does not filter by assignee when assignedToMe is absent', async () => {
      await service.findAll(TENANT, {}, ACTOR);
      expect(whereOf(tx.task.findMany)).not.toHaveProperty('assignedToUserId');
    });

    it('orders by priority first when urgentFirst is set', async () => {
      await service.findAll(TENANT, { urgentFirst: true });
      const args = tx.task.findMany.mock.calls[0]?.[0] as { orderBy: Array<Record<string, string>> };
      expect(args.orderBy[0]).toEqual({ priority: 'asc' });
    });

    it('orders by recency by default', async () => {
      await service.findAll(TENANT);
      const args = tx.task.findMany.mock.calls[0]?.[0] as { orderBy: Array<Record<string, string>> };
      expect(args.orderBy[0]).toEqual({ createdAt: 'desc' });
    });

    it('skips the cursor row so a page is never repeated', async () => {
      await service.findAll(TENANT, { cursor: TASK });
      expect(tx.task.findMany.mock.calls[0]?.[0]).toMatchObject({ cursor: { id: TASK }, skip: 1 });
    });

    it('returns the last id as nextCursor when the page is full', async () => {
      tx.task.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      const page = await service.findAll(TENANT, { take: 2 });
      expect(page.nextCursor).toBe('b');
    });

    it('returns a null nextCursor on a partial page', async () => {
      tx.task.findMany.mockResolvedValue([{ id: 'a' }]);
      const page = await service.findAll(TENANT, { take: 2 });
      expect(page.nextCursor).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------

  describe('findOne', () => {
    it('carries the tenantId in the where clause', async () => {
      // בלי זה `GET /tasks/:id` עם מזהה של טננט אחר החזיר את השורה המלאה.
      await service.findOne(TENANT, TASK);
      expect(whereOf(tx.task.findFirst)).toEqual({ id: TASK, tenantId: TENANT });
    });

    it('throws 404 rather than returning null', async () => {
      tx.task.findFirst.mockResolvedValue(null);
      await expect(service.findOne(TENANT, TASK)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------

  describe('createManual', () => {
    const params = { customerId: CUSTOMER, jobTypeTemplateId: TEMPLATE, title: 'שיפוץ' };

    it('verifies the customer belongs to the tenant', async () => {
      await service.createManual(TENANT, params, ACTOR);
      expect(whereOf(tx.customer.findFirst)).toEqual({ id: CUSTOMER, tenantId: TENANT });
    });

    it('throws 404 and creates nothing when the customer is another tenant’s', async () => {
      // בלי הבדיקה, ה-FK היה נופל כשגיאת DB אטומה במקום 404 ברור.
      tx.customer.findFirst.mockResolvedValue(null);

      await expect(service.createManual(TENANT, params, ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tx.task.create).not.toHaveBeenCalled();
      expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    });

    it('verifies the job type template belongs to the tenant', async () => {
      tx.jobTypeTemplate.findFirst.mockResolvedValue(null);
      await expect(service.createManual(TENANT, params, ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tx.task.create).not.toHaveBeenCalled();
    });

    it('applies the template defaults to the new task', async () => {
      await service.createManual(TENANT, params, ACTOR);
      expect(tx.task.create.mock.calls[0]?.[0]).toMatchObject({
        data: expect.objectContaining({
          tenantId: TENANT,
          source: 'MANUAL',
          priority: 1,
          checklist: [{ label: 'check', done: false }],
        }),
      });
    });

    it('stores a missing customFields as DbNull rather than a literal null', async () => {
      await service.createManual(TENANT, params, ACTOR);
      const data = (tx.task.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
      expect(data.customFields).toBe(Prisma.DbNull);
    });

    it('writes the audit row and the outbox event inside the same transaction', async () => {
      await service.createManual(TENANT, params, ACTOR);
      expect(log.filter((l) => l === 'BEGIN')).toHaveLength(1);
      expect(log).toEqual([
        'BEGIN',
        'template.findFirst',
        'customer.findFirst',
        'task.create',
        'audit.create',
        'outbox.create',
        'COMMIT',
      ]);
    });

    it('attributes the audit row to the acting user', async () => {
      await service.createManual(TENANT, params, ACTOR);
      expect(tx.auditLog.create.mock.calls[0]?.[0]).toMatchObject({
        data: expect.objectContaining({ tenantId: TENANT, userId: ACTOR, action: 'task.created' }),
      });
    });
  });

  // ---------------------------------------------------------------------------

  describe('close', () => {
    it('conditions the update on the tenant and on the task not being closed', async () => {
      await service.close(TENANT, TASK, undefined, ACTOR);
      expect(whereOf(tx.task.updateMany)).toEqual({
        id: TASK,
        tenantId: TENANT,
        status: { not: TaskStatus.CLOSED },
      });
    });

    it('writes audit and outbox on a real close', async () => {
      const result = await service.close(TENANT, TASK, [{ label: 'a', done: true }], ACTOR);

      expect(result).toEqual({ taskId: TASK, status: TaskStatus.CLOSED, alreadyClosed: false });
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
      expect(tx.outboxEvent.create.mock.calls[0]?.[0]).toMatchObject({
        data: { tenantId: TENANT, eventName: 'task.closed', payload: { tenantId: TENANT, taskId: TASK } },
      });
    });

    it('writes the outbox event inside the same transaction as the state change', async () => {
      // זו כל הנקודה של ה-outbox: אירוע שנכתב אחרי ה-commit יכול
      // להיכתב על סגירה שלא התרחשה, או להיעלם כשהסגירה כן התרחשה.
      await service.close(TENANT, TASK, undefined, ACTOR);
      expect(log).toEqual(['BEGIN', 'task.updateMany', 'audit.create', 'outbox.create', 'COMMIT']);
      expect(forTenant).toHaveBeenCalledTimes(1);
    });

    describe('when the task is already closed (count: 0)', () => {
      beforeEach(() => {
        tx.task.updateMany.mockResolvedValue({ count: 0 });
        tx.task.findFirst.mockResolvedValue({ id: TASK });
      });

      it('reports alreadyClosed instead of throwing', async () => {
        await expect(service.close(TENANT, TASK, undefined, ACTOR)).resolves.toEqual({
          taskId: TASK,
          status: TaskStatus.CLOSED,
          alreadyClosed: true,
        });
      });

      it('writes no second outbox event', async () => {
        // אירוע שני = ניכוי מלאי כפול ומייל שני ללקוח. זה הבאג המקורי.
        await service.close(TENANT, TASK, undefined, ACTOR);
        expect(tx.outboxEvent.create).not.toHaveBeenCalled();
      });

      it('writes no second audit row', async () => {
        await service.close(TENANT, TASK, undefined, ACTOR);
        expect(tx.auditLog.create).not.toHaveBeenCalled();
      });

      it('scopes the existence probe to the tenant', async () => {
        await service.close(TENANT, TASK, undefined, ACTOR);
        expect(whereOf(tx.task.findFirst)).toEqual({ id: TASK, tenantId: TENANT });
      });

      it('throws 404 when the id belongs to another tenant', async () => {
        // משימה של טננט אחר אינה נראית מכאן, ולכן היא 404 ולא "כבר סגורה".
        tx.task.findFirst.mockResolvedValue(null);
        await expect(service.close(TENANT, TASK, undefined, ACTOR)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(tx.outboxEvent.create).not.toHaveBeenCalled();
      });
    });

    it('cannot close a task belonging to another tenant', async () => {
      // updateMany מסונן ב-tenantId, כך שקריאה חוצת-טננט מגיעה ל-count=0
      // ואז ל-404 — בלי לכתוב, ובלי להחזיר את השורה של הקורבן.
      tx.task.updateMany.mockResolvedValue({ count: 0 });
      tx.task.findFirst.mockResolvedValue(null);

      await expect(service.close(OTHER_TENANT, TASK, [{ label: 'x', done: true }])).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(whereOf(tx.task.updateMany)).toMatchObject({ tenantId: OTHER_TENANT });
    });

    it('overwrites the checklist only when one was supplied', async () => {
      // בלי התנאי, סגירה בלי checklist הייתה מוחקת את זה שכבר נשמר.
      await service.close(TENANT, TASK, undefined, ACTOR);
      const data = (tx.task.updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
      expect(data).not.toHaveProperty('checklist');
    });

    it('stores the supplied checklist', async () => {
      const checklist = [{ label: 'a', done: true, sku: 'S1', qty: 2 }];
      await service.close(TENANT, TASK, checklist, ACTOR);
      expect(tx.task.updateMany.mock.calls[0]?.[0]).toMatchObject({ data: { checklist } });
    });

    it('records the closing user and the checklist size in the audit row', async () => {
      await service.close(TENANT, TASK, [{ label: 'a', done: true }], ACTOR);
      expect(tx.auditLog.create.mock.calls[0]?.[0]).toMatchObject({
        data: expect.objectContaining({
          userId: ACTOR,
          action: 'task.closed',
          entityId: TASK,
          metadata: { checklistItems: 1 },
        }),
      });
    });
  });

  // ---------------------------------------------------------------------------

  describe('createFromEmail', () => {
    it('keeps the LLM-supplied priority when present and falls back to the template otherwise', async () => {
      await service.createFromEmail(TENANT, {
        customerId: CUSTOMER,
        title: 'דליפה',
        sourceEmailId: 'msg-1',
        jobTypeTemplateId: TEMPLATE,
        priority: 3,
      });
      expect(tx.task.create.mock.calls[0]?.[0]).toMatchObject({ data: { priority: 3 } });

      tx.task.create.mockClear();
      await service.createFromEmail(TENANT, {
        customerId: CUSTOMER,
        title: 'דליפה',
        sourceEmailId: 'msg-2',
        jobTypeTemplateId: TEMPLATE,
      });
      expect(tx.task.create.mock.calls[0]?.[0]).toMatchObject({ data: { priority: 1 } });
    });

    it('leaves the task raw when the extraction matched no template', async () => {
      await service.createFromEmail(TENANT, {
        customerId: CUSTOMER,
        title: 'דליפה',
        sourceEmailId: 'msg-3',
        jobTypeTemplateId: null,
      });

      expect(tx.jobTypeTemplate.findFirst).not.toHaveBeenCalled();
      expect(tx.task.create.mock.calls[0]?.[0]).toMatchObject({
        data: { jobTypeTemplateId: null, priority: 2 },
      });
    });

    it('writes the outbox event inside the same transaction', async () => {
      await service.createFromEmail(TENANT, {
        customerId: CUSTOMER,
        title: 'דליפה',
        sourceEmailId: 'msg-4',
      });
      expect(log).toEqual(['BEGIN', 'task.create', 'audit.create', 'outbox.create', 'COMMIT']);
    });
  });
});
