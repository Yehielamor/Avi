import { z } from 'zod';
import { request } from '@/lib/api';

/* ---------------------------------------------------------------------------
   חוזה המחירון.

   `price` הוא מחרוזת לכל אורך הדרך — Prisma.Decimal מסורלז כמחרוזת,
   והשרת *מקבל* מחרוזת בלבד (ראה price.validator.ts). אין כאן אף
   רגע שבו מחיר הוא number, ולכן אין רגע שבו הוא יכול לזוז בסנט.
   --------------------------------------------------------------------------- */

export const priceListItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  description: z.string(),
  price: z.string(),
  isActive: z.boolean(),
  usedByTemplates: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type PriceListItem = z.infer<typeof priceListItemSchema>;

export const PRICE_LIST_QUERY_KEY = 'price-list';

/** זהה ל-PRICE_PATTERN בשרת: עד 10 ספרות שלמות ועד 2 אחרי הנקודה. */
export const PRICE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** זהה ל-@Matches על `code` ב-DTO. */
export const CODE_PATTERN = /^[A-Za-z0-9._-]+$/;

export function fetchPriceList(includeInactive: boolean, signal?: AbortSignal): Promise<PriceListItem[]> {
  const qs = includeInactive ? '?includeInactive=true' : '';
  return request(`/price-list${qs}`, { schema: z.array(priceListItemSchema), signal });
}

export function createPriceListItem(body: { code: string; description: string; price: string }) {
  return request('/price-list', { method: 'POST', body, schema: priceListItemSchema });
}

export function updatePriceListItem(
  id: string,
  body: Partial<{ description: string; price: string; isActive: boolean }>,
) {
  return request(`/price-list/${id}`, { method: 'PATCH', body, schema: priceListItemSchema });
}
