import { Transform } from 'class-transformer';

/**
 * מקצץ רווחים לפני הולידציה.
 *
 * `@Length(1, …)` נבדק על הערך הגולמי, והשירות קיצץ רק אחריו — ולכן `"   "`
 * עבר ונשמר כמחרוזת ריקה (QA 18.09, F10). עם Trim לפני, זה 400, והשירות
 * מקבל ערך מקוצץ. ערך שאינו מחרוזת עובר כמו שהוא, ו-IsString דוחה אותו.
 */
export const Trim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
