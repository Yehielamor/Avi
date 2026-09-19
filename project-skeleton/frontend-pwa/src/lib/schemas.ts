import { z } from 'zod';

/* ---------------------------------------------------------------------------
   חוזה ה-API — תת-קבוצה.

   ה-PWA נוגע בשלושה מסכים בלבד, ולכן הסכמות כאן מכסות רק את
   `/auth/*` ו-`/tasks/*`. הן מוגדרות ידנית בכוונה, כשכבת אימות
   שנייה מעל ה-OpenAPI: הן תופסות סחיפה בין שרת ללקוח בזמן ריצה.

   באופליין זה חשוב כפליים — תשובה שמורה נכתבה מול גרסת שרת ישנה
   יותר, וההצלבה כאן היא מה שמונע ממנה להתפרש שגוי.
   --------------------------------------------------------------------------- */

export const taskStatusSchema = z.enum(['NEW', 'ASSIGNED', 'IN_PROGRESS', 'CLOSED', 'CANCELLED']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskSourceSchema = z.enum(['EMAIL', 'MANUAL', 'CUSTOMER_LINK', 'QUOTE']);
export type TaskSource = z.infer<typeof taskSourceSchema>;

export const userRoleSchema = z.enum(['OWNER', 'MANAGER', 'FIELD']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const verticalSchema = z.enum(['MAINTENANCE', 'CARPENTRY', 'RETAIL']);

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
  // כל המקורות שהשרת יודע להחזיר. מקור לא מוכר כאן מפיל את הסכמה — ואיתה את
  // כל רשימת המשימות — ולכן הרשימה תואמת בדיוק ל-TaskSource ב-Prisma.
  source: taskSourceSchema,
  customerId: z.string().uuid(),
  customer: customerSchema.nullish(),
  assignedToUserId: z.string().uuid().nullish(),
  assignedTo: userSummarySchema.nullish(),
  checklist: z.array(checklistItemSchema).nullish(),
  createdAt: z.string(),
  closedAt: z.string().nullish(),
  scheduledStart: z.string().nullish(),
  scheduledEnd: z.string().nullish(),
});
export type Task = z.infer<typeof taskSchema>;

/** עימוד keyset — cursor, לא offset. offset נשבר כששורות נוספות בזמן דפדוף. */
export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullish() });

export const taskListSchema = paginated(taskSchema);
export type TaskList = z.infer<typeof taskListSchema>;

/** GET /tasks/:id — כולל relations שאינם ברשימה. */
export const taskDetailSchema = taskSchema.extend({
  jobTypeTemplate: z
    .object({ id: z.string().uuid(), name: z.string(), requiredSkill: z.string().nullish() })
    .nullish(),
  updatedAt: z.string().nullish(),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;

/** POST /tasks/:id/close — השרת מבחין בין סגירה אמיתית לניסיון חוזר. */
export const closeTaskResultSchema = z.object({
  taskId: z.string().uuid(),
  status: taskStatusSchema,
  alreadyClosed: z.boolean(),
});

const sessionUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  role: userRoleSchema,
  mustChangePassword: z.boolean(),
});

const sessionTenantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  subdomain: z.string(),
  vertical: verticalSchema,
});

/** GET /auth/me — סשן ללא טוקן חדש. */
export const sessionSchema = z.object({
  mustChangePassword: z.boolean(),
  user: sessionUserSchema,
  tenant: sessionTenantSchema,
});
export type Session = z.infer<typeof sessionSchema>;

/**
 * POST /auth/login.
 * השדה הוא `accessToken`, לא `token` — תואם ל-AuthResponse בשרת.
 */
export const authResponseSchema = sessionSchema.extend({
  accessToken: z.string().min(1),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** כל endpoint שמייצר קישור ללקוח (שיתוף, "בדרך"). */
export const shareResultSchema = z.object({ url: z.string(), waUrl: z.string().nullable(), message: z.string() });
export type ShareResult = z.infer<typeof shareResultSchema>;

const stopSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string(),
  status: taskStatusSchema,
  priority: z.number().int(),
  scheduledStart: z.string().nullable(),
  scheduledEnd: z.string().nullable(),
  overdue: z.boolean(),
  confirmed: z.boolean(),
  rescheduleRequested: z.boolean(),
  onTheWay: z.boolean(),
  customer: z.object({ name: z.string(), phone: z.string().nullable(), address: z.string().nullable() }),
  hasLocation: z.boolean(),
  wazeUrl: z.string().nullable(),
});
export type Stop = z.infer<typeof stopSchema>;

/** GET /field/my-day */
export const myDaySchema = z.object({
  date: z.string(),
  isToday: z.boolean(),
  stops: z.array(stopSchema),
  done: z.array(stopSchema),
});
export type MyDay = z.infer<typeof myDaySchema>;
