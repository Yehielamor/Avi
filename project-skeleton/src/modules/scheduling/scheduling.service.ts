import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService, TenantClient } from '../../database/prisma.service';
import { haversineDistanceKm } from '../../common/geo.util';

// ============================================================
// Scheduling Agent (מסמך הארכיטקטורה, סעיף 6.2).
// לא רלוונטי לכל טננט: קמעונאות לא מפעילה את המודול הזה בכלל
// (enabledModules ב-TenantConfig לא כולל "scheduling"), ולכן
// assignTask פשוט חוזר מוקדם עבור טננטים כאלה.
//
// אין כאן LLM כלל - רק אלגוריתם ניקוד דטרמיניסטי:
//   score = skillWeight*skillMatch + distanceWeight*distanceScore + loadWeight*loadScore
// requiredSkill הוא hard filter (לא soft) - טכנאי בלי ההתמחות הנדרשת
// לא נכנס בכלל להשוואה, לא רק מקבל ניקוד נמוך.
//
// שני באגים תוקנו כאן — אל תחזירו אותם:
//
// 1. גם הקריאה (`findUnique({ where: { id: taskId } })`) וגם הכתיבה
//    (`update({ where: { id: taskId } })`) רצו בלי tenantId. מזהה
//    משימה של טננט אחר ב-`POST /scheduling/:taskId/assign` שייך אותה
//    לטכנאי של הטננט הקורא. עכשיו: forTenant + tenantId מפורש + 404.
//
// 2. השיוך היה read-then-write בלי נעילה: שתי משימות באותו סבב סנכרון
//    קראו שתיהן `load = 0` לאותו טכנאי ונחתו שתיהן עליו. עכשיו כל
//    השיוך רץ בטרנזקציה אחת שנועלת את שורות המועמדים ב-FOR UPDATE
//    לפני ספירת העומס — ראו lockEligibleCandidates.
// ============================================================

interface SchedulingWeights {
  skillWeight: number;
  distanceWeight: number;
  loadWeight: number;
}

// טיפוסים מקומיים מפורשים לשדות שבהם אנחנו משתמשים - גם כי שאילתת
// ה-FOR UPDATE היא raw ולכן Prisma לא מסיק עבורה טיפוס.
interface CandidateUser {
  id: string;
  skills: string[];
  homeLat: number | null;
  homeLng: number | null;
}

export interface AssignResult {
  assigned: boolean;
  userId?: string;
  reason?: string;
}

