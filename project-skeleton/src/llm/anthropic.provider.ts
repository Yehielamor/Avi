import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnv } from '../config/env.schema';
import type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
  LlmToolResult,
} from './llm.types';

/**
 * ספק Anthropic, מאחורי אותו חוזה כמו Gemini.
 *
 * ה-SDK כאן כן בשימוש (בניגוד ל-Gemini) כי הוא מטפל ב-retry, ב-
 * streaming ובטיפוסים של בלוקי התוכן — שהם מורכבים יותר מפורמט
 * ה-parts של Gemini.
 */
@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic;
  private readonly apiKey: string;

  readonly model: string;

  constructor(config: ConfigService<AppEnv, true>) {
    this.apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.model = config.get('ANTHROPIC_ONBOARDING_MODEL', { infer: true });
    this.client = new Anthropic({ apiKey: this.apiKey, maxRetries: 2, timeout: 60_000 });
  }

  get isConfigured(): boolean {
    return this.apiKey.trim() !== '';
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    return this.call(request, request.messages.map(toAnthropicMessage));
  }

  async continueWithToolResults(
    request: LlmRequest,
    previous: LlmResponse,
    results: LlmToolResult[],
  ): Promise<LlmResponse> {
    const messages: Anthropic.MessageParam[] = request.messages.map(toAnthropicMessage);

    messages.push({
      role: 'assistant',
      content: [
        ...(previous.text ? [{ type: 'text' as const, text: previous.text }] : []),
        ...previous.toolCalls.map((c) => ({
          type: 'tool_use' as const,
          id: c.id,
          name: c.name,
          input: (c.input ?? {}) as Record<string, unknown>,
        })),
      ],
    });

    messages.push({
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result' as const,
        tool_use_id: r.toolCallId,
        content: r.content,
        is_error: r.isError ?? false,
      })),
    });

    return this.call(request, messages);
  }

  private async call(
    request: LlmRequest,
    messages: Anthropic.MessageParam[],
  ): Promise<LlmResponse> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException('ANTHROPIC_API_KEY is not configured on this server.');
    }

    try {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.3,
        // ה-system prompt וההגדרות של הכלים זהים בכל קריאה בשיחה,
        // והם ~1,400 טוקנים. בלי caching הם נשלחים ומחויבים מחדש
        // בכל סבב tool-use — וסבב אחד בשיחת onboarding יכול להיות
        // חמש קריאות.
        //
        // `cache_control` על האיבר האחרון מסמן את כל מה שלפניו
        // כקידומת הניתנת לשמירה. קריאה ממטמון מחויבת בשבריר
        // ממחיר קלט רגיל.
        ...(request.system
          ? {
              system: [
                { type: 'text' as const, text: request.system, cache_control: { type: 'ephemeral' as const } },
              ],
            }
          : {}),
        ...(request.tools?.length
          ? {
              tools: request.tools.map((t, i) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters as Anthropic.Tool.InputSchema,
                // רק על האחרון: נקודת עצירה אחת מכסה את כל ההגדרות.
                ...(i === request.tools!.length - 1
                  ? { cache_control: { type: 'ephemeral' as const } }
                  : {}),
              })),
            }
          : {}),
        messages,
      });

      const toolCalls: LlmToolCall[] = res.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));

      return {
        text: res.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim(),
        toolCalls,
        stopReason:
          res.stop_reason === 'tool_use'
            ? 'tool_use'
            : res.stop_reason === 'max_tokens'
              ? 'max_tokens'
              : res.stop_reason === 'end_turn'
                ? 'end'
                : 'other',
        usage: {
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
          cacheCreationTokens: res.usage.cache_creation_input_tokens ?? 0,
        },
        model: this.model,
      };
    } catch (err) {
      this.logger.error({ err, purpose: request.purpose }, 'Anthropic call failed');
      throw err;
    }
  }
}

const toAnthropicMessage = (m: { role: 'user' | 'assistant'; content: string }): Anthropic.MessageParam => ({
  role: m.role,
  content: m.content,
});
