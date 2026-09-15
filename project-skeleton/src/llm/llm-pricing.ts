/**
 * תמחור מודלים, באגורות למיליון טוקנים.
 *
 * מוחזק בקוד ולא ב-DB: הוא משתנה לעיתים נדירות, וערך שגוי כאן מייצר
 * חשבון שגוי — עדיף שישב ב-diff שאפשר לסקור מאשר בשורה שמישהו ערך
 * בלי שאיש ראה.
 *
 * הערכים הם **הערכה**, לא חיוב. הם קיימים כדי לענות "כמה הטננט הזה
 * עולה לנו" ולאכוף תקרה — לא כדי להתאים לחשבונית של הספק לאגורה.
 * לכן `estimatedCostMinor` בסכימה, ולא `cost`.
 */

export interface ModelPrice {
  /** אגורות למיליון טוקני קלט. */
  inputMinorPerMillion: number;
  outputMinorPerMillion: number;
}

/** ברירת מחדל כשמודל אינו מוכר — לא אפס, כדי שלא ייראה חינם. */
const UNKNOWN: ModelPrice = { inputMinorPerMillion: 1_000, outputMinorPerMillion: 5_000 };

const PRICES: Record<string, ModelPrice> = {
  // Anthropic — לפי מחירון $/MTok, מומר לאגורות בשער מעוגל.
  'claude-opus-5': { inputMinorPerMillion: 5_500, outputMinorPerMillion: 27_500 },
  'claude-sonnet-5': { inputMinorPerMillion: 1_100, outputMinorPerMillion: 5_500 },
  'claude-haiku-4-5-20251001': { inputMinorPerMillion: 370, outputMinorPerMillion: 1_840 },

  // Gemini — המכסה החינמית היא 0, אבל מעליה יש חיוב. נרשם לפי
  // המחיר בתשלום כדי שהמספר לא יטעה כשעוברים לחבילה.
  'gemini-3.7-flash': { inputMinorPerMillion: 110, outputMinorPerMillion: 400 },
  'gemini-3.6-flash': { inputMinorPerMillion: 110, outputMinorPerMillion: 400 },
  'gemini-3.5-flash-lite': { inputMinorPerMillion: 40, outputMinorPerMillion: 150 },
  'gemini-3-flash-preview': { inputMinorPerMillion: 110, outputMinorPerMillion: 400 },
};

export function priceFor(model: string): ModelPrice {
  return PRICES[model] ?? UNKNOWN;
}

/**
 * מכפילי מטמון.
 *
 * קריאה ממטמון מחויבת בשבריר ממחיר קלט; כתיבה אליו מחויבת מעט
 * מעל — פעם אחת. אלה היחסים שהספקים מפרסמים, ולכן הם מכפילים
 * ולא שורות מחיר נפרדות לכל מודל.
 */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** עלות מוערכת באגורות, מעוגלת כלפי מעלה — עדיף להעריך ביתר. */
export function estimateCostMinor(
  model: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  },
): number {
  const p = priceFor(model);
  const inputMinor =
    usage.inputTokens * p.inputMinorPerMillion +
    (usage.cacheReadTokens ?? 0) * p.inputMinorPerMillion * CACHE_READ_MULTIPLIER +
    (usage.cacheCreationTokens ?? 0) * p.inputMinorPerMillion * CACHE_WRITE_MULTIPLIER;

  return Math.ceil((inputMinor + usage.outputTokens * p.outputMinorPerMillion) / 1_000_000);
}

export const isModelPriced = (model: string): boolean => model in PRICES;