const DEFAULT_WEIGHTS: SchedulingWeights = {
  skillWeight: 0.5,
  distanceWeight: 0.3,
  loadWeight: 0.2,
};

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  // EventEmitter2.emit() לא ממתין ולא תופס: דחייה כאן היא unhandled
  // rejection שמפילה את התהליך לכל הטננטים. עד שה-outbox יחליף את
  // ה-emit הישיר (קונבנציות, סעיף 7) — הגוף עטוף ולא זורק החוצה.
  @OnEvent('task.created')
  async handleTaskCreated(payload: { tenantId: string; taskId: string; source: string }): Promise<void> {
    try {
      const result = await this.assignTask(payload.tenantId, payload.taskId);
      if (!result.assigned) {
        this.logger.log(`Task ${payload.taskId} not auto-assigned: ${result.reason}`);
      }
    } catch (err) {
      this.logger.error(
        `task.created handler failed for task ${payload.taskId} (tenant ${payload.tenantId}): ${describeError(err)}`,
      );
    }
  }

  /** ניתן לקריאה גם ידנית (endpoint) לצורך שיוך מחדש - לא רק כתגובה לאירוע. */
  async assignTask(tenantId: string, taskId: string): Promise<AssignResult> {
    const result = await this.prisma.forTenant(tenantId, (tx) => this.assignWithin(tx, tenantId, taskId));

    if (result.assigned && result.userId) {
      // אחרי commit בלבד: אירוע שנפלט מתוך הטרנזקציה עלול להתייחס
      // לשיוך שיתגלגל לאחור.
      this.events.emit('task.assigned', { tenantId, taskId, userId: result.userId });
    }
    return result;
  }

  private async assignWithin(tx: TenantClient, tenantId: string, taskId: string): Promise<AssignResult> {
    const config = await tx.tenantConfig.findUnique({
      where: { tenantId },
      select: { enabledModules: true, schedulingWeights: true },
    });

    const enabledModules = toStringArray(config?.enabledModules);
    if (!enabledModules.includes('scheduling')) {
      return { assigned: false, reason: 'scheduling module not enabled for this tenant (vertical)' };
    }

    const task = await tx.task.findFirst({
      where: { id: taskId, tenantId },
      select: {
        status: true,
        locationLat: true,
        locationLng: true,
        jobTypeTemplate: { select: { requiredSkill: true } },
      },
    });
    // ה-RLS חוסם את הדליפה; ה-tenantId המפורש הוא מה שהופך את זה
    // ל-404 ברור במקום "task not found" מעורפל (קונבנציות, סעיף 1.1).
    if (!task) throw new NotFoundException('Task not found');

    if (task.status === 'CLOSED' || task.status === 'CANCELLED') {
      return { assigned: false, reason: `task is ${task.status.toLowerCase()}` };
    }

    const requiredSkill = task.jobTypeTemplate?.requiredSkill ?? null;

    const candidates = await this.lockEligibleCandidates(tx, tenantId);
    if (candidates.length === 0) {
      return { assigned: false, reason: 'no active field technicians' };
    }

    const eligible = requiredSkill ? candidates.filter((c) => c.skills.includes(requiredSkill)) : candidates;
    if (eligible.length === 0) {
      return { assigned: false, reason: `no technician with required skill "${requiredSkill}"` };
    }

    const weights = toWeights(config?.schedulingWeights);

    // נספר *אחרי* ה-FOR UPDATE: כל טרנזקציה מתחרה כבר התחייבה או
    // שהיא עדיין חוסמת, ולכן העומס שנקרא כאן הוא העומס האמיתי.
    const loadCounts = await tx.task.groupBy({
      by: ['assignedToUserId'],
      where: {
        tenantId,
        status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
        assignedToUserId: { in: eligible.map((c) => c.id) },
      },
      _count: { _all: true },
    });
    const loadMap = new Map<string, number>();
    for (const row of loadCounts) {
      if (row.assignedToUserId) loadMap.set(row.assignedToUserId, row._count._all);
    }

    let best: { userId: string; score: number } | null = null;

    for (const candidate of eligible) {
      const skillMatch = requiredSkill ? 1 : 0.5; // אין דרישת סקיל -> לא מבדיל בין מועמדים בציר הזה

      let distanceScore = 0.5; // ברירת מחדל אם חסר מיקום לאחד הצדדים
      if (
        task.locationLat != null && task.locationLng != null &&
        candidate.homeLat != null && candidate.homeLng != null
      ) {
        const distanceKm = haversineDistanceKm(
          task.locationLat, task.locationLng,
          candidate.homeLat, candidate.homeLng,
        );
        distanceScore = 1 / (1 + distanceKm);
      }

      const load = loadMap.get(candidate.id) ?? 0;
      const loadScore = 1 / (1 + load);

      const score =
        weights.skillWeight * skillMatch +
        weights.distanceWeight * distanceScore +
        weights.loadWeight * loadScore;

      if (!best || score > best.score) {
        best = { userId: candidate.id, score };
      }
    }

    if (!best) return { assigned: false, reason: 'no candidate scored' };

    // הכתיבה מותנית במצב: משימה שנסגרה/בוטלה בין הקריאה לכתיבה
    // מחזירה count: 0 במקום להידרס (קונבנציות, סעיף 6).
    const { count } = await tx.task.updateMany({
      where: { id: taskId, tenantId, status: { in: ['NEW', 'ASSIGNED'] } },
      data: { assignedToUserId: best.userId, status: 'ASSIGNED' },
    });
    if (count === 0) {
      return { assigned: false, reason: 'task changed state while assigning' };
    }

    return { assigned: true, userId: best.userId };
  }

  /**
   * נועל את שורות הטכנאים המועמדים עד סוף הטרנזקציה.
   *
   * זו הנקודה שהופכת את השיוך מ-race לסידרתי: שני סבבי שיוך שרצים
   * במקביל על אותו טננט מחכים זה לזה כאן, ולכן השני רואה את השיוך
   * של הראשון כשהוא סופר עומס. בלי זה שניהם קוראים load=0 ונוחתים
   * על אותו טכנאי.
   *
   * raw SQL — Prisma לא חושף FOR UPDATE. זה רץ בתוך forTenant ולכן
   * ה-RLS חל עליו בדיוק כמו על כל שאילתה אחרת; ה-tenantId המפורש
   * הוא השכבה השנייה. ORDER BY "id" נותן סדר נעילה קבוע ומונע deadlock
   * בין שתי טרנזקציות שנועלות את אותה קבוצה.
   */
  private async lockEligibleCandidates(tx: TenantClient, tenantId: string): Promise<CandidateUser[]> {
    return tx.$queryRaw<CandidateUser[]>`
      SELECT "id", "skills", "homeLat", "homeLng"
      FROM "users"
      WHERE "tenantId" = ${tenantId}::uuid
        AND "role" = 'FIELD'::"UserRole"
        AND "isActive" = true
      ORDER BY "id"
      FOR UPDATE
    `;
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

// schedulingWeights הוא Json חופשי. משקל חסר או לא-מספרי נופל
// לברירת המחדל במקום להפוך את הציון ל-NaN ולשייך שרירותית.
function toWeights(value: unknown): SchedulingWeights {
  if (typeof value !== 'object' || value === null) return DEFAULT_WEIGHTS;
  const raw = value as Record<string, unknown>;
  const pick = (key: keyof SchedulingWeights): number => {
    const n = raw[key];
    return typeof n === 'number' && Number.isFinite(n) ? n : DEFAULT_WEIGHTS[key];
  };
  return {
    skillWeight: pick('skillWeight'),
    distanceWeight: pick('distanceWeight'),
    loadWeight: pick('loadWeight'),
  };
}

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
