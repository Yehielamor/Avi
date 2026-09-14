import { z } from 'zod';
import { invoiceSchema, type Invoice } from '@/lib/schemas';

/* ---------------------------------------------------------------------------
   חוזה ה-API של החשבוניות.

   `GET /v1/invoices` מחזיר **מערך שטוח**, לא מעטפת `{ items, nextCursor }`
   כמו משימות ולקוחות — ולכן אי אפשר להשתמש כאן ב-`paginated()`
   שב-`lib/schemas.ts`. הסכמה מוגדרת כאן במפורש כדי שהפער הזה יהיה
   גלוי בקוד ולא יתגלה כ-"תשובת השרת אינה בפורמט צפוי" בזמן ריצה.
   --------------------------------------------------------------------------- */

export const invoiceListSchema = z.array(invoiceSchema);

export type { Invoice };

export const invoicesQueryKey = ['invoices'] as const;
