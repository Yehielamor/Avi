import { Injectable, NotFoundException } from '@nestjs/common';
import { TaskStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

import type { SiteLocationDto } from './dto/site-location.dto';
import { orderStops, wazeUrl } from './route';

const TZ = 'Asia/Jerusalem';
const MAX_STOPS = 50;
/**
 * מעל זה המיקום לא נשמר. GPS בתוך מבנה מדווח לרוב 10–50 מ'; 100 מ' ומעלה
 * הוא בדרך כלל מיקום לפי אנטנה, ושמירה שלו הייתה שולחת את הטכנאי הבא לרחוב אחר.
 */
const MAX_ACCURACY_M = 100;

type Actor = { id: string; role: UserRole };

const OPEN: TaskStatus[] = [TaskStatus.NEW, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS];

type Row = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  customerConfirmedAt: Date | null;
  rescheduleRequest: string | null;
  onTheWayAt: Date | null;
  customerName: string;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  overdue: boolean;
};

/**
 * "היום שלי" — מה הטכנאי עושה היום, ובאיזה סדר.
 *
 * תמיד המשימות של המשתמש המחובר בלבד, בכל תפקיד: בעל עסק שיוצא לשטח
 * בעצמו רואה את שלו, לא את של כולם. תור של עובד אחר נמצא במסכי הניהול.
 */
@Injectable()
export class FieldRouteService {
  constructor(private readonly prisma: PrismaService) {}

  async myDay(tenantId: string, userId: string, date?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      // "היום" לפי שעון ישראל, מה-DB — אותו שעון שכל השאילתות למטה משתמשות בו.
      const [clock] = await tx.$queryRaw<Array<{ today: string }>>`
        SELECT to_char((now() AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS today
      `;
      const today = clock!.today;
      const day = date ?? today;
      const isToday = day === today;

      // היום: מה שנקבע ליום הזה + מה שפתוח ובלי מועד + מה שנקבע לפני היום ועדיין פתוח
      // (באיחור — מופיע ראשון, כי המועד שלו מוקדם). יום אחר: רק מה שנקבע אליו.
      const rows = await tx.$queryRaw<Row[]>`
        WITH d AS (
          SELECT (${day}::date)::timestamp AT TIME ZONE ${TZ} AS s,
                 ((${day}::date) + 1)::timestamp AT TIME ZONE ${TZ} AS e
        )
        SELECT t.id, t.title, t.status, t.priority, t."scheduledStart", t."scheduledEnd",
               t."customerConfirmedAt", t."rescheduleRequest", t."onTheWayAt",
               c.name AS "customerName", c.phone, c.address,
               COALESCE(t."locationLat", c.lat) AS lat, COALESCE(t."locationLng", c.lng) AS lng,
               (t."scheduledStart" < d.s) AS overdue
        FROM tasks t JOIN customers c ON c.id = t."customerId", d
        WHERE t."tenantId" = ${tenantId}::uuid
          AND t."assignedToUserId" = ${userId}::uuid
          AND (
            (t."scheduledStart" >= d.s AND t."scheduledStart" < d.e AND t.status <> 'CANCELLED')
            OR (${isToday} AND t.status = ANY(${OPEN}::"TaskStatus"[])
                AND (t."scheduledStart" IS NULL OR t."scheduledStart" < d.s))
          )
        ORDER BY t."scheduledStart" ASC NULLS LAST, t.priority ASC, t."createdAt" ASC
        LIMIT ${MAX_STOPS}
      `;

      const user = await tx.user.findFirst({ where: { id: userId, tenantId }, select: { homeLat: true, homeLng: true } });
      const start = user?.homeLat != null && user.homeLng != null ? { lat: user.homeLat, lng: user.homeLng } : null;

      // עבודות שהסתיימו לא נכנסות לחישוב המסלול — הן בסוף, לסיכום היום.
      const done = rows.filter((r) => r.status === TaskStatus.CLOSED);
      const pending = orderStops(
        rows.filter((r) => r.status !== TaskStatus.CLOSED).map((r) => ({ ...r, taskId: r.id })),
        start,
      );

      const toStop = (r: Row) => ({
        taskId: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        scheduledStart: r.scheduledStart,
        scheduledEnd: r.scheduledEnd,
        overdue: r.overdue === true && r.status !== TaskStatus.CLOSED,
        confirmed: r.customerConfirmedAt !== null,
        rescheduleRequested: r.rescheduleRequest !== null,
        onTheWay: r.onTheWayAt !== null,
        customer: { name: r.customerName, phone: r.phone, address: r.address },
        hasLocation: r.lat !== null && r.lng !== null,
        wazeUrl: wazeUrl(r),
      });

      return {
        date: day,
        isToday,
        stops: pending.map(toStop),
        done: done.map(toStop),
      };
    });
  }

  /**
   * לימוד מיקום הלקוח מהטלפון של הטכנאי. אף פעם לא דורס מיקום קיים —
   * מיקום שהוזן ידנית או נלמד קודם עדיף על דגימה אחת.
   */
  async learnSiteLocation(tenantId: string, taskId: string, dto: SiteLocationDto, actor: Actor) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: taskId, tenantId, ...(actor.role === UserRole.FIELD ? { assignedToUserId: actor.id } : {}) },
        select: { id: true, customerId: true },
      });
      if (!task) throw new NotFoundException('Task not found');

      if (dto.accuracyM > MAX_ACCURACY_M) return { saved: false, reason: 'inaccurate' as const };

      // updateMany עם תנאי "ריק" — אטומי, ושתי סגירות במקביל לא דורסות זו את זו.
      const customer = await tx.customer.updateMany({
        where: { id: task.customerId, tenantId, lat: null, lng: null },
        data: { lat: dto.lat, lng: dto.lng },
      });
      await tx.task.updateMany({
        where: { id: task.id, tenantId, locationLat: null, locationLng: null },
        data: { locationLat: dto.lat, locationLng: dto.lng },
      });

      if (customer.count > 0) {
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: actor.id,
            action: 'customer.location_learned',
            entityType: 'Customer',
            entityId: task.customerId,
            metadata: { taskId, accuracyM: Math.round(dto.accuracyM) },
          },
        });
      }
      return { saved: customer.count > 0, reason: customer.count > 0 ? null : ('already_known' as const) };
    });
  }
}
