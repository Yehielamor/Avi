import { Matches } from 'class-validator';

/**
 * מחיר מתקבל כמחרוזת עשרונית ולא כ-number.
 *
 * `149.9` כ-JSON number עובר דרך double לפני שהוא מגיע ל-Decimal, ו-
 * `0.1 + 0.2` כבר הוכיח מה זה עושה (קונבנציות, סעיף 4). מחרוזת נכנסת
 * ל-`Prisma.Decimal` ישירות, בלי אף רגע של float באמצע.
 *
 * עד שתי ספרות אחרי הנקודה — העמודה היא `Decimal(12, 2)`, ו-Postgres
 * היה מעגל שלוש ספרות בשקט. עדיף 400 מאשר מחיר ששונה בלי שאיש ביקש.
 */
export const PRICE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export const IsPrice = () =>
  Matches(PRICE_PATTERN, {
    message: 'price must be a non-negative decimal string with at most 2 decimal places, e.g. "149.90"',
  });
