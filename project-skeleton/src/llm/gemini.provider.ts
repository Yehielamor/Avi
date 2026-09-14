import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import type { AppEnv } from '../config/env.schema';
import type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
  LlmToolResult,
} from './llm.types';

/* ---------------------------------------------------------------------------
   ספק Gemini, מול Google Generative Language API.

   מומש ב-fetch ולא ב-SDK: הפורמט יציב, התלות מיותרת, וכך אין שכבה
   נוספת שמסתירה שגיאות של הספק.

   שלוש התאמות שהפורמט של Gemini דורש ואינן מובנות מאליהן:

   1. **התפקידים שונים.** Gemini משתמש ב-`model` ולא ב-`assistant`,
      ותוצאות כלים חוזרות בתור `user` עם חלקי `functionResponse` —
      לא בתפקיד `function`, שה-API דוחה.

   2. **אין מזהה לקריאת כלי.** Anthropic מחזיר `tool_use_id` שמאפשר
      התאמה בין קריאה לתוצאה; Gemini מתאים לפי *שם* ולפי סדר. אנחנו
      מייצרים מזהה מקומי כדי שהחוזה יישאר אחיד, ומתאימים חזרה לפי שם.

   3. **חתימת חשיבה.** מודלי 3.x מחזירים `thoughtSignature` על כל
      קריאת כלי ודורשים לקבל אותה בחזרה; בלעדיה ההמשך נדחה ב-400.
      היא נישאת ב-`providerMetadata` כדי שהקוד העסקי לא יידע עליה.

   4. **JSON Schema מצומצם.** Gemini דוחה מפתחות שהוא לא מכיר
      (`additionalProperties`, `$schema`). הסכמות עוברות ניקוי.
   --------------------------------------------------------------------------- */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: unknown };
  functionResponse?: { name: string; response: unknown };
  /**
   * מודלי 3.x מחזירים חתימת חשיבה על כל קריאת כלי, ודורשים לקבל
   * אותה בחזרה. בלעדיה הקריאה נדחית ב-400.
   */
  thoughtSignature?: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code: number; message: string; status: string };
}

