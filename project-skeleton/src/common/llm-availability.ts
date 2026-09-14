import { ServiceUnavailableException } from '@nestjs/common';

/**
 * שער אחד לכל הפיצ'רים שתלויים ב-LLM.
 *
 * בלי מפתח, ה-SDK של Anthropic נבנה בשקט ונופל רק בקריאה הראשונה —
 * עם `Cannot read properties of undefined`, עמוק בתוך זרימת משתמש,
 * בלי רמז למה. בסביבת פיתוח שבה המפתח לא הוגדר זו הודעת השגיאה
 * הראשונה שמפתח חדש רואה, והיא חסרת תועלת.
 *
 * 503 ולא 500: זו אינה תקלה אלא יכולת שלא הוגדרה, וזה ההבדל בין
 * "נסה שוב" לבין "הגדר מפתח".
 */
export function assertLlmConfigured(apiKey: string | undefined, feature: string): void {
  if (apiKey && apiKey.trim() !== '') return;

  throw new ServiceUnavailableException(
    `${feature} requires an LLM and ANTHROPIC_API_KEY is not configured on this server.`,
  );
}

export const isLlmConfigured = (apiKey: string | undefined): boolean =>
  Boolean(apiKey && apiKey.trim() !== '');
