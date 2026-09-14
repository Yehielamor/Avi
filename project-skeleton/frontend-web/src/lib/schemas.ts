import { z } from 'zod';

/* ---------------------------------------------------------------------------
   חוזה ה-API.

   מקור האמת הוא ה-OpenAPI שהשרת מייצר ב-/docs/openapi.json. הסכמות
   כאן מוגדרות ידנית בכוונה, כשכבת אימות שנייה: הן תופסות סחיפה בין
   שרת ללקוח בזמן ריצה, לא רק בזמן בנייה.
   --------------------------------------------------------------------------- */

export const taskStatusSchema = z.enum(['NEW', 'ASSIGNED', 'IN_PROGRESS', 'CLOSED', 'CANCELLED']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const userRoleSchema = z.enum(['OWNER', 'MANAGER', 'FIELD']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const verticalSchema = z.enum(['MAINTENANCE', 'CARPENTRY', 'RETAIL']);

/** כסף מגיע כמחרוזת, לא כ-number. ראו formatCurrency. */
const money = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'invalid decimal');

export const checklistItemSchema = z.object({
  label: z.string(),
  done: z.boolean().default(false),
  priceCode: z.string().nullish(),
  sku: z.string().nullish(),
  qty: z.number().int().positive().nullish(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const customerSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  address: z.string().nullish(),
  createdAt: z.string(),
});
export type Customer = z.infer<typeof customerSchema>;

export const userSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: userRoleSchema,
});

export const taskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullish(),
  status: taskStatusSchema,
  priority: z.number().int(),
  source: z.enum(['EMAIL', 'MANUAL']),
  customerId: z.string().uuid(),
  customer: customerSchema.nullish(),
  assignedToUserId: z.string().uuid().nullish(),
  assignedTo: userSummarySchema.nullish(),
  checklist: z.array(checklistItemSchema).nullish(),
  createdAt: z.string(),
  closedAt: z.string().nullish(),
});
export type Task = z.infer<typeof taskSchema>;

/** עימוד keyset — cursor, לא offset. offset נשבר כששורות נוספות בזמן דפדוף. */
export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullish() });

export const taskListSchema = paginated(taskSchema);

/** GET /tasks/:id — כולל relations שאינם ברשימה. */
export const taskDetailSchema = taskSchema.extend({
  jobTypeTemplate: z
    .object({ id: z.string().uuid(), name: z.string(), requiredSkill: z.string().nullish() })
    .nullish(),
  updatedAt: z.string().nullish(),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;
export const customerListSchema = paginated(customerSchema);

export const inventoryItemSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  quantity: z.number().int(),
  lowStockThreshold: z.number().int(),
  unitPrice: money.nullish(),
  category: z.string().nullish(),
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export const invoiceSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.number().int(),
  customerId: z.string().uuid(),
  customer: customerSchema.nullish(),
  periodStart: z.string(),
  periodEnd: z.string(),
  totalAmount: money,
  status: z.enum(['DRAFT', 'FINALIZED', 'VOID']),
  createdAt: z.string(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const sessionSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string(),
    role: userRoleSchema,
    mustChangePassword: z.boolean().default(false),
  }),
  tenant: z.object({
    id: z.string().uuid(),
    name: z.string(),
    subdomain: z.string(),
    vertical: verticalSchema,
  }),
});
export type Session = z.infer<typeof sessionSchema>;
