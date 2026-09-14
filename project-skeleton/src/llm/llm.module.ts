import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnv } from '../config/env.schema';
import { AnthropicProvider } from './anthropic.provider';
import { GeminiProvider } from './gemini.provider';
import { LLM_PROVIDER, type LlmProvider } from './llm.types';

/**
 * בחירת ספק ה-LLM.
 *
 * הבחירה היא ב-`LLM_PROVIDER` בקונפיגורציה, עם נפילה-אחורה למי
 * שמוגדר בפועל. זה מאפשר להריץ Gemini בפיתוח — יש לו מכסה חינמית —
 * ו-Claude בפרודקשן, בלי שום שינוי בקוד העסקי.
 *
 * הבחירה נרשמת בעלייה. ספק שהתחלף בלי ששמו לב הוא בדיוק סוג הדבר
 * שמתגלה מאוחר מדי, דרך חשבון או דרך איכות תשובות שהשתנתה.
 */
@Global()
@Module({
  providers: [
    AnthropicProvider,
    GeminiProvider,
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService, AnthropicProvider, GeminiProvider],
      useFactory: (
        config: ConfigService<AppEnv, true>,
        anthropic: AnthropicProvider,
        gemini: GeminiProvider,
      ): LlmProvider => {
        const logger = new Logger('LlmModule');
        const preferred = config.get('LLM_PROVIDER', { infer: true });

        const chosen =
          preferred === 'gemini'
            ? gemini
            : preferred === 'anthropic'
              ? anthropic
              : // auto: מי שמוגדר. Anthropic קודם — הוא ברירת המחדל
                // לפרודקשן, ו-Gemini הוא החלופה החינמית לפיתוח.
                anthropic.isConfigured
                ? anthropic
                : gemini;

        if (!chosen.isConfigured) {
          logger.warn(
            `LLM provider "${chosen.name}" has no API key. LLM features will return 503 until one is set.`,
          );
        } else {
          logger.log(`LLM provider: ${chosen.name} (${chosen.model})`);
        }

        return chosen;
      },
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
