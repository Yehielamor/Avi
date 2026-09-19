import { NotFoundException } from '@nestjs/common';

import { SchedulingService } from './scheduling.service';
import type { PrismaService, TenantClient } from '../../database/prisma.service';

/** `mock.calls` מוקלד כ-any; כאן הוא נחשף כ-unknown, כך שכל בדיקה חייבת לומר מה היא מצפה למצוא. */
function callsOf(fn: jest.Mock): unknown[][] {
  return fn.mock.calls as unknown[][];
}

/** ארגומנט `arg` של קריאה מספר `call` ל-mock. */
function callArg(fn: jest.Mock, call = 0, arg = 0): unknown {
  return callsOf(fn)[call]?.[arg];
}

/**
 * השיוך האוטומטי הוא כתיבה על משימה, ולכן שתי טעויות כאן אינן
 * "שיוך פחות טוב" אלא נזק:
 *
 *   • קריאה או כתיבה בלי tenantId שייכה משימה של טננט אחר לטכנאי
 *     של הטננט הקורא.
 *   • כתיבה לא מותנית דרסה משימה שנסגרה בין הקריאה לכתיבה.
 *
 * בנוסף נבדק כאן שה-requiredSkill הוא מסנן קשיח ולא ניקוד רך, ושמשקלי
 * הניקוד באמת משנים את התוצאה — משקל שאינו נקרא נראה בדיוק כמו משקל
 * שנקרא, עד שמסתכלים על מי קיבל את העבודה.
 */
