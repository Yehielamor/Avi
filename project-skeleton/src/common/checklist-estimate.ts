import { Prisma } from '@prisma/client';

/** סכום פריטי צ'קליסט שבוצעו ושיש להם קוד במחירון. זהה לחוקי החשבונית. */
export function estimateFromChecklist(checklist: unknown, priceOf: Map<string, Prisma.Decimal>): Prisma.Decimal {
  if (!Array.isArray(checklist)) return new Prisma.Decimal(0);
  const seen = new Set<string>();
  let sum = new Prisma.Decimal(0);
  for (const item of checklist as Array<{ done?: unknown; priceCode?: unknown }>) {
    if (item?.done !== true || typeof item.priceCode !== 'string' || seen.has(item.priceCode)) continue;
    // קוד פעם אחת למשימה — כמו @@unique([taskId, priceCode]) בחשבונית.
    seen.add(item.priceCode);
    sum = sum.add(priceOf.get(item.priceCode) ?? 0);
  }
  return sum;
}
