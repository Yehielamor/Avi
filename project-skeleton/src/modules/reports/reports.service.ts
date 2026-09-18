import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

import { estimateFromChecklist } from '../../common/checklist-estimate';

import { aggregate, type TaskFacts } from './profitability';

const MAX_TASKS = 5000;
const MAX_RANGE_DAYS = 366;
const TOP_CUSTOMERS = 20;

type Row = {
  taskId: string;
  checklist: unknown;
  jobType: string | null;
  technician: string | null;
  customer: string;
  billed: Prisma.Decimal | null;
  partsCost: Prisma.Decimal;
  partsWithoutCost: bigint;
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * רווח גולמי לעבודות שנסגרו בתקופה (תאריכים לפי שעון ישראל, כולל שני הקצוות).
   *
   * הכנסה = מה שחויב בפועל; לעבודה שעוד לא חויבה — הערכה מהצ'קליסט לפי
   * המחירון הנוכחי, מסומנת. עלות = חלקים שנצרכו × עלות הקנייה שלהם. חלק
   * בלי עלות מסמן את השורה כחלקית ולא נספר כאפס.
   */
  async profitability(tenantId: string, from: string, to: string) {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (!Number.isFinite(days) || days < 0) throw new BadRequestException('"to" must be on or after "from"');
    if (days > MAX_RANGE_DAYS) throw new BadRequestException('The range can be at most one year');

    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`
        SELECT t.id AS "taskId", t.checklist, jt.name AS "jobType", u.name AS technician, c.name AS customer,
          (SELECT SUM(li.amount) FROM invoice_line_items li WHERE li."taskId" = t.id) AS billed,
          (SELECT COALESCE(SUM(-sm.delta * ii."unitCost"), 0)
             FROM stock_movements sm JOIN inventory_items ii ON ii.id = sm."inventoryItemId"
             WHERE sm."taskId" = t.id AND sm.reason = 'TASK_CONSUMPTION' AND ii."unitCost" IS NOT NULL) AS "partsCost",
          (SELECT COUNT(*)
             FROM stock_movements sm JOIN inventory_items ii ON ii.id = sm."inventoryItemId"
             WHERE sm."taskId" = t.id AND sm.reason = 'TASK_CONSUMPTION' AND ii."unitCost" IS NULL) AS "partsWithoutCost"
        FROM tasks t
        JOIN customers c ON c.id = t."customerId"
        LEFT JOIN job_type_templates jt ON jt.id = t."jobTypeTemplateId"
        LEFT JOIN users u ON u.id = t."assignedToUserId"
        WHERE t."tenantId" = ${tenantId}::uuid
          AND t.status = 'CLOSED'
          AND t."closedAt" >= (${from}::date)::timestamp AT TIME ZONE 'Asia/Jerusalem'
          AND t."closedAt" <  ((${to}::date) + 1)::timestamp AT TIME ZONE 'Asia/Jerusalem'
        LIMIT ${MAX_TASKS}
      `;

      const prices = await tx.priceListItem.findMany({
        where: { tenantId, isActive: true },
        select: { code: true, price: true },
      });
      const priceOf = new Map(prices.map((p) => [p.code, new Prisma.Decimal(p.price)]));

      const facts: TaskFacts[] = rows.map((r) => ({
        taskId: r.taskId,
        jobType: r.jobType,
        technician: r.technician,
        customer: r.customer,
        billed: r.billed === null ? null : new Prisma.Decimal(r.billed),
        estimated: estimateFromChecklist(r.checklist, priceOf),
        partsCost: new Prisma.Decimal(r.partsCost),
        partsWithoutCost: Number(r.partsWithoutCost),
      }));

      const [total] = aggregate(facts, () => 'total');
      return {
        from,
        to,
        truncated: rows.length === MAX_TASKS,
        total: total ?? null,
        byJobType: aggregate(facts, (f) => f.jobType ?? 'ללא סוג עבודה'),
        byTechnician: aggregate(facts, (f) => f.technician ?? 'לא שויך'),
        byCustomer: aggregate(facts, (f) => f.customer).slice(0, TOP_CUSTOMERS),
      };
    });
  }
}