@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly apiKey: string;

  readonly model: string;

  constructor(config: ConfigService<AppEnv, true>) {
    this.apiKey = config.get('GEMINI_API_KEY', { infer: true });
    this.model = config.get('GEMINI_MODEL', { infer: true });
  }

  get isConfigured(): boolean {
    return this.apiKey.trim() !== '';
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    return this.call(request, this.toContents(request));
  }

  async continueWithToolResults(
    request: LlmRequest,
    previous: LlmResponse,
    results: LlmToolResult[],
  ): Promise<LlmResponse> {
    const contents = this.toContents(request);

    // תור המודל שביקש את הכלים.
    contents.push({
      role: 'model',
      parts: [
        ...(previous.text ? [{ text: previous.text }] : []),
        ...previous.toolCalls.map((c) => ({
          functionCall: { name: c.name, args: c.input },
          // מוחזרת כפי שהיא. ראו GeminiPart.thoughtSignature.
          ...(typeof c.providerMetadata?.['thoughtSignature'] === 'string'
            ? { thoughtSignature: c.providerMetadata['thoughtSignature'] }
            : {}),
        })),
      ],
    });

    // התוצאות, בתור `user` אחד.
    //
    // לא `function`: ה-API מקבל רק USER ו-MODEL, ותפקיד `function`
    // נדחה ב-400 עם רשימת התפקידים החוקיים. זו הסיבה שהקריאה
    // הראשונה הצליחה והמשך השיחה נכשל — שני מסלולים שונים.
    contents.push({
      role: 'user',
      parts: results.map((r) => ({
        functionResponse: {
          name: r.name,
          // הוא דורש אובייקט, לא מחרוזת — מחרוזת גולמית נדחית.
          response: r.isError ? { error: r.content } : { result: r.content },
        },
      })),
    });

    return this.call(request, contents);
  }

  // ---------------------------------------------------------------------------

  private toContents(request: LlmRequest): GeminiContent[] {
    return request.messages.map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.content }],
    }));
  }

  /**
   * ניסיונות חוזרים על שגיאות זמניות.
   *
   * במכסה החינמית `503 UNAVAILABLE` ("high demand") ו-`429` הם שכיחים
   * ואינם מעידים על באג. בלי retry, כל אחד מהם היה מפיל תור שלם
   * בשיחה — והמשתמש היה רואה "השירות אינו זמין" על הפרעה של שנייה.
   *
   * backoff אקספוננציאלי עם jitter: ניסיונות מרובים לא מסתנכרנים
   * וחוזרים יחד על אותו רגע.
   */
  private async call(request: LlmRequest, contents: GeminiContent[]): Promise<LlmResponse> {
    const MAX_ATTEMPTS = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.callOnce(request, contents);
      } catch (err) {
        lastError = err;
        const retryable = err instanceof GeminiApiError && err.isRetryable;
        if (!retryable || attempt === MAX_ATTEMPTS) break;

        const delay = 500 * 2 ** (attempt - 1) * (0.5 + Math.random());
        this.logger.warn(
          { attempt, delayMs: Math.round(delay), purpose: request.purpose },
          'Retrying LLM call after a transient provider error',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (lastError instanceof GeminiApiError) {
      if (lastError.isQuotaExhausted) {
        // הודעה שאומרת מה קרה ומה לעשות. "השירות אינו זמין, נסה שוב"
        // הוא שקר כאן — ניסיון חוזר לא יעזור.
        throw new ServiceUnavailableException(
          'LLM quota exhausted for this API key. Switch keys, upgrade the plan, or set LLM_PROVIDER=anthropic.',
        );
      }
      throw new ServiceUnavailableException(`LLM provider error: ${lastError.message}`);
    }
    throw lastError;
  }

  private async callOnce(request: LlmRequest, contents: GeminiContent[]): Promise<LlmResponse> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException('GEMINI_API_KEY is not configured on this server.');
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.3,
      },
    };

    if (request.system) body['systemInstruction'] = { parts: [{ text: request.system }] };
    if (request.tools?.length) {
      body['tools'] = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: sanitizeSchema(t.parameters),
          })),
        },
      ];
    }

    // timeout מפורש: ברירת המחדל של fetch היא ללא הגבלה, ובקשה
    // תקועה הייתה מחזיקה עובד עד אינסוף.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    let json: GeminiResponse;
    try {
      const res = await fetch(`${API_BASE}/models/${this.model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      json = (await res.json()) as GeminiResponse;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ServiceUnavailableException('LLM request timed out');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (json.error) {
      this.logger.warn({ code: json.error.code, status: json.error.status }, json.error.message);
      throw new GeminiApiError(json.error.code, json.error.message);
    }

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const finish = json.candidates?.[0]?.finishReason;

    const toolCalls: LlmToolCall[] = parts
      .filter((p): p is GeminiPart & { functionCall: { name: string; args: unknown } } =>
        Boolean(p.functionCall),
      )
      .map((p) => ({
        // Gemini לא מספק מזהה. מייצרים אחד כדי לשמור על חוזה אחיד
        // מול Anthropic; ההתאמה חזרה נעשית לפי שם.
        id: randomUUID(),
        name: p.functionCall.name,
        input: p.functionCall.args,
        ...(p.thoughtSignature ? { providerMetadata: { thoughtSignature: p.thoughtSignature } } : {}),
      }));

    return {
      text: parts
        .map((p) => p.text ?? '')
        .join('')
        .trim(),
      toolCalls,
      stopReason:
        toolCalls.length > 0
          ? 'tool_use'
          : finish === 'MAX_TOKENS'
            ? 'max_tokens'
            : finish === 'STOP'
              ? 'end'
              : 'other',
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: this.model,
    };
  }
}

/**
 * Gemini דוחה מפתחות JSON Schema שאינו מכיר.
 *
 * `additionalProperties`, `$schema` ו-`default` נפוצים בסכמות שנוצרות
 * מ-Zod, והם גורמים ל-400 שקשה לפענח. מנוקים רקורסיבית.
 */
function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (typeof schema !== 'object' || schema === null) return schema;

  const dropped = new Set(['additionalProperties', '$schema', 'default', 'examples', 'const']);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (dropped.has(key)) continue;
    out[key] = sanitizeSchema(value);
  }
  return out;
}

/**
 * שגיאה מה-API, עם הבחנה בין שלושה מצבים שונים לחלוטין.
 *
 * ההבחנה חשובה: שתי השגיאות מגיעות כ-429, אבל
 *
 *   • **עומס זמני** — שווה ניסיון חוזר, יעבור מעצמו.
 *   • **מכסה מוצתה** — ניסיון חוזר רק שורף את מה שנשאר ומאריך את
 *     ההמתנה. צריך מפתח אחר או חבילה בתשלום.
 *
 * טיפול זהה בשניהם הוא מה שהופך מכסה שנגמרה ל-"נסה שוב" אינסופי.
 */
class GeminiApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'GeminiApiError';
  }

  /** מכסה שנגמרה, להבדיל מעומס רגעי. */
  get isQuotaExhausted(): boolean {
    return this.code === 429 && /quota|billing|rate.?limit/i.test(this.message);
  }

  get isRetryable(): boolean {
    if (this.isQuotaExhausted) return false;
    return this.code === 429 || this.code >= 500;
  }
}
