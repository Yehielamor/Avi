import type { Job } from 'bullmq';

import { DomainEventsProcessor } from './domain-events.processor';
import type { AlertService } from '../alerting/alert.service';
import type { PrismaService } from '../database/prisma.service';
import type { CommsService } from '../modules/comms/comms.service';
import type { InventoryService } from '../modules/inventory/inventory.service';
import type { InvoicingService } from '../modules/invoicing/invoicing.service';
import type { SchedulingService } from '../modules/scheduling/scheduling.service';
import { EVENT, type DomainEventJob } from './queue.constants';

/**
 * הצרכן הוא המקום שבו "פעולה עסקית התרחשה" נקבע. שלוש התנהגויות
 * חייבות להיות נכונות, וכל אחת מהן הייתה באג בגרסה הקודמת:
 *
 *   • handler שנכשל לא מונע מהאחרים לרוץ (קודם: `emit` בלי תפיסה
 *     הפיל את *התהליך*)
 *   • כישלון נרשם ונזרק מחדש כדי ש-BullMQ ינסה שוב (בליעה הייתה
 *     מסמנת הצלחה על עבודה שלא בוצעה)
 *   • אחרי מיצוי הניסיונות השורה מסומנת DEAD, לא נשכחת
 */
describe('DomainEventsProcessor', () => {
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const TASK = '22222222-2222-2222-2222-222222222222';

  let executeRaw: jest.Mock;
  let scheduling: { handleTaskCreated: jest.Mock };
  let inventory: { handleTaskClosed: jest.Mock };
  let invoicing: { validateClosedTask: jest.Mock };
  let comms: { handleTaskCreated: jest.Mock; handleTaskClosed: jest.Mock };
  let alertSend: jest.Mock;
  let processor: DomainEventsProcessor;

  const makeJob = (eventName: string, payload: unknown, attemptsMade = 0, attempts = 5): Job<DomainEventJob> =>
    ({
      data: { outboxEventId: 'out-1', tenantId: TENANT, eventName, payload },
      attemptsMade,
      opts: { attempts },
    }) as unknown as Job<DomainEventJob>;

  /** ה-SQL נשלח כ-template literal; מחברים לטקסט אחד לצורך בדיקה. */
  const sqlCalls = (): string[] =>
    executeRaw.mock.calls.map((c) => {
      const parts = c[0] as { raw?: string[] } | string[];
      const raw = Array.isArray(parts) ? parts : (parts.raw ?? []);
      return raw.join('?') + ' :: ' + c.slice(1).join(',');
    });

  beforeEach(() => {
    executeRaw = jest.fn().mockResolvedValue(1);
    const prisma = { untenanted: { $executeRaw: executeRaw } } as unknown as PrismaService;

    scheduling = { handleTaskCreated: jest.fn().mockResolvedValue(undefined) };
    inventory = { handleTaskClosed: jest.fn().mockResolvedValue(undefined) };
    invoicing = { validateClosedTask: jest.fn().mockResolvedValue(undefined) };
    comms = {
      handleTaskCreated: jest.fn().mockResolvedValue(undefined),
      handleTaskClosed: jest.fn().mockResolvedValue(undefined),
    };

    alertSend = jest.fn().mockResolvedValue(undefined);
    const alerts = { send: alertSend } as unknown as AlertService;

    processor = new DomainEventsProcessor(
      prisma,
      alerts,
      scheduling as unknown as SchedulingService,
      inventory as unknown as InventoryService,
      invoicing as unknown as InvoicingService,
      comms as unknown as CommsService,
    );
  });

  describe('routing', () => {
    it('fans task.created out to scheduling and comms', async () => {
      await processor.process(makeJob(EVENT.TASK_CREATED, { taskId: TASK, source: 'EMAIL' }));

      const args = { tenantId: TENANT, taskId: TASK, source: 'EMAIL' };
      expect(scheduling.handleTaskCreated).toHaveBeenCalledWith(args);
      expect(comms.handleTaskCreated).toHaveBeenCalledWith(args);
      expect(inventory.handleTaskClosed).not.toHaveBeenCalled();
    });

    it('fans task.closed out to inventory, invoicing and comms', async () => {
      await processor.process(makeJob(EVENT.TASK_CLOSED, { taskId: TASK }));

      const args = { tenantId: TENANT, taskId: TASK };
      expect(inventory.handleTaskClosed).toHaveBeenCalledWith(args);
      expect(invoicing.validateClosedTask).toHaveBeenCalledWith(args);
      expect(comms.handleTaskClosed).toHaveBeenCalledWith(args);
    });

    it('marks an unknown event DONE rather than retrying it forever', async () => {
      await processor.process(makeJob('something.unknown', { taskId: TASK }));
      expect(sqlCalls().join('|')).toContain('DONE');
    });

    it('always applies the tenantId from the job, never from the payload', async () => {
      // ה-payload הוא JSON מה-DB. אילו tenantId נלקח ממנו, שורת
      // outbox פגומה הייתה מפעילה handlers על טננט אחר.
      await processor.process(
        makeJob(EVENT.TASK_CLOSED, { taskId: TASK, tenantId: '99999999-9999-9999-9999-999999999999' }),
      );
      expect(inventory.handleTaskClosed).toHaveBeenCalledWith({ tenantId: TENANT, taskId: TASK });
    });
  });

  describe('payload validation', () => {
    it('rejects a payload without a taskId', async () => {
      await expect(processor.process(makeJob(EVENT.TASK_CLOSED, {}))).rejects.toThrow();
      expect(inventory.handleTaskClosed).not.toHaveBeenCalled();
    });

    it('rejects a taskId that is not a uuid', async () => {
      await expect(processor.process(makeJob(EVENT.TASK_CLOSED, { taskId: 'nope' }))).rejects.toThrow();
    });
  });

  describe('failure handling', () => {
    it('runs every handler even when one fails', async () => {
      inventory.handleTaskClosed.mockRejectedValue(new Error('stock exploded'));

      await expect(processor.process(makeJob(EVENT.TASK_CLOSED, { taskId: TASK }))).rejects.toThrow();

      // ניכוי מלאי שנכשל לא אמור למנוע מהלקוח לקבל את המייל.
      expect(comms.handleTaskClosed).toHaveBeenCalled();
      expect(invoicing.validateClosedTask).toHaveBeenCalled();
    });

    it('rethrows so BullMQ schedules a retry', async () => {
      comms.handleTaskClosed.mockRejectedValue(new Error('smtp down'));
      await expect(processor.process(makeJob(EVENT.TASK_CLOSED, { taskId: TASK }))).rejects.toThrow();
    });

    it('does not mark the event DONE when a handler failed', async () => {
      comms.handleTaskClosed.mockRejectedValue(new Error('smtp down'));
      await expect(processor.process(makeJob(EVENT.TASK_CLOSED, { taskId: TASK }))).rejects.toThrow();
      expect(sqlCalls().join('|')).not.toContain("'DONE'");
    });

    it('marks the event DEAD once attempts are exhausted', async () => {
      comms.handleTaskClosed.mockRejectedValue(new Error('smtp down'));

      await expect(
        processor.process(makeJob(EVENT.TASK_CLOSED, { taskId: TASK }, 4, 5)),
      ).rejects.toThrow();

      expect(executeRaw.mock.calls.flat().join('|')).toContain('DEAD');
    });

    it('raises a critical alert when an event goes DEAD', async () => {
      // DEAD בלי התראה הוא כשל שקט: הפעולה העסקית לא התרחשה ואיש
      // לא יודע. הרישום ללוג לבדו לא נקרא עד שמישהו מתלונן.
      comms.handleTaskClosed.mockRejectedValue(new Error('smtp down'));

      await expect(
        processor.process(makeJob(EVENT.TASK_CLOSED, { taskId: TASK }, 4, 5)),
      ).rejects.toThrow();

      expect(alertSend).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'critical', event: 'outbox.dead' }),
      );
    });

    it('does not alert while retries remain', async () => {
      // התראה על כל ניסיון כושל הופכת את הערוץ לרעש, ואז מתעלמים
      // ממנו גם כשהוא צודק.
      comms.handleTaskClosed.mockRejectedValue(new Error('smtp down'));

      await expect(
        processor.process(makeJob(EVENT.TASK_CLOSED, { taskId: TASK }, 1, 5)),
      ).rejects.toThrow();

      expect(alertSend).not.toHaveBeenCalled();
    });

    it('keeps the event retryable while attempts remain', async () => {
      comms.handleTaskClosed.mockRejectedValue(new Error('smtp down'));

      await expect(
        processor.process(makeJob(EVENT.TASK_CLOSED, { taskId: TASK }, 1, 5)),
      ).rejects.toThrow();

      const flat = executeRaw.mock.calls.flat().join('|');
      expect(flat).toContain('PROCESSING');
      expect(flat).not.toContain('DEAD');
    });
  });

  describe('success', () => {
    it('marks the event DONE when every handler succeeded', async () => {
      await processor.process(makeJob(EVENT.TASK_CLOSED, { taskId: TASK }));
      expect(executeRaw.mock.calls.flat().join('|')).toContain('DONE');
    });
  });
});
