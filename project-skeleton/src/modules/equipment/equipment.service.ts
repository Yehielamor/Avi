import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PublicLinkPurpose, TaskSource, TaskStatus } from '@prisma/client';

import { buildWaLink } from '../../common/phone.util';
import { isCalendarDate } from '../../common/validation/calendar-date';
import { PrismaService } from '../../database/prisma.service';
import { PublicLinkService } from '../public-links/public-link.service';

import type { BookingRequestDto, CreateEquipmentDto, DayPart, UpdateEquipmentDto } from './dto/equipment.dto';

type Tx = Prisma.TransactionClient;

/** לקוח שקיבל תזכורת בחלון הזה מסומן — כדי שלא ישלחו לו שוב בטעות. */
const REMINDER_COOLDOWN_DAYS = 14;
/** לקוח יכול לבחור מועד עד חודשיים קדימה. */
const MAX_BOOKING_DAYS_AHEAD = 60;
const MAX_DUE_ROWS = 200;

const PART_LABEL: Record<DayPart, string> = { morning: 'בוקר', noon: 'צהריים', evening: 'אחה״צ-ערב' };

export interface DueRow {
  equipmentId: string;
  kind: string;
  location: string | null;
  customerId: string;
  customerName: string;
  hasPhone: boolean;
  lastServicedAt: Date | null;
  dueAt: Date;
  daysOverdue: number;
  lastReminderAt: Date | null;
  remindedRecently: boolean;
}

