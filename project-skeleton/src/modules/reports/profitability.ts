import { Prisma } from '@prisma/client';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

export interface TaskFacts {
  taskId: string;
  jobTypeId?: string | null;
  jobType: string | null;
  technicianId?: string | null;
  technician: string | null;
  customerId?: string;
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

/**
 * לפי מה מקבצים. `id` הוא הזהות (שני לקוחות בשם "משה כהן" הם שתי שורות);
 * `label` הוא מה שמוצג. id=null מקבץ לפי התווית (למשל "לא שויך").
 */
export interface GroupKey {
  id: string | null;
  label: string;
}

export interface ProfitLine {
  /** התווית לתצוגה (שם). נשאר `key` לתאימות לאחור עם הממשק. */
  key: string;
  /** מזהה הלקוח / הטכנאי / סוג העבודה, או null לשורה בלי ישות (סה"כ, "לא שויך"). */
  id: string | null;
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
export function aggregate(facts: TaskFacts[], keyOf: (f: TaskFacts) => string | GroupKey): ProfitLine[] {
  // קיבוץ לפי מזהה ולא לפי שם (QA 18.09, F6): קודם שני לקוחות שונים עם
  // אותו שם התמזגו לשורה אחת עם סכום משותף.
  const groups = new Map<string, { group: GroupKey; items: TaskFacts[] }>();
  for (const f of facts) {
    const k = keyOf(f);
    const group = typeof k === 'string' ? { id: null, label: k } : k;
    const mapKey = group.id !== null ? `id:${group.id}` : `label:${group.label}`;
    const entry = groups.get(mapKey);
    if (entry) entry.items.push(f);
    else groups.set(mapKey, { group, items: [f] });
  }

  return [...groups.values()]
    .map(({ group, items }) => {
      const revenue = items.reduce((s, f) => s.add(f.billed ?? f.estimated), ZERO);
      const partsCost = items.reduce((s, f) => s.add(f.partsCost), ZERO);
      const gross = revenue.sub(partsCost);
      return {
        key: group.label,
        id: group.id,
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
