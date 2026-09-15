/**
 * חוזה ספק ה-LLM.
 *
 * למה הפשטה ולא קריאה ישירה:
 *
 *   שלוש נקודות בקוד קראו ישירות ל-SDK של Anthropic, כולל את פורמט
 *   ה-tool-use שלו. החלפת ספק הייתה דורשת לגעת בשלושתן ובלוגיקה
 *   העסקית סביבן. הגבול כאן מבודד את זה: הקוד העסקי מדבר במונחים
 *   שלו, וכל ספק מתרגם לעצמו.
 *
 *   זה גם מה שמאפשר להריץ Gemini בפיתוח ו-Claude בפרודקשן, או
 *   להחליף כשמחיר או איכות משתנים — בלי לגעת בלוגיקה.
 */

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** קריאה לכלי שהמודל ביקש. */
export interface LlmToolCall {
  /** מזהה הקריאה, לצורך התאמת התוצאה. Gemini לא מספק אחד — נוצר מקומית. */
  id: string;
  name: string;
  /** ארגומנטים גולמיים. **חייבים אימות סכמה לפני שימוש.** */
  input: unknown;

  /**
   * נתון אטום שהספק דורש להחזיר לו כפי שהוא.
   *
   * קיים כי Gemini 3.x מחייב `thoughtSignature` על כל `functionCall`
   * שמוחזר אליו, ובלעדיו הקריאה נדחית. הקוד העסקי לא אמור לדעת על
   * זה — הוא רק מעביר את האובייקט הלאה. כל ספק מחליט מה לשים כאן.
   */
  providerMetadata?: Record<string, unknown>;
}

export interface LlmToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

/** הגדרת כלי. הסכמה היא JSON Schema — המכנה המשותף לשני הספקים. */
export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  system?: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  /** נרשם ב-LlmUsage לצורך חשבונאות ותקציב. */
  purpose: string;
  tenantId?: string;
}

export interface LlmUsageInfo {
  inputTokens: number;
  outputTokens: number;
  /**
   * טוקנים שנקראו ממטמון. מחויבים בשבריר ממחיר קלט רגיל, ולכן
   * הפרדתם היא ההבדל בין לדעת כמה ה-caching חוסך לבין לנחש.
   */
  cacheReadTokens?: number;
  /** טוקנים שנכתבו למטמון. מחויבים מעט מעל קלט רגיל, פעם אחת. */
  cacheCreationTokens?: number;
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  /** `tool_use` = המודל מחכה לתוצאות; `end` = סיים. */
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'other';
  usage: LlmUsageInfo;
  model: string;
}

/**
 * ספק LLM.
 *
 * `continueWithToolResults` קיים בנפרד מ-`complete` כי שני הספקים
 * מייצגים תוצאות כלים אחרת: Anthropic כתפקיד `user` עם בלוקי
 * `tool_result`, Gemini כתפקיד `function` עם `functionResponse`.
 * המימוש מסתיר את ההבדל.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly isConfigured: boolean;

  complete(request: LlmRequest): Promise<LlmResponse>;

  continueWithToolResults(
    request: LlmRequest,
    previous: LlmResponse,
    results: LlmToolResult[],
  ): Promise<LlmResponse>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
