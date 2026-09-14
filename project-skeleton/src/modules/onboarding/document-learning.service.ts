import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma, type OnboardingDocumentType } from '@prisma/client';
import { z } from 'zod';

import { assertLlmConfigured } from '../../common/llm-availability';
import { PrismaService } from '../../database/prisma.service';
import type { AppEnv } from '../../config/env.schema';
import { extractTextFromPdf, PdfParseTimeoutError } from './pdf-text.util';
import type { UploadKind } from './upload-validation.util';

// ============================================================
// "הלמידה" מהמסמכים שהעסק מעלה (הצעות מחיר + הזמנות חומרים).
// המטרה: לחלץ שורות פריטים+מחירים ממסמך free-form.
//
// מודל עסקי: זו הערכה **גסה** בכוונה — ממוצע כולל של הצעות מול
// הזמנות חומרים, לא matching פריט-מול-פריט. נקודת התחלה למנהל
// לעיין בה, לא מספר סופי.
// ============================================================

/** תקרת מסמכים לכל סוג בסשן. ה-endpoint אנונימי — בלי תקרה זו העלאה בלתי מוגבלת. */
const MAX_DOCUMENTS_PER_TYPE = 10;

const lineItemsResultSchema = z.object({
  lineItems: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        amount: z.number().finite(),
      }),
    )
    .max(500),
  totalAmount: z.number().finite().nullable(),
});

export type LineItemsResult = z.infer<typeof lineItemsResultSchema>;

const SYSTEM_PROMPT = `אתה מסייע לחלץ שורות פריטים ומחירים ממסמך עסקי (הצעת מחיר או הזמנת חומרים) בעברית.

חוקים קשיחים:
1. החזר אך ורק JSON תקין - בלי טקסט נוסף, בלי הסברים, בלי markdown code fences.
2. אם אין מבנה ברור של שורות פריטים במסמך, החזר lineItems ריק ו-totalAmount null - אל תמציא נתונים.
3. totalAmount הוא הסכום הכולל של המסמך אם מופיע בבירור (למשל "סה"כ לתשלום"), אחרת null.

מבנה הפלט (JSON בלבד):
{
  "lineItems": [{ "description": string, "amount": number }],
  "totalAmount": number | null
}`;

@Injectable()
export class DocumentLearningService {
  private readonly logger = new Logger(DocumentLearningService.name);
  private readonly client: Anthropic;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxInputChars: number;
  private readonly maxLlmCalls: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {
    this.apiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
    this.client = new Anthropic({ apiKey: this.apiKey });
    this.model = this.config.get('ANTHROPIC_EXTRACTION_MODEL', { infer: true });
    this.maxInputChars = this.config.get('LLM_MAX_INPUT_CHARS', { infer: true });
    this.maxLlmCalls = this.config.get('ONBOARDING_MAX_LLM_CALLS_PER_SESSION', { infer: true });
  }

