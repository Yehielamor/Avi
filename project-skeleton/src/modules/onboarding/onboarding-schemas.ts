import { UserRole, Vertical } from '@prisma/client';
import { z } from 'zod';

// ============================================================
// סכמות Zod לכל קלט שמגיע מקריאת tool של ה-LLM.
//
// הגרסה הקודמת עשתה `input as unknown as CompanyInfo` וכתבה את התוצאה
// ישירות ל-`tenant.create` / `user.create`: `role` מעולם לא נבדק מול
// UserRole, ו-`defaultPrice` מעולם לא נבדק כמספר. מודל ששיבש שדה אחד
// (או קלט משתמש שהשפיע עליו) הגיע עד ה-DB.
// ראו docs/20-backend-conventions.md#9 — `as unknown as X` אסור.
// ============================================================

/** אימייל של איש צוות הופך לחשבון אמיתי, ולכן נורמליזציה כאן ולא בשלוש נקודות אחרות. */
const email = z.string().trim().toLowerCase().email().max(254);

const shortText = (max: number) => z.string().trim().min(1).max(max);

export const companyInfoSchema = z.object({
  legalName: shortText(200),
  businessId: shortText(20).regex(/^[0-9A-Za-z\-]+$/, 'businessId must be alphanumeric'),
  vertical: z.nativeEnum(Vertical),
  contactEmail: email,
});
export type CompanyInfo = z.infer<typeof companyInfoSchema>;

export const teamMemberSchema = z.object({
  name: shortText(120),
  email,
  // z.nativeEnum ולא z.string(): תפקיד שאינו ב-UserRole נדחה כאן,
  // לא ב-Prisma עם שגיאת enum אטומה — או גרוע מכך, מתקבל.
  role: z.nativeEnum(UserRole),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const priceCodeSchema = z.object({
  code: shortText(40).regex(/^[A-Za-z0-9._\-]+$/, 'code must not contain spaces'),
  description: shortText(500),
  // finite: מודל שמחזיר Infinity/NaN היה הופך ל-Decimal לא תקין.
  defaultPrice: z.number().finite().nonnegative().max(1_000_000),
});
export type PriceCode = z.infer<typeof priceCodeSchema>;

export const jobTypeSchema = z.object({
  name: shortText(120),
  requiredSkill: shortText(80).optional(),
  fields: z
    .array(
      z.object({
        key: shortText(60).regex(/^[A-Za-z0-9_]+$/, 'field key must be a simple identifier'),
        label: shortText(120),
        type: z.enum(['text', 'number', 'select', 'date']),
        required: z.boolean().optional(),
      }),
    )
    .max(50),
  defaultChecklist: z
    .array(
      z.object({
        label: shortText(200),
        priceCode: shortText(40).optional(),
      }),
    )
    .max(100),
});
export type JobTypeDraft = z.infer<typeof jobTypeSchema>;

export const readyToFinalizeSchema = z.object({
  summary: shortText(2_000),
});

/**
 * מצב הסשן כפי שהוא נשמר ב-JSON. נקרא חזרה מה-DB דרך הסכמה הזו — מה
 * שנכתב לפני שהאימות התהדק לא מקבל אמון רק בגלל שהוא כבר בטבלה.
 */
export const sessionDraftSchema = z.object({
  companyInfo: companyInfoSchema.nullable(),
  teamMembers: z.array(teamMemberSchema),
  priceCodes: z.array(priceCodeSchema),
  jobTypes: z.array(jobTypeSchema),
});
export type SessionDraft = z.infer<typeof sessionDraftSchema>;

/** קורא ערך JSON מה-DB בסובלנות: קלט פגום הופך לברירת מחדל ריקה במקום להפיל את הסשן. */
export function parseStored<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}
