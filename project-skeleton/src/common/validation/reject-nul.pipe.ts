import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

const NUL = String.fromCharCode(0);
/** עומק מקסימלי לסריקה — גוף JSON תקין במערכת הזו רדוד בהרבה. */
const MAX_DEPTH = 32;

export function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes(NUL);
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => containsNul(v, depth + 1));
  // רק אובייקטים פשוטים (JSON / query). קובץ שהועלה (Buffer) הוא בינארי
  // לגיטימי, וסריקה של מיליוני אינדקסים שלו הייתה DoS בפני עצמה.
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.entries(value).some(([k, v]) => k.includes(NUL) || containsNul(v, depth + 1));
}

/**
 * דוחה ב-400 כל קלט (body, query, params) שמכיל תו NUL (U+0000).
 *
 * Postgres לא מסוגל לשמור NUL בעמודת TEXT או ב-JSONB, כך שכל ערך כזה
 * נכשל ב-DB כ-500 — ובפיתוח עוד מחזיר את נתיב הקובץ ואת השאילתה (QA 18.09,
 * F4). אין שדה במערכת שבו NUL הוא קלט לגיטימי, ולכן זה גלובלי ולא per-DTO:
 * שדה טקסט חדש לא יכול "לשכוח" את הבדיקה.
 */
@Injectable()
export class RejectNulPipe implements PipeTransform {
  transform<T>(value: T): T {
    if (containsNul(value)) throw new BadRequestException('Text may not contain NUL (U+0000) characters');
    return value;
  }
}
