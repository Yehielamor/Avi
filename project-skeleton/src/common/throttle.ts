import type { ThrottlerOptions } from '@nestjs/throttler';

/**
 * ה-throttlers הגלובליים. `@Throttle({...})` על נתיב יכול רק *לדרוס* אחד
 * מהשמות האלה — שם שלא מופיע כאן (למשל `default`) מתעלם בשקט, וזה בדיוק
 * מה שקרה לכל הנתיבים הציבוריים עד QA 18.09 (F3): הם הגדירו `default`,
 * והמגבלה ההדוקה לא נאכפה אף פעם. throttle.spec.ts בודק שכל דריסה בקוד
 * משתמשת בשם שקיים כאן.
 */
export const THROTTLERS: ThrottlerOptions[] = [
  { name: 'short', ttl: 1_000, limit: 20 },
  { name: 'medium', ttl: 60_000, limit: 200 },
  { name: 'long', ttl: 3_600_000, limit: 2_000 },
];

export const THROTTLER_NAMES: ReadonlySet<string> = new Set(THROTTLERS.map((t) => t.name!));

/**
 * קישורים ציבוריים (טוקן בלי התחברות). המכסה נספרת לכל נתיב ולכל IP.
 * דורסים את `short` — החלון הקצר הופך לדקה — כך שהמגבלה ההדוקה היא
 * הראשונה שנתקלים בה; `medium`/`long` הגלובליים עדיין חלים מעליה.
 */
export const PUBLIC_VIEW_THROTTLE = { short: { limit: 30, ttl: 60_000 } };

/** פעולה של לקוח (אישור, בקשת מועד, הזמנה, אישור/דחיית הצעה) — כל אחת כותבת. */
export const PUBLIC_ACTION_THROTTLE = { short: { limit: 5, ttl: 60_000 } };
