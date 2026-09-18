import { Prisma } from '@prisma/client';

/* ---------------------------------------------------------------------------
   החלקים הטהורים של תדריך הבוקר — בלי DB, כדי שייבדקו ישירות.
   --------------------------------------------------------------------------- */

export type ActivationStep = 'priceList' | 'equipment' | 'statusLink' | 'quote';

export interface Activation {
  steps: Array<{ key: ActivationStep; done: boolean }>;
  completed: number;
  total: number;
  allDone: boolean;
}

/** הסדר הוא סדר ההצגה: כל צעד בונה על הקודם (הצעת מחיר צריכה מחירון). */
const ORDER: ActivationStep[] = ['priceList', 'equipment', 'statusLink', 'quote'];

export function buildActivation(counts: Record<ActivationStep, number>): Activation {
  const steps = ORDER.map((key) => ({ key, done: counts[key] > 0 }));
  const completed = steps.filter((s) => s.done).length;
  return { steps, completed, total: steps.length, allDone: completed === steps.length };
}

/**
 * שווי משוער של ציוד שמגיע לטיפול: ממוצע ההכנסה מעבודות ציוד קודמות × כמות.
 *
 * בלי היסטוריה — null, ולא אפס ולא מספר מומצא. "12 לקוחות = ₪0" היה
 * מלמד את בעל העסק שהשורה לא שווה כלום; מספר מומצא היה פוגע באמון בכל
 * שאר המספרים בדשבורד.
 */
export function maintenanceEstimate(avgPerJob: Prisma.Decimal | null, count: number): string | null {
  if (avgPerJob === null || count === 0) return null;
  return avgPerJob.mul(count).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}
