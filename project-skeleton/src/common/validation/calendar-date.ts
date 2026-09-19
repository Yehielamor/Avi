import { ValidateBy, type ValidationOptions } from 'class-validator';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` שהוא תאריך אמיתי בלוח השנה.
 *
 * `Matches(/^\d{4}-\d{2}-\d{2}$/)` לבד העביר `2026-02-30` (JS מגלגל אותו
 * ל-2 במרץ בשקט), `2026-10-32` (`new Date` מחזיר Invalid Date ו-
 * `toISOString` זורק → 500) ו-`0000-01-01` (Postgres דוחה → 500). QA 18.09,
 * F4/F11. שנים לפני 1900 הן תמיד טעות הקלדה במערכת הזו.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export const IsCalendarDate = (options?: ValidationOptions) =>
  ValidateBy(
    {
      name: 'isCalendarDate',
      validator: {
        validate: (value) => isCalendarDate(value),
        defaultMessage: (args) => `${args?.property ?? 'date'} must be a real date in YYYY-MM-DD format`,
      },
    },
    options,
  );