/** תאריך היום בישראל, כ-YYYY-MM-DD. לא של השרת — הוא רץ ב-UTC. */
export function israelToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function hebrewDay(isoDate: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

/**
 * ציוד ותחזוקה מונעת.
 *
 * הפיצ'ר היחיד שמכניס כסף לבעל העסק ולא רק חוסך לו זמן: רשימה יומית של
 * לקוחות שהגיע זמנם לטיפול, ותזכורת בלחיצה שמובילה לקביעת מועד.
 */
@Injectable()
export class EquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: PublicLinkService,
  ) {}

  async listForCustomer(tenantId: string, customerId: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.equipment.findMany({
        where: { tenantId, customerId },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      }),
    );
  }

  async create(tenantId: string, customerId: string, dto: CreateEquipmentDto, actorId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
      if (!customer) throw new NotFoundException('Customer not found');

      const item = await tx.equipment.create({
        data: {
          tenantId,
          customerId,
          kind: dto.kind.trim(),
          model: dto.model?.trim() ?? null,
          location: dto.location?.trim() ?? null,
          serviceIntervalMonths: dto.serviceIntervalMonths ?? 6,
          lastServicedAt: dto.lastServicedOn ? this.pastDate(dto.lastServicedOn) : null,
        },
      });
      await this.audit(tx, tenantId, actorId, 'equipment.created', item.id, { customerId });
      return item;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateEquipmentDto, actorId: string) {
    // בלי שדות, updateMany מחזיר count=0 גם לציוד קיים — ו-{} נענה ב-404
    // "Equipment not found" (QA 18.09, F17). כמו במחירון: 400.
    if (Object.values(dto).every((v) => v === undefined)) {
      throw new BadRequestException('Nothing to update');
    }
    return this.prisma.forTenant(tenantId, async (tx) => {
      const { count } = await tx.equipment.updateMany({
        where: { id, tenantId },
        data: {
          ...(dto.kind !== undefined && { kind: dto.kind.trim() }),
          ...(dto.model !== undefined && { model: dto.model.trim() }),
          ...(dto.location !== undefined && { location: dto.location.trim() }),
          ...(dto.serviceIntervalMonths !== undefined && { serviceIntervalMonths: dto.serviceIntervalMonths }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          ...(dto.lastServicedOn !== undefined && { lastServicedAt: this.pastDate(dto.lastServicedOn) }),
        },
      });
      if (count === 0) throw new NotFoundException('Equipment not found');
      await this.audit(tx, tenantId, actorId, 'equipment.updated', id, { fields: Object.keys(dto) });
      return tx.equipment.findFirstOrThrow({ where: { id, tenantId } });
    });
  }

  /**
   * ציוד שמגיע זמנו לטיפול עד `withinDays` ימים מהיום, כולל מה שכבר באיחור.
   *
   * ציוד שלא טופל מעולם נמדד מיום שנוסף — אחרת כל פריט חדש היה מופיע
   * מיד כ"באיחור", והרשימה הייתה מאבדת משמעות ביום הראשון.
   */
  async due(tenantId: string, withinDays = 14): Promise<DueRow[]> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          equipmentId: string;
          kind: string;
          location: string | null;
          customerId: string;
          customerName: string;
          phone: string | null;
          lastServicedAt: Date | null;
          dueAt: Date;
          lastReminderAt: Date | null;
        }>
      >`
        SELECT e.id AS "equipmentId", e.kind, e.location, c.id AS "customerId", c.name AS "customerName",
               c.phone, e."lastServicedAt", e."lastReminderAt",
               COALESCE(e."lastServicedAt", e."createdAt") + make_interval(months => e."serviceIntervalMonths") AS "dueAt"
        FROM equipment e
        JOIN customers c ON c.id = e."customerId" AND c."tenantId" = e."tenantId"
        WHERE e."tenantId" = ${tenantId}::uuid
          AND e."isActive" = true
          AND c."isActive" = true
          AND COALESCE(e."lastServicedAt", e."createdAt") + make_interval(months => e."serviceIntervalMonths")
              <= now() + make_interval(days => ${withinDays}::int)
          -- ציוד שכבר יש לו משימה פתוחה לא מופיע: הטיפול כבר בדרך.
          AND NOT EXISTS (
            SELECT 1 FROM tasks t
            WHERE t."equipmentId" = e.id AND t.status NOT IN ('CLOSED', 'CANCELLED')
          )
        ORDER BY "dueAt" ASC
        LIMIT ${MAX_DUE_ROWS}
      `;

      const now = Date.now();
      return rows.map((r) => ({
        equipmentId: r.equipmentId,
        kind: r.kind,
        location: r.location,
        customerId: r.customerId,
        customerName: r.customerName,
        hasPhone: buildWaLink(r.phone, 'x') !== null,
        lastServicedAt: r.lastServicedAt,
        dueAt: r.dueAt,
        daysOverdue: Math.max(0, Math.floor((now - r.dueAt.getTime()) / 86_400_000)),
        lastReminderAt: r.lastReminderAt,
        remindedRecently:
          r.lastReminderAt !== null && now - r.lastReminderAt.getTime() < REMINDER_COOLDOWN_DAYS * 86_400_000,
      }));
    });
  }

  async remind(tenantId: string, equipmentId: string, actorId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const eq = await tx.equipment.findFirst({
        where: { id: equipmentId, tenantId, isActive: true },
        select: {
          id: true,
          kind: true,
          location: true,
          customerId: true,
          customer: { select: { phone: true } },
          tenant: { select: { name: true } },
        },
      });
      if (!eq) throw new NotFoundException('Equipment not found');
      // כבר יש משימה פתוחה: הטיפול בדרך. תזכורת נוספת הייתה נותנת ללקוח
      // קישור שני, ומשם משימה כפולה לאותו ציוד (QA 18.09, F9).
      if (await this.hasOpenTask(tx, tenantId, equipmentId)) {
        throw new ConflictException('This equipment already has an open task');
      }

      const { url } = await this.links.create(tx, {
        tenantId,
        purpose: PublicLinkPurpose.BOOKING,
        customerId: eq.customerId,
        equipmentId,
      });
      await tx.equipment.update({ where: { id: equipmentId }, data: { lastReminderAt: new Date() } });
      await this.audit(tx, tenantId, actorId, 'equipment.reminder_sent', equipmentId, {});

      const what = eq.location ? `${eq.kind} (${eq.location})` : eq.kind;
      const message =
        `שלום, כאן ${eq.tenant.name}. הגיע הזמן לטיפול התקופתי ב${what}. ` +
        `טיפול בזמן חוסך תקלות וחשמל. אפשר לבחור מועד נוח כאן: ${url}`;
      return { url, waUrl: buildWaLink(eq.customer.phone, message), message };
    });
  }

  // ---------------------------------------------------------------------------
  // צד הלקוח
  // ---------------------------------------------------------------------------

  async bookingView(token: string) {
    const { tenantId, link } = await this.links.resolve(token, PublicLinkPurpose.BOOKING);
    return this.prisma.forTenant(tenantId, async (tx) => {
      // ציוד שהושבת אחרי שנשלחה התזכורת — הקישור מת איתו.
      const eq = await tx.equipment.findFirst({
        where: { id: link.equipmentId!, tenantId, isActive: true },
        select: { kind: true, location: true, tenant: { select: { name: true } } },
      });
      if (!eq) throw new NotFoundException('Link not found or expired');
      const today = israelToday();
      return {
        businessName: eq.tenant.name,
        equipment: { kind: eq.kind, location: eq.location },
        // גם משימה פתוחה מקישור אחר (או שנפתחה ידנית) = הטיפול כבר נקבע.
        alreadyBooked: link.usedAt !== null || (await this.hasOpenTask(tx, tenantId, link.equipmentId!)),
        minDate: addDays(today, 1),
        maxDate: addDays(today, MAX_BOOKING_DAYS_AHEAD),
      };
    });
  }

  async book(token: string, dto: BookingRequestDto) {
    const { tenantId, link } = await this.links.resolve(token, PublicLinkPurpose.BOOKING);
    const today = israelToday();
    const min = addDays(today, 1);
    const max = addDays(today, MAX_BOOKING_DAYS_AHEAD);
    for (const w of dto.windows) {
      // השוואת מחרוזות YYYY-MM-DD היא השוואת תאריכים. תאריך לא קיים
      // (2026-02-30, 2026-10-32) נדחה כבר ב-DTO; הבדיקה כאן לקוראים ישירים.
      if (!isCalendarDate(w.date) || w.date < min || w.date > max) {
        throw new BadRequestException('Please choose dates within the next two months');
      }
    }

    return this.prisma.forTenant(tenantId, async (tx) => {
      // שימוש יחיד, אטומית: שתי לחיצות במקביל לא יוצרות שתי משימות.
      const { count } = await tx.publicLink.updateMany({
        where: { id: link.id, tenantId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 0) throw new ConflictException('This link was already used to book a visit');

      // נעילת שורת הציוד: שתי הזמנות מקישורים שונים לאותו ציוד מסודרות
      // בתור, כך שהשנייה רואה את המשימה של הראשונה. זריקה כאן מגלגלת גם
      // את סימון הקישור כמשומש.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM equipment
        WHERE id = ${link.equipmentId!}::uuid AND "tenantId" = ${tenantId}::uuid AND "isActive" = true
        FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundException('Link not found or expired');
      if (await this.hasOpenTask(tx, tenantId, link.equipmentId!)) {
        throw new ConflictException('A visit for this equipment is already being arranged');
      }

      const eq = await tx.equipment.findFirstOrThrow({
        where: { id: link.equipmentId!, tenantId },
        select: { id: true, kind: true, location: true, customerId: true },
      });

      const windows = dto.windows.map((w) => `• ${hebrewDay(w.date)}, ${PART_LABEL[w.part]}`).join('\n');
      const description =
        `הלקוח קבע טיפול תקופתי מקישור התזכורת.\n\nמועדים מועדפים:\n${windows}` +
        (dto.note?.trim() ? `\n\nהערת הלקוח:\n${dto.note.trim()}` : '');

      const task = await tx.task.create({
        data: {
          tenantId,
          customerId: eq.customerId,
          equipmentId: eq.id,
          title: `טיפול תקופתי: ${eq.location ? `${eq.kind} (${eq.location})` : eq.kind}`,
          description,
          source: TaskSource.CUSTOMER_LINK,
          status: TaskStatus.NEW,
        },
        select: { id: true },
      });
      await this.audit(tx, tenantId, null, 'task.booked_by_customer', task.id, { via: 'public_link', equipmentId: eq.id });
      await tx.outboxEvent.create({
        data: { tenantId, eventName: 'task.created', payload: { tenantId, taskId: task.id, source: 'CUSTOMER_LINK' } },
      });
      return { booked: true };
    });
  }

  // ---------------------------------------------------------------------------

  private async hasOpenTask(tx: Tx, tenantId: string, equipmentId: string): Promise<boolean> {
    const open = await tx.task.findFirst({
      where: { tenantId, equipmentId, status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED] } },
      select: { id: true },
    });
    return open !== null;
  }

  /** תאריך טיפול קודם — לא בעתיד. תאריך עתידי היה מסתיר את הציוד מהרשימה לחודשים. */
  private pastDate(isoDate: string): Date {
    if (!isCalendarDate(isoDate)) throw new BadRequestException('lastServicedOn must be a real date in YYYY-MM-DD format');
    if (isoDate > israelToday()) throw new BadRequestException('Last service date cannot be in the future');
    return new Date(`${isoDate}T12:00:00Z`);
  }

  private audit(tx: Tx, tenantId: string, userId: string | null, action: string, entityId: string, metadata: object) {
    return tx.auditLog.create({
      data: {
        tenantId,
        userId,
        action,
        entityType: action.startsWith('task.') ? 'Task' : 'Equipment',
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
