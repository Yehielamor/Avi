import { Injectable } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

export interface DashboardStats {
  openTasks: number;
  unassignedTasks: number;
  closedThisMonth: number;
  lowStockItems: number;
  /** סכום החשבוניות שהופקו החודש. מחרוזת — Decimal, לא float. */
  revenueThisMonth: string;
  overdueUrgent: number;
}

const OPEN: TaskStatus[] = [TaskStatus.NEW, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS];

/**
 * מספרי הסקירה.
 *
 * כולם בשאילתה אחת מרוכזת ולא בשש קריאות נפרדות: הדשבורד נטען בכל
 * כניסה, וששה round-trips ל-DB לכל טעינה מצטברים. הם גם צריכים לראות
 * אותו רגע — ספירות שנלקחו בזמנים שונים יכולות לסתור זו את זו.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(tenantId: string, timezone = 'Asia/Jerusalem'): Promise<DashboardStats> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      // גבול החודש מחושב ב-DB ובאזור הזמן של העסק, לא ב-Node.
      // חישוב ב-UTC היה משייך עבודה שנסגרה ב-01:00 ב-1 לחודש
      // לחודש הקודם — אותה מחלקת באג שתוקנה ב-Timestamptz.
      const [row] = await tx.$queryRaw<
        Array<{
          open_tasks: bigint;
          unassigned: bigint;
          closed_this_month: bigint;
          overdue_urgent: bigint;
          low_stock: bigint;
          revenue: Prisma.Decimal | null;
        }>
      >`
        WITH bounds AS (
          SELECT date_trunc('month', now() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone} AS month_start
        )
        SELECT
          (SELECT count(*) FROM tasks
             WHERE "tenantId" = ${tenantId}::uuid AND status = ANY(${OPEN}::"TaskStatus"[])) AS open_tasks,

          (SELECT count(*) FROM tasks
             WHERE "tenantId" = ${tenantId}::uuid AND status = ANY(${OPEN}::"TaskStatus"[])
               AND "assignedToUserId" IS NULL) AS unassigned,

          (SELECT count(*) FROM tasks, bounds
             WHERE "tenantId" = ${tenantId}::uuid AND status = 'CLOSED'
               AND "closedAt" >= bounds.month_start) AS closed_this_month,

          -- דחוף שנפתח לפני יותר מ-24 שעות ועדיין לא נסגר. זה המספר
          -- שמצדיק תשומת לב מיידית, להבדיל מספירה כללית.
          (SELECT count(*) FROM tasks
             WHERE "tenantId" = ${tenantId}::uuid AND status = ANY(${OPEN}::"TaskStatus"[])
               AND priority = 1 AND "createdAt" < now() - interval '24 hours') AS overdue_urgent,

          (SELECT count(*) FROM inventory_items
             WHERE "tenantId" = ${tenantId}::uuid AND "isActive"
               AND quantity <= "lowStockThreshold") AS low_stock,

          (SELECT COALESCE(sum("totalAmount"), 0) FROM invoices, bounds
             WHERE "tenantId" = ${tenantId}::uuid AND status = 'FINALIZED'
               AND "finalizedAt" >= bounds.month_start) AS revenue
      `;

      return {
        // bigint -> number: הספירות האלה לא מתקרבות ל-2^53.
        openTasks: Number(row?.open_tasks ?? 0),
        unassignedTasks: Number(row?.unassigned ?? 0),
        closedThisMonth: Number(row?.closed_this_month ?? 0),
        overdueUrgent: Number(row?.overdue_urgent ?? 0),
        lowStockItems: Number(row?.low_stock ?? 0),
        // כמחרוזת: הלקוח מעצב אותה כפי שהיא, בלי לעבור ב-float.
        revenueThisMonth: (row?.revenue ?? new Prisma.Decimal(0)).toString(),
      };
    });
  }
}
