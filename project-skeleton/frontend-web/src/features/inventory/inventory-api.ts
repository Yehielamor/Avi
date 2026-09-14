import { z } from 'zod';
import { request } from '@/lib/api';
import { inventoryItemSchema, type InventoryItem } from '@/lib/schemas';

/* ---------------------------------------------------------------------------
   חוזה מודול המלאי.

   שני ה-endpoints מחזירים מערך *עירום*, לא מעטפת `{ items, nextCursor }`
   כמו שאר המודולים — ולכן העימוד כאן הוא limit/offset לפי
   `ListInventoryQueryDto`, ואין ספירה כוללת. "יש עמוד הבא" נגזר מכך
   שהעמוד חזר מלא. זה מכוון: `COUNT(*)` על 50k שורות בכל טעינת מסך
   הוא בדיוק מה שהוורטיקל הקמעונאי לא יכול לשאת.
   --------------------------------------------------------------------------- */

export const PAGE_SIZE = 50;

export const inventoryListSchema = z.array(inventoryItemSchema);

/**
 * `adjustQuantity` מחזיר StockRow ולא את הפריט המלא — בלי unitPrice
 * ובלי category. סכימה נפרדת, כדי שההבדל ייתפס אם החוזה ישתנה.
 */
export const stockRowSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  quantity: z.number().int(),
  lowStockThreshold: z.number().int(),
});
export type StockRow = z.infer<typeof stockRowSchema>;

export type InventoryScope = 'all' | 'low';

export const INVENTORY_QUERY_KEY = 'inventory';

export function fetchInventory(
  scope: InventoryScope,
  page: number,
  signal?: AbortSignal,
): Promise<InventoryItem[]> {
  const path = scope === 'low' ? '/inventory/low-stock' : '/inventory';
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });
  return request(`${path}?${params.toString()}`, { schema: inventoryListSchema, signal });
}

export function isLowStock(item: Pick<InventoryItem, 'quantity' | 'lowStockThreshold'>): boolean {
  return item.quantity <= item.lowStockThreshold;
}
