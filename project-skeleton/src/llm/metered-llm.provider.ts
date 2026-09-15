import { Injectable } from '@nestjs/common';

import { LlmUsageService } from './llm-usage.service';
import type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolResult,
} from './llm.types';

/**
 * עוטף ספק ומודד אותו.
 *
 * למה עטיפה ולא קריאה ידנית ב-כל אתר שימוש:
 *
 *   שלוש נקודות בקוד קוראות ל-LLM, וכל אחת עלולה לשכוח לרשום או
 *   לבדוק תקציב. זו בדיוק הסיבה שטבלת `LlmUsage` נשארה ריקה — היא
 *   הייתה תלויה בזה שמישהו יזכור. כאן אין מה לזכור: **כל** קריאה
 *   שעוברת דרך ה-provider נמדדת.
 *
 *   מסקנה נוספת: הוספת נקודת קריאה רביעית בעתיד תהיה מדודה מעצמה.
 */
@Injectable()
export class MeteredLlmProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly usage: LlmUsageService,
  ) {}

  get name(): string {
    return this.inner.name;
  }
  get model(): string {
    return this.inner.model;
  }
  get isConfigured(): boolean {
    return this.inner.isConfigured;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (request.tenantId) await this.usage.assertWithinBudget(request.tenantId, request.purpose);
    return this.meter(request, () => this.inner.complete(request));
  }

  async continueWithToolResults(
    request: LlmRequest,
    previous: LlmResponse,
    results: LlmToolResult[],
  ): Promise<LlmResponse> {
    // אין בדיקת תקציב כאן במכוון: הסבב כבר התחיל, והפסקה באמצע
    // לולאת tool-use משאירה את השיחה במצב חצי-מעובד. התקרה נבדקת
    // בכניסה לסבב.
    return this.meter(request, () => this.inner.continueWithToolResults(request, previous, results));
  }

  /**
   * רושם את השימוש גם כשהקריאה נכשלה אחריה.
   *
   * אם ה-API החזיר תשובה, הטוקנים נצרכו — בין אם הקוד שלנו הצליח
   * לעבד אותה ובין אם לא. רישום רק של הצלחות מייצר חשבון נמוך מהאמת.
   */
  private async meter(request: LlmRequest, call: () => Promise<LlmResponse>): Promise<LlmResponse> {
    const response = await call();
    await this.usage.record(request.tenantId, request.purpose, response.model, response.usage);
    return response;
  }
}