describe('SchedulingService', () => {
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const TASK = '22222222-2222-2222-2222-222222222222';
  const NEAR = 'user-a-near-busy';
  const FAR = 'user-b-far-idle';

  // תל אביב מול ירושלים — ~54 ק"מ, מספיק כדי שציון המרחק יבדיל.
  const TASK_LOC = { locationLat: 32.0853, locationLng: 34.7818 };
  const NEAR_HOME = { homeLat: 32.0853, homeLng: 34.7818 };
  const FAR_HOME = { homeLat: 31.7683, homeLng: 35.2137 };

  let tx: {
    tenantConfig: { findUnique: jest.Mock };
    task: { findFirst: jest.Mock; groupBy: jest.Mock; updateMany: jest.Mock };
    outboxEvent: { create: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let forTenant: jest.Mock;
  let service: SchedulingService;

  const candidate = (
    id: string,
    skills: string[],
    home: { homeLat: number | null; homeLng: number | null },
  ) => ({ id, skills, ...home });

  beforeEach(() => {
    tx = {
      tenantConfig: {
        findUnique: jest.fn().mockResolvedValue({
          enabledModules: ['scheduling'],
          schedulingWeights: null,
        }),
      },
      task: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'NEW',
          ...TASK_LOC,
          jobTypeTemplate: { requiredSkill: 'ELECTRICAL' },
        }),
        groupBy: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      outboxEvent: { create: jest.fn().mockResolvedValue({ id: 'outbox-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([candidate(NEAR, ['ELECTRICAL'], NEAR_HOME)]),
    };

    forTenant = jest.fn((_tenantId: string, fn: (c: TenantClient) => Promise<unknown>) =>
      fn(tx as unknown as TenantClient),
    );

    service = new SchedulingService({ forTenant } as unknown as PrismaService);
  });

  /** ה-raw SQL מגיע כ-template literal; מחברים אותו לטקסט אחד. */
  const lockSql = (): string => {
    const parts = callArg(tx.$queryRaw) as { raw?: string[] } | string[] | undefined;
    if (!parts) return '';
    const raw = Array.isArray(parts) ? parts : (parts.raw ?? []);
    return raw.join('?');
  };
  const lockParams = (): unknown[] => (callsOf(tx.$queryRaw)[0] ?? []).slice(1);

  const whereOf = (call: jest.Mock): Record<string, unknown> =>
    (callArg(call) as { where: Record<string, unknown> }).where;

  // ---------------------------------------------------------------------------

  describe('tenant scoping', () => {
    it('reads the task through forTenant with an explicit tenantId', async () => {
      await service.assignTask(TENANT, TASK);

      expect(forTenant).toHaveBeenCalledWith(TENANT, expect.any(Function));
      expect(whereOf(tx.task.findFirst)).toEqual({ id: TASK, tenantId: TENANT });
    });

    it('writes the assignment with an explicit tenantId', async () => {
      // בלי זה `POST /scheduling/:taskId/assign` עם מזהה זר שייך את
      // המשימה של הקורבן לטכנאי של הקורא.
      await service.assignTask(TENANT, TASK);
      expect(whereOf(tx.task.updateMany)).toMatchObject({ id: TASK, tenantId: TENANT });
    });

    it('throws 404 for a task that is not visible to this tenant', async () => {
      tx.task.findFirst.mockResolvedValue(null);
      await expect(service.assignTask(TENANT, TASK)).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.task.updateMany).not.toHaveBeenCalled();
    });

    it('scopes the load count to the tenant', async () => {
      await service.assignTask(TENANT, TASK);
      expect(whereOf(tx.task.groupBy)).toMatchObject({ tenantId: TENANT });
    });
  });

  describe('candidate query', () => {
    it('filters to active FIELD users of this tenant and locks them', async () => {
      await service.assignTask(TENANT, TASK);

      const sql = lockSql();
      expect(sql).toContain('"tenantId"');
      expect(sql).toContain("'FIELD'");
      expect(sql).toContain('"isActive" = true');
      expect(sql).toContain('FOR UPDATE');
      expect(lockParams()).toContain(TENANT);
    });

    it('locks in a stable id order so two concurrent rounds cannot deadlock', async () => {
      await service.assignTask(TENANT, TASK);
      expect(lockSql()).toContain('ORDER BY "id"');
    });

    it('counts load only after the lock', async () => {
      await service.assignTask(TENANT, TASK);
      const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0] ?? 0;
      const countOrder = tx.task.groupBy.mock.invocationCallOrder[0] ?? 0;
      expect(lockOrder).toBeLessThan(countOrder);
    });

    it('reports no field technicians rather than assigning blindly', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(service.assignTask(TENANT, TASK)).resolves.toEqual({
        assigned: false,
        reason: 'no active field technicians',
      });
      expect(tx.task.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('required skill is a hard filter', () => {
    it('assigns a technician that carries the required skill', async () => {
      tx.$queryRaw.mockResolvedValue([
        candidate(FAR, ['PLUMBING'], FAR_HOME),
        candidate(NEAR, ['ELECTRICAL', 'PLUMBING'], NEAR_HOME),
      ]);

      await expect(service.assignTask(TENANT, TASK)).resolves.toEqual({
        assigned: true,
        userId: NEAR,
      });
    });

    it('leaves the task unassigned when nobody has the skill', async () => {
      // מסנן קשיח, לא ניקוד נמוך: טכנאי בלי ההתמחות לא ייבחר גם אם הוא
      // היחיד והקרוב ביותר.
      tx.$queryRaw.mockResolvedValue([candidate(NEAR, ['PLUMBING'], NEAR_HOME)]);

      await expect(service.assignTask(TENANT, TASK)).resolves.toEqual({
        assigned: false,
        reason: 'no technician with required skill "ELECTRICAL"',
      });
      expect(tx.task.updateMany).not.toHaveBeenCalled();
      expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    });

    it('considers every technician when the template requires no skill', async () => {
      tx.task.findFirst.mockResolvedValue({ status: 'NEW', ...TASK_LOC, jobTypeTemplate: null });
      tx.$queryRaw.mockResolvedValue([candidate(NEAR, [], NEAR_HOME)]);

      await expect(service.assignTask(TENANT, TASK)).resolves.toMatchObject({ assigned: true });
    });

    it('BUG — a required skill with a trailing space matches nobody (no normalisation)', async () => {
      // באג פתוח: ההשוואה היא `skills.includes(requiredSkill)` גולמי.
      // requiredSkill שהוקלד עם רווח בסוף משאיר את המשימה לא משויכת
      // לנצח, והיחיד שיודע הוא שורת לוג.
      tx.task.findFirst.mockResolvedValue({
        status: 'NEW',
        ...TASK_LOC,
        jobTypeTemplate: { requiredSkill: 'ELECTRICAL ' },
      });
      tx.$queryRaw.mockResolvedValue([candidate(NEAR, ['ELECTRICAL'], NEAR_HOME)]);

      await expect(service.assignTask(TENANT, TASK)).resolves.toMatchObject({ assigned: false });
    });

    it('BUG — skill matching is case sensitive', async () => {
      tx.$queryRaw.mockResolvedValue([candidate(NEAR, ['electrical'], NEAR_HOME)]);
      await expect(service.assignTask(TENANT, TASK)).resolves.toMatchObject({ assigned: false });
    });
  });

  describe('scoring', () => {
    const twoCandidates = () => {
      tx.$queryRaw.mockResolvedValue([
        candidate(NEAR, ['ELECTRICAL'], NEAR_HOME),
        candidate(FAR, ['ELECTRICAL'], FAR_HOME),
      ]);
      // NEAR יושב על המשימה אבל עמוס; FAR רחוק ופנוי.
      tx.task.groupBy.mockResolvedValue([{ assignedToUserId: NEAR, _count: { _all: 3 } }]);
    };

    const withWeights = (weights: unknown) => {
      tx.tenantConfig.findUnique.mockResolvedValue({
        enabledModules: ['scheduling'],
        schedulingWeights: weights,
      });
    };

    it('picks the nearer technician when distance dominates', async () => {
      twoCandidates();
      withWeights({ skillWeight: 0.5, distanceWeight: 1, loadWeight: 0 });

      await expect(service.assignTask(TENANT, TASK)).resolves.toMatchObject({ userId: NEAR });
    });

    it('picks the idle technician when load dominates', async () => {
      // אותם מועמדים בדיוק, משקלים הפוכים, תוצאה הפוכה — זה מה שמוכיח
      // שהמשקלים באמת נקראים ולא רק מוגדרים.
      twoCandidates();
      withWeights({ skillWeight: 0.5, distanceWeight: 0, loadWeight: 1 });

      await expect(service.assignTask(TENANT, TASK)).resolves.toMatchObject({ userId: FAR });
    });

    it('falls back to the default weights when the config json is malformed', async () => {
      twoCandidates();
      withWeights({ skillWeight: 'heavy', distanceWeight: null });

      // ברירת המחדל (0.3 מרחק, 0.2 עומס) מעדיפה את הקרוב; משקל NaN היה
      // הופך כל ציון ל-NaN ובוחר שרירותית את הראשון.
      await expect(service.assignTask(TENANT, TASK)).resolves.toMatchObject({ userId: NEAR });
    });

    it('does not let a missing location decide the assignment on its own', async () => {
      // טכנאי בלי קואורדינטות מקבל 0.5 קבוע — לא 0 ולא NaN — כדי שהוא
      // יישאר בר-שיוך כשהוא הפנוי היחיד.
      tx.$queryRaw.mockResolvedValue([
        candidate(NEAR, ['ELECTRICAL'], { homeLat: null, homeLng: null }),
      ]);

      await expect(service.assignTask(TENANT, TASK)).resolves.toEqual({
        assigned: true,
        userId: NEAR,
      });
    });
  });

  describe('guarded write', () => {
    it('only assigns a task that is still NEW or ASSIGNED', async () => {
      await service.assignTask(TENANT, TASK);
      expect(whereOf(tx.task.updateMany)).toMatchObject({ status: { in: ['NEW', 'ASSIGNED'] } });
    });

    it('does not overwrite a task that changed state mid-assignment', async () => {
      // count: 0 = המשימה נסגרה בין הקריאה לכתיבה. דריסה כאן הייתה
      // מחזירה משימה סגורה למצב ASSIGNED.
      tx.task.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.assignTask(TENANT, TASK)).resolves.toEqual({
        assigned: false,
        reason: 'task changed state while assigning',
      });
    });

    it('emits no task.assigned event when the guarded write found nothing', async () => {
      tx.task.updateMany.mockResolvedValue({ count: 0 });
      await service.assignTask(TENANT, TASK);
      expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    });

    it.each(['CLOSED', 'CANCELLED'])('refuses to assign a %s task', async (status) => {
      tx.task.findFirst.mockResolvedValue({
        status,
        ...TASK_LOC,
        jobTypeTemplate: { requiredSkill: 'ELECTRICAL' },
      });

      await expect(service.assignTask(TENANT, TASK)).resolves.toMatchObject({ assigned: false });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.task.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('outbox', () => {
    it('records task.assigned for the tenant after a successful assignment', async () => {
      await service.assignTask(TENANT, TASK);
      expect(callArg(tx.outboxEvent.create)).toMatchObject({
        data: {
          tenantId: TENANT,
          eventName: 'task.assigned',
          payload: { taskId: TASK, userId: NEAR },
        },
      });
    });

    it('BUG — writes the event in a second transaction, not the one that assigned', async () => {
      // שתי קריאות ל-forTenant = שתי טרנזקציות. קריסה בין השתיים משאירה
      // משימה משויכת בלי אירוע, וזה בדיוק מה שה-outbox אמור למנוע.
      await service.assignTask(TENANT, TASK);
      expect(forTenant).toHaveBeenCalledTimes(2);
    });
  });

  describe('module gating', () => {
    it('returns early for a tenant without the scheduling module', async () => {
      tx.tenantConfig.findUnique.mockResolvedValue({ enabledModules: ['invoicing'] });

      await expect(service.assignTask(TENANT, TASK)).resolves.toEqual({
        assigned: false,
        reason: 'scheduling module not enabled for this tenant (vertical)',
      });
      expect(tx.task.findFirst).not.toHaveBeenCalled();
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('treats a missing config as module-off rather than assigning', async () => {
      tx.tenantConfig.findUnique.mockResolvedValue(null);
      await expect(service.assignTask(TENANT, TASK)).resolves.toMatchObject({ assigned: false });
    });
  });

  describe('handleTaskCreated', () => {
    it('assigns using the tenantId carried on the event', async () => {
      await service.handleTaskCreated({ tenantId: TENANT, taskId: TASK, source: 'EMAIL' });
      expect(forTenant).toHaveBeenCalledWith(TENANT, expect.any(Function));
      expect(tx.task.updateMany).toHaveBeenCalled();
    });

    it('never throws out of the handler', async () => {
      // הקורא הוא emit ללא await: דחייה כאן היא unhandled rejection
      // שמפילה את התהליך לכל הטננטים.
      tx.task.findFirst.mockRejectedValue(new Error('db gone'));
      await expect(
        service.handleTaskCreated({ tenantId: TENANT, taskId: TASK, source: 'EMAIL' }),
      ).resolves.toBeUndefined();
    });
  });
});
