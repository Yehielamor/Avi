import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnv } from '../config/env.schema';
import { PrismaService } from '../database/prisma.service';
import { estimateCostMinor, isModelPriced } from './llm-pricing';
import type { LlmUsageInfo } from './llm.types';

/**
 * חשבונאות ואכיפת תקציב ל-LLM.
 *
 * טבלת `LlmUsage` ותקרת `llmMonthlyBudgetMinor` היו בסכימה מהיום
 * הראשון — **ואף אחד לא כתב אליהן ולא קרא מהן.** כלומר לא הייתה
 * תשובה ל"כמה הטננט הזה עולה לנו", והתקרה שהוגדרה לא הגבילה כלום.
 *
 * הנושא אינו תיאורטי: המכסה של Gemini נגמרה באמצע שיחת onboarding
 * אמיתית. ההבדל היחיד בין זה לבין חשבון מפתיע הוא שהמכסה החינמית
 * עוצרת מעצמה.
 */
@Injectable()
export class LlmUsageService {
  private readonly logger = new Logger(LlmUsageService.name);
  private readonly defaultBudgetMinor: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppEnv, true>,
  ) {
    this.defaultBudgetMinor = config.get('LLM_DEFAULT_MONTHLY_BUDGET_MINOR', { infer: true });
  }

  /**
   * נבדק **לפני** הקריאה. חריגה עוצרת את הפעולה.
   *
   * בדיקה אחרי הקריאה הייתה מאפשרת לחרוג בכל פעם ורק אז להתריע —
   * כלומר תקרה שתמיד נפרצת פעם אחת.
   */
  async assertWithinBudget(tenantId: string, purpose: string): Promise<void> {
    const { spentMinor, budgetMinor } = await this.monthToDate(tenantId);

    if (spentMinor >= budgetMinor) {
      this.logger.warn(
        { tenantId, purpose, spentMinor, budgetMinor },
        'Tenant exceeded its monthly LLM budget',
      );
      throw new ForbiddenException(
        'Monthly AI budget for this account has been reached. Contact your administrator to raise it.',
      );
    }
  }

  /**
   * נרשם **אחרי** הקריאה, גם כשהיא נכשלה בהמשך הזרימה: הטוקנים
   * נצרכו בפועל, וספירה רק של הצלחות מייצרת חשבון נמוך מהאמת.
   *
   * לא זורק לעולם. כישלון ברישום הוא בעיה תפעולית, לא סיבה להפיל
   * פעולה עסקית שכבר הצליחה.
   */
  async record(
    tenantId: string | undefined,
    purpose: string,
    model: string,
    usage: LlmUsageInfo,
  ): Promise<void> {
    // ל-onboarding אין עדיין טננט, ולכן אין לאן לשייך. השליטה שם
    // היא תקרת קריאות לסשן (`llmCallCount`), לא תקציב.
    if (!tenantId) return;

    if (!isModelPriced(model)) {
      // מודל לא מוכר נספר בהערכה גסה. האזהרה קיימת כדי שמחירון
      // שהתיישן יתגלה, במקום שהעלות תיראה נמוכה מדי בשקט.
      this.logger.warn({ model }, 'No price entry for model — cost is a rough estimate');
    }

    try {
      await this.prisma.forTenant(tenantId, (tx) =>
        tx.llmUsage.create({
          data: {
            tenantId,
            purpose,
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            estimatedCostMinor: estimateCostMinor(model, usage),
          },
        }),
      );
    } catch (err) {
      this.logger.error({ err, tenantId, purpose }, 'Failed to record LLM usage');
    }
  }

  /** ההוצאה מתחילת החודש מול התקרה, באגורות. */
  async monthToDate(tenantId: string): Promise<{ spentMinor: number; budgetMinor: number }> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ spent: bigint | null; budget: number | null }>>`
        SELECT
          (SELECT COALESCE(sum("estimatedCostMinor"), 0)
             FROM llm_usage
            WHERE "tenantId" = ${tenantId}::uuid
              -- גבול החודש באזור הזמן של העסק, כמו בכל שאר המערכת.
              AND "createdAt" >= date_trunc('month', now() AT TIME ZONE 'Asia/Jerusalem')
                                  AT TIME ZONE 'Asia/Jerusalem') AS spent,
          (SELECT "llmMonthlyBudgetMinor" FROM tenant_configs
            WHERE "tenantId" = ${tenantId}::uuid) AS budget
      `;

      return {
        spentMinor: Number(row?.spent ?? 0),
        budgetMinor: row?.budget ?? this.defaultBudgetMinor,
      };
    });
  }
}