  async processUploadedDocument(
    sessionId: string,
    docType: OnboardingDocumentType,
    file: { originalname: string; buffer: Buffer; kind: UploadKind; sizeBytes: number },
  ) {
    assertLlmConfigured(this.apiKey, 'Document learning');
    const existing = await this.prisma.untenanted.onboardingDocument.count({
      where: { sessionId, docType },
    });
    if (existing >= MAX_DOCUMENTS_PER_TYPE) {
      throw new BadRequestException(
        `At most ${MAX_DOCUMENTS_PER_TYPE} ${docType} documents can be uploaded per session`,
      );
    }

    // גם החילוץ הזה הוא קריאת LLM על חשבון המפעיל — הוא נספר מול
    // אותה תקרה כמו השיחה עצמה (C19).
    const reserved = await this.prisma.untenanted.onboardingSession.updateMany({
      where: { id: sessionId, llmCallCount: { lt: this.maxLlmCalls } },
      data: { llmCallCount: { increment: 1 } },
    });
    if (reserved.count === 0) {
      throw new HttpException(
        'This onboarding session has reached its LLM call limit',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let text: string;
    try {
      text =
        file.kind === 'pdf' ? await extractTextFromPdf(file.buffer) : file.buffer.toString('utf8');
    } catch (err: unknown) {
      if (err instanceof PdfParseTimeoutError) {
        throw new BadRequestException('PDF is too complex to parse within the allowed time');
      }
      this.logger.warn({ err, sessionId }, 'PDF text extraction failed');
      throw new BadRequestException('Could not read text from the uploaded document');
    }

    const extraction = await this.extractLineItems(text);

    return this.prisma.untenanted.onboardingDocument.create({
      data: {
        sessionId,
        docType,
        originalName: file.originalname.slice(0, 255),
        sizeBytes: file.sizeBytes,
        extractedText: text.slice(0, 20_000),
        extractedLineItems: extraction.lineItems,
        // Decimal ולא float: הסכום הזה נכנס לחישוב כספי בהמשך.
        totalAmount:
          extraction.totalAmount === null
            ? null
            : new Prisma.Decimal(extraction.totalAmount.toFixed(2)),
      },
      select: { id: true, docType: true, originalName: true, sizeBytes: true, createdAt: true },
    });
  }

  private async extractLineItems(text: string): Promise<LineItemsResult> {
    if (!text.trim()) {
      return { lineItems: [], totalAmount: null };
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `תוכן המסמך:\n\n${text.slice(0, this.maxInputChars)}` },
        ],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        return { lineItems: [], totalAmount: null };
      }

      const cleaned = textBlock.text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '');
      const result = lineItemsResultSchema.safeParse(JSON.parse(cleaned) as unknown);
      if (!result.success) {
        this.logger.warn(
          { issues: result.error.issues },
          'Document extraction did not match schema',
        );
        return { lineItems: [], totalAmount: null };
      }
      return result.data;
    } catch (err: unknown) {
      // חילוץ שנכשל אינו מפיל את ההעלאה: המסמך נשמר בלי שורות, והמנהל
      // רואה שאין ממנו תובנה. הוא כן נרשם — `catch` שקט אסור.
      this.logger.error({ err }, 'Document line-item extraction failed');
      return { lineItems: [], totalAmount: null };
    }
  }

  /**
   * הערכה גסה — יחס בין ממוצע הצעות המחיר לממוצע הזמנות החומרים.
   *
   * `totalAmount` הוא עכשיו `Decimal?` ולא `Json`. הבדיקה הישנה
   * `typeof d.totalAmount === 'number'` הייתה מסננת **כל** מסמך:
   * Prisma מחזיר מופע `Decimal`, ש-`typeof` שלו הוא `'object'`.
   * התוצאה הייתה "אין מספיק מסמכים" תמידי, בלי שום סימן לתקלה.
   */
  async computeSuggestedMarkup(sessionId: string): Promise<{
    avgQuoteTotal: number | null;
    avgMaterialOrderTotal: number | null;
    suggestedMarkupPercent: number | null;
    note: string;
  }> {
    const documents = await this.prisma.untenanted.onboardingDocument.findMany({
      where: { sessionId, totalAmount: { not: null } },
      select: { docType: true, totalAmount: true },
    });

    const totalsFor = (docType: OnboardingDocumentType): Prisma.Decimal[] =>
      documents
        .filter((d) => d.docType === docType)
        .map((d) => d.totalAmount)
        .filter((v): v is Prisma.Decimal => v !== null);

    // הממוצע מחושב ב-Decimal; המרה ל-number נעשית רק בגבול ה-JSON,
    // אחרי שהחלוקה כבר בוצעה. ראו conventions#4.
    const avg = (values: Prisma.Decimal[]): Prisma.Decimal | null =>
      values.length
        ? values.reduce((sum, v) => sum.add(v), new Prisma.Decimal(0)).div(values.length)
        : null;

    const quoteAvg = avg(totalsFor('QUOTE'));
    const materialAvg = avg(totalsFor('MATERIAL_ORDER'));

    const avgQuoteTotal = quoteAvg ? quoteAvg.toDecimalPlaces(2).toNumber() : null;
    const avgMaterialOrderTotal = materialAvg ? materialAvg.toDecimalPlaces(2).toNumber() : null;

    if (!quoteAvg || !materialAvg || materialAvg.isZero()) {
      return {
        avgQuoteTotal,
        avgMaterialOrderTotal,
        suggestedMarkupPercent: null,
        note: 'אין מספיק מסמכים עם סכום כולל מזוהה משני הסוגים כדי לחשב הערכה - זו הערכה גסה בלבד, יש להשלים ידנית',
      };
    }

    const suggestedMarkupPercent = quoteAvg
      .div(materialAvg)
      .minus(1)
      .mul(100)
      .toDecimalPlaces(0)
      .toNumber();

    return {
      avgQuoteTotal,
      avgMaterialOrderTotal,
      suggestedMarkupPercent,
      note: 'הערכה גסה מבוססת יחס ממוצעים כולל, לא התאמת פריט-מול-פריט - יש לבדוק ידנית לפני הסתמכות',
    };
  }
}
