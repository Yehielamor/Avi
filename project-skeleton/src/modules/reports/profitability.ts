import { Prisma } from '@prisma/client';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

export interface TaskFacts {
  taskId: string;
  jobType: string | null;
  technician: string | null;
  customer: string;
  /** סכום שורות החשבונית של המשימה. null = עוד לא חויבה. */
  billed: Prisma.Decimal | null;
  /** הערכה מהצ'קליסט לפי המחירון הנוכחי — משמשת רק כשאין חיוב. */
  estimated: Prisma.Decimal;
  /** עלות חלקים שידועה. */
  partsCost: Prisma.Decimal;
  /** חלקים שנצרכו ואין להם עלות. אם > 0, הרווח חלקי. */
  partsWithoutCost: number;
}

export interface ProfitLine {
  key: string;
  jobs: number;
  revenue: string;
  partsCost: string;
  grossProfit: string;
  /** אחוז רווח גולמי מההכנסה, מעוגל לאחוז שלם. null כשאין הכנסה. */
  marginPct: number | null;
  /** חלק מההכנסה הוא הערכה, לא חיוב בפועל. */
  hasEstimates: boolean;
  /** לפחות חלק אחד בלי עלות — הרווח גבוה מהאמת. */
  partial: boolean;
}

/**
 * מקבץ משימות סגורות לשורות רווח.
 *
 * שני עקרונות, שניהם נגד תמונה ורודה מדי:
 *   • חלק בלי עלות לא נחשב כאילו עלה אפס. השורה מסומנת "חלקי".
 *   • הכנסה משוערת (משימה שעוד לא חויבה) מסומנת, ולא מתערבבת בשקט בחיוב.
 * עלות עבודה (שעות) אין לנו בכלל — והממשק אומר את זה.
 */
export function aggregate(facts: TaskFacts[], keyOf: (f: TaskFacts) => string): ProfitLine[] {
  const groups = new Map<string, TaskFacts[]>();
  for (const f of facts) {
    const k = keyOf(f);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }

  return [...groups.entries()]
    .map(([key, items]) => {
      const revenue = items.reduce((s, f) => s.add(f.billed ?? f.estimated), ZERO);
      const partsCost = items.reduce((s, f) => s.add(f.partsCost), ZERO);
      const gross = revenue.sub(partsCost);
      return {
        key,
        jobs: items.length,
        revenue: revenue.toFixed(2),
        partsCost: partsCost.toFixed(2),
        grossProfit: gross.toFixed(2),
        marginPct: revenue.isZero() ? null : gross.div(revenue).mul(100).toDecimalPlaces(0).toNumber(),
        hasEstimates: items.some((f) => f.billed === null && !f.estimated.isZero()),
        partial: items.some((f) => f.partsWithoutCost > 0),
      };
    })
    .sort((a, b) => D(b.grossProfit).cmp(D(a.grossProfit)));
}
