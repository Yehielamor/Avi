import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { estimateFromChecklist } from '../../common/checklist-estimate';
import { PrismaService } from '../../database/prisma.service';

import { buildActivation, maintenanceEstimate } from './brief';

const TZ = 'Asia/Jerusalem';
const MAX_TODAY = 30;
const MAX_REPLIES = 20;
/** עבודה שנסגרה לפני יותר מזה ולא חויבה כבר לא "מחכה" — היא נשכחה, וזה דו"ח אחר. */
const UNBILLED_LOOKBACK_DAYS = 90;
const MAX_UNBILLED = 500;
const DUE_WITHIN_DAYS = 14;
const QUOTE_EXPIRY_WARNING_DAYS = 3;

/**
 * תדריך הבוקר: מה קורה היום, מה מחכה לתשובה, וכמה כסף מחכה לפעולה.
 *
 * כל שורה כאן חייבת להוביל לפעולה. מספר שאין מה לעשות איתו לא נכנס —
 * הוא הופך את המסך לרעש, ומסך רועש מפסיקים לפתוח.
 */
@Injectable()
export class BriefService {
  private readonly logger = new Logger(BriefService.name);

  constructor(private readonly prisma: PrismaService) {}

  async brief(tenantId: string, userId: string) {
    await this.recordActivity(tenantId, userId);

    return this.prisma.forTenant(tenantId, async (tx) => {
      const today = await tx.$queryRaw<
        Array<{
          id: string;
          title: string;
          status: string;
          customerName: string;
          technician: string | null;
          scheduledStart: Date;
          scheduledEnd: Date | null;
          customerConfirmedAt: Date | null;
          onTheWayAt: Date | null;
        }>
      >`
        SELECT t.id, t.title, t.status::text AS status, c.name AS "customerName", u.name AS technician,
               t."scheduledStart", t."scheduledEnd", t."customerConfirmedAt", t."onTheWayAt"
        FROM tasks t
        JOIN customers c ON c.id = t."customerId"
        LEFT JOIN users u ON u.id = t."assignedToUserId"
        WHERE t."tenantId" = ${tenantId}::uuid
          AND t.status <> 'CANCELLED'
          AND t."scheduledStart" >= date_trunc('day', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}
          AND t."scheduledStart" <  (date_trunc('day', now() AT TIME ZONE ${TZ}) + interval '1 day') AT TIME ZONE ${TZ}
        ORDER BY t."scheduledStart" ASC
        LIMIT ${MAX_TODAY}
      `;

      const reschedules = await tx.task.findMany({
        where: { tenantId, rescheduleRequest: { not: null }, status: { in: ['NEW', 'ASSIGNED', 'IN_PROGRESS'] } },
        select: {
          id: true,
          title: true,
          rescheduleRequest: true,
          rescheduleRequestedAt: true,
          customer: { select: { name: true } },
        },
        orderBy: { rescheduleRequestedAt: 'asc' },
        take: MAX_REPLIES,
      });

      const now = new Date();
      const expiringQuotes = await tx.quote.findMany({
        where: {
          tenantId,
          status: 'SENT',
          validUntil: { gte: now, lte: new Date(now.getTime() + QUOTE_EXPIRY_WARNING_DAYS * 86_400_000) },
        },
        select: { id: true, quoteNumber: true, totalAmount: true, validUntil: true, customer: { select: { name: true } } },
        orderBy: { validUntil: 'asc' },
        take: MAX_REPLIES,
      });

      // --- כסף שמחכה -------------------------------------------------------

      const [approved] = await tx.$queryRaw<Array<{ count: bigint; amount: Prisma.Decimal | null }>>`
        SELECT count(*) AS count, sum(q."totalAmount") AS amount
        FROM quotes q JOIN tasks t ON t.id = q."taskId"
        WHERE q."tenantId" = ${tenantId}::uuid AND q.status = 'APPROVED'
          AND t.status IN ('NEW', 'ASSIGNED', 'IN_PROGRESS') AND t."scheduledStart" IS NULL
      `;

      const unbilled = await tx.$queryRaw<Array<{ checklist: unknown }>>`
        SELECT t.checklist FROM tasks t
        WHERE t."tenantId" = ${tenantId}::uuid AND t.status = 'CLOSED'
          AND t."closedAt" >= now() - make_interval(days => ${UNBILLED_LOOKBACK_DAYS}::int)
          AND NOT EXISTS (SELECT 1 FROM invoice_line_items li WHERE li."taskId" = t.id)
        LIMIT ${MAX_UNBILLED}
      `;
      const prices = await tx.priceListItem.findMany({ where: { tenantId, isActive: true }, select: { code: true, price: true } });
      const priceOf = new Map(prices.map((p) => [p.code, new Prisma.Decimal(p.price)]));
      const unbilledAmount = unbilled.reduce((sum, r) => sum.add(estimateFromChecklist(r.checklist, priceOf)), new Prisma.Decimal(0));

      // אותם תנאים כמו רשימת "מגיע לטיפול" (equipment.service.ts), כדי שהמספר
      // כאן יתאים למה שבעל העסק רואה כשהוא לוחץ עליו.
      const [due] = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count
        FROM equipment e JOIN customers c ON c.id = e."customerId" AND c."tenantId" = e."tenantId"
        WHERE e."tenantId" = ${tenantId}::uuid AND e."isActive" AND c."isActive"
          AND COALESCE(e."lastServicedAt", e."createdAt") + make_interval(months => e."serviceIntervalMonths")
              <= now() + make_interval(days => ${DUE_WITHIN_DAYS}::int)
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t."equipmentId" = e.id AND t.status NOT IN ('CLOSED', 'CANCELLED'))
      `;
      const [avg] = await tx.$queryRaw<Array<{ avg: Prisma.Decimal | null }>>`
        SELECT avg(billed) AS avg FROM (
          SELECT sum(li.amount) AS billed
          FROM tasks t JOIN invoice_line_items li ON li."taskId" = t.id
          WHERE t."tenantId" = ${tenantId}::uuid AND t."equipmentId" IS NOT NULL AND t.status = 'CLOSED'
            AND t."closedAt" >= now() - interval '365 days'
          GROUP BY t.id
        ) x
      `;
      const dueCount = Number(due?.count ?? 0);

      return {
        today: today.map((t) => ({
          ...t,
          confirmed: t.customerConfirmedAt !== null,
          onTheWay: t.onTheWayAt !== null,
        })),
        needsReply: {
          reschedules: reschedules.map((t) => ({
            taskId: t.id,
            title: t.title,
            customerName: t.customer.name,
            note: t.rescheduleRequest,
            requestedAt: t.rescheduleRequestedAt,
          })),
          expiringQuotes: expiringQuotes.map((q) => ({
            quoteId: q.id,
            quoteNumber: q.quoteNumber,
            customerName: q.customer.name,
            totalAmount: q.totalAmount.toFixed(2),
            validUntil: q.validUntil,
          })),
        },
        moneyWaiting: {
          approvedUnscheduled: {
            count: Number(approved?.count ?? 0),
            amount: new Prisma.Decimal(approved?.amount ?? 0).toFixed(2),
          },
          closedUnbilled: {
            count: unbilled.length,
            // הערכה לפי המחירון הנוכחי — ה-UI מסמן זאת.
            estimatedAmount: unbilledAmount.toFixed(2),
          },
          maintenanceDue: {
            count: dueCount,
            estimatedAmount: maintenanceEstimate(avg?.avg == null ? null : new Prisma.Decimal(avg.avg), dueCount),
          },
        },
        week: await this.week(tx, tenantId),
      };
    });
  }

  async activation(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      // ברצף ולא ב-Promise.all: טרנזקציה אינטראקטיבית היא חיבור אחד.
      const priceList = await tx.priceListItem.count({ where: { tenantId, isActive: true } });
      const equipment = await tx.equipment.count({ where: { tenantId } });
      const statusLink = await tx.publicLink.count({ where: { tenantId, purpose: 'TASK_STATUS' } });
      const quote = await tx.quote.count({ where: { tenantId, status: { not: 'DRAFT' } } });
      return buildActivation({ priceList, equipment, statusLink, quote });
    });
  }

  /** "מה CraftMind עשה בשבילך" — 7 הימים האחרונים. */
  private async week(tx: Prisma.TransactionClient, tenantId: string) {
    const [row] = await tx.$queryRaw<
      Array<{
        booked: bigint;
        approved: bigint;
        approved_amount: Prisma.Decimal | null;
        confirmed: bigint;
        status_links: bigint;
        closed: bigint;
      }>
    >`
      SELECT
        (SELECT count(*) FROM tasks WHERE "tenantId" = ${tenantId}::uuid
           AND source = 'CUSTOMER_LINK' AND "createdAt" >= now() - interval '7 days') AS booked,
        (SELECT count(*) FROM quotes WHERE "tenantId" = ${tenantId}::uuid
           AND "approvedAt" >= now() - interval '7 days') AS approved,
        (SELECT sum("totalAmount") FROM quotes WHERE "tenantId" = ${tenantId}::uuid
           AND "approvedAt" >= now() - interval '7 days') AS approved_amount,
        (SELECT count(*) FROM tasks WHERE "tenantId" = ${tenantId}::uuid
           AND "customerConfirmedAt" >= now() - interval '7 days') AS confirmed,
        -- שליחה חוזרת של קישור לאותה משימה יוצרת קישור חדש; סופרים משימות.
        (SELECT count(DISTINCT "taskId") FROM public_links WHERE "tenantId" = ${tenantId}::uuid
           AND purpose = 'TASK_STATUS' AND "createdAt" >= now() - interval '7 days') AS status_links,
        (SELECT count(*) FROM tasks WHERE "tenantId" = ${tenantId}::uuid
           AND status = 'CLOSED' AND "closedAt" >= now() - interval '7 days') AS closed
    `;
    return {
      bookedByCustomers: Number(row?.booked ?? 0),
      quotesApproved: Number(row?.approved ?? 0),
      quotesApprovedAmount: new Prisma.Decimal(row?.approved_amount ?? 0).toFixed(2),
      visitsConfirmed: Number(row?.confirmed ?? 0),
      statusLinksSent: Number(row?.status_links ?? 0),
      jobsClosed: Number(row?.closed ?? 0),
    };
  }

  /**
   * יום פעילות אחד למשתמש. כשל כאן לא מפיל את הדשבורד — מדידה לעולם
   * לא חשובה יותר מהמסך שהיא מודדת.
   */
  private async recordActivity(tenantId: string, userId: string) {
    try {
      await this.prisma.forTenant(tenantId, (tx) =>
        tx.$executeRaw`
          INSERT INTO activity_days ("tenantId", "userId", day)
          VALUES (${tenantId}::uuid, ${userId}::uuid, (now() AT TIME ZONE ${TZ})::date)
          ON CONFLICT DO NOTHING
        `,
      );
    } catch (err) {
      this.logger.warn(`activity_days insert failed: ${(err as Error).message}`);
    }
  }
}
