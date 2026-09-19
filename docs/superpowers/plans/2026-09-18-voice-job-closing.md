# סגירת עבודה בהודעה קולית — תוכנית ביצוע

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** טכנאי מקליט עד 90 שניות בעברית במסך הסגירה, ומקבל צ'קליסט ממולא (קודי מחיר, מק"טים, כמויות) שהוא בודק ומתקן לפני סגירה רגילה.

**Architecture:** הדפדפן מקודד WAV 16kHz מונו ומעלה ל-`POST /v1/tasks/:id/voice-draft`. השרת מאמת את הקובץ, בודק שהמשימה שייכת לטכנאי, ושולח קריאה **אחת** ל-Gemini עם האודיו, המחירון, המלאי והצ'קליסט הנוכחי. התשובה (JSON) מאומתת ב-zod ומתואמת מול הקודים האמיתיים של העסק. **הטיוטה מוחזרת — שום דבר לא נסגר ולא נשמר**, וההקלטה נזרקת. הסגירה עצמה נשארת ב-`POST /tasks/:id/close` הקיים.

**Tech Stack:** NestJS 11, Prisma 6, zod, Jest (שרת) · React 19, Vite 7, TanStack Query, Vitest (אפליקציית הטכנאים `frontend-pwa`) · Gemini API (`inlineData`) · Caddy.

**Spec:** [docs/40-growth-roadmap.md — שלב 1](../../40-growth-roadmap.md#שלב-1--סגירת-עבודה-בהודעה-קולית) · מחקר: [docs/research/2026-09-growth-features.md — חלק 2](../../research/2026-09-growth-features.md#part-2)

## Global Constraints

- פורמט האודיו: **WAV, PCM 16-bit, מונו, 16,000Hz**. שום פורמט אחר לא מתקבל בשרת.
- אורך מקסימלי: **90 שניות** בלקוח (עצירה אוטומטית), **95 שניות** בשרת (מרווח ל-header). גודל קובץ מקסימלי: **3,500,000 בתים**.
- **ההקלטה לא נשמרת** — לא בדיסק, לא ב-DB, לא בלוג. מעובדת בזיכרון ונזרקת.
- **אין זיהוי דובר**, אין שמירת מאפייני קול (תיקון 13 — מידע ביומטרי).
- **שום דבר לא נסגר אוטומטית.** הטיוטה מוצגת לטכנאי לעריכה; הסגירה היא הפעולה הקיימת.
- טכנאי (`FIELD`) רשאי לבקש טיוטה **רק למשימה שהוקצתה לו**. אחרת 404 (לא 403 — לא לחשוף קיום).
- ספק LLM שאינו תומך באודיו → **503** עם הודעה מפורשת, לא קריסה.
- כסף וקודים: קוד מחיר או מק"ט שאינם קיימים אצל העסק **לעולם** לא נכנסים לצ'קליסט. הם עוברים ל-`unrecognized`.
- הקוד והמזהים באנגלית; הערות בקוד בעברית, רק כשהן מסבירות *למה* (סגנון הריפו).
- כל נתיב חדש חייב `@Roles`/`@AnyRole`. `src/common/guards/route-policies.spec.ts` נכשל אחרת.

## מבנה קבצים

**שרת (`project-skeleton/`)**

| קובץ | אחריות |
|---|---|
| `src/llm/llm.types.ts` (שינוי) | `LlmAttachment`, `attachments` ב-`LlmMessage`, `responseFormat` ב-`LlmRequest`, `supportsAudioInput` ב-`LlmProvider` |
| `src/llm/gemini.provider.ts` (שינוי) | תרגום attachments ל-`inlineData`, `responseMimeType` |
| `src/llm/gemini.provider.spec.ts` (חדש) | בדיקות תרגום הבקשה |
| `src/llm/anthropic.provider.ts` (שינוי) | `supportsAudioInput = false` |
| `src/llm/metered-llm.provider.ts` (שינוי) | העברת `supportsAudioInput` |
| `src/modules/voice-report/wav.util.ts` (חדש) | אימות WAV ופענוח header |
| `src/modules/voice-report/voice-report.schema.ts` (חדש) | סכמת zod לתשובת המודל + תיאום מול קודים |
| `src/modules/voice-report/voice-report.prompt.ts` (חדש) | הנחיית מערכת, מילון מונחים, בניית הקשר |
| `src/modules/voice-report/voice-report.service.ts` (חדש) | תזמור: הרשאה → הקשר → LLM → אימות |
| `src/modules/voice-report/voice-report.controller.ts` (חדש) | multipart, מגבלות, throttle |
| `src/modules/voice-report/voice-report.module.ts` (חדש) | רישום |
| `scripts/eval-voice-notes.ts` (חדש) | מבחן דיוק על הקלטות אמיתיות |

**אפליקציית טכנאים (`project-skeleton/frontend-pwa/`)**

| קובץ | אחריות |
|---|---|
| `src/features/voice/wav-encoder.ts` (חדש) | פונקציה טהורה: Float32 בקצב כלשהו → WAV 16kHz מונו |
| `src/features/voice/wav-encoder.test.ts` (חדש) | בדיקות מקודד |
| `src/features/voice/use-voice-recorder.ts` (חדש) | hook: מיקרופון → AudioWorklet → מקודד, עצירה ב-90 שניות |
| `src/features/voice/voice-draft.ts` (חדש) | סכמת התשובה + מיזוג טיוטה לצ'קליסט (טהור) |
| `src/features/voice/voice-draft.test.ts` (חדש) | בדיקות מיזוג |
| `src/features/voice/voice-note-panel.tsx` (חדש) | UI: הקלטה, שליחה, הצגת טיוטה |
| `src/features/jobs/close-job-dialog.tsx` (שינוי) | שילוב הפאנל |
| `src/lib/api.ts` (שינוי) | תמיכה ב-`FormData` ב-`send` |
| `vite.config.ts` (שינוי) | `base: '/field/'`, scope/start_url, בדיקות |
| `.env.selfhost` (חדש) | `VITE_API_URL=` ריק, `VITE_TENANT` |

**פריסה**

| קובץ | אחריות |
|---|---|
| `deploy/host-caddy-web.snippet` (שינוי) | `handle /field/*` |
| `scripts/deploy-field.sh` (חדש) | בנייה והעלאה אטומית ל-`/var/www/craftmind-field` |

---

### Task 1: קלט אודיו בשכבת ה-LLM

**Files:**
- Modify: `src/llm/llm.types.ts`
- Modify: `src/llm/gemini.provider.ts:40-60` (טיפוסים), `:125-131` (`toContents`), `:177-190` (`callOnce`)
- Modify: `src/llm/anthropic.provider.ts:23` , `src/llm/metered-llm.provider.ts:30-38`
- Test: `src/llm/gemini.provider.spec.ts` (חדש)

**Interfaces:**
- Produces: `interface LlmAttachment { mimeType: string; data: Buffer }` · `LlmMessage.attachments?: LlmAttachment[]` · `LlmRequest.responseFormat?: 'text' | 'json'` · `LlmProvider.supportsAudioInput: boolean`

- [ ] **Step 1: כתוב בדיקה שנכשלת**

`src/llm/gemini.provider.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';

import type { AppEnv } from '../config/env.schema';

import { GeminiProvider } from './gemini.provider';

/**
 * תרגום בקשה לפורמט של Gemini.
 *
 * האודיו חייב להגיע כ-inlineData לפני הטקסט באותו תור. אם הוא נופל
 * בדרך, המודל עונה על ההנחיה בלי לשמוע כלום — ומחזיר צ'קליסט מומצא
 * שנראה סביר לחלוטין.
 */
describe('GeminiProvider request mapping', () => {
  const config = new ConfigService({ GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-test' });
  let provider: GeminiProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new GeminiProvider(config as unknown as ConfigService<AppEnv, true>);
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const sentBody = () => JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body);

  it('declares audio support', () => {
    expect(provider.supportsAudioInput).toBe(true);
  });

  it('sends an attachment as inlineData, before the text, in the same turn', async () => {
    const audio = Buffer.from('RIFF....WAVE');
    await provider.complete({
      purpose: 'test',
      messages: [{ role: 'user', content: 'transcribe', attachments: [{ mimeType: 'audio/wav', data: audio }] }],
    });

    const parts = sentBody().contents[0].parts;
    expect(parts).toEqual([
      { inlineData: { mimeType: 'audio/wav', data: audio.toString('base64') } },
      { text: 'transcribe' },
    ]);
  });

  it('asks for JSON when responseFormat is json', async () => {
    await provider.complete({ purpose: 'test', responseFormat: 'json', messages: [{ role: 'user', content: 'x' }] });
    expect(sentBody().generationConfig.responseMimeType).toBe('application/json');
  });

  it('leaves the response format alone otherwise', async () => {
    await provider.complete({ purpose: 'test', messages: [{ role: 'user', content: 'x' }] });
    expect(sentBody().generationConfig.responseMimeType).toBeUndefined();
  });
});
```

- [ ] **Step 2: הרץ ווודא כישלון**

Run: `npx jest --config test/jest-unit.config.ts src/llm/gemini.provider.spec.ts`
Expected: FAIL — `supportsAudioInput` undefined, ו-TS error על `attachments`.

- [ ] **Step 3: הרחב את החוזה**

ב-`src/llm/llm.types.ts`, החלף את `LlmMessage` והוסף את `LlmAttachment`:

```ts
/**
 * קובץ בינארי שמצורף לתור של המשתמש — כרגע אודיו בלבד.
 *
 * Buffer ולא base64: הקוד העסקי לא צריך לדעת איך כל ספק מקודד.
 */
export interface LlmAttachment {
  mimeType: string;
  data: Buffer;
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: LlmAttachment[];
}
```

ב-`LlmRequest`, אחרי `temperature`:

```ts
  /** 'json' מבקש מהספק להחזיר JSON תקני בלבד, כשהוא תומך בכך. */
  responseFormat?: 'text' | 'json';
```

ב-`LlmProvider`, אחרי `isConfigured`:

```ts
  /**
   * האם הספק מקבל אודיו כקלט. נבדק *לפני* הקריאה, כדי להחזיר 503
   * מפורש במקום שגיאת 400 סתומה מהספק.
   */
  readonly supportsAudioInput: boolean;
```

- [ ] **Step 4: ממש ב-Gemini**

ב-`src/llm/gemini.provider.ts`, הוסף ל-`GeminiPart`:

```ts
  inlineData?: { mimeType: string; data: string };
```

הוסף שדה במחלקה, ליד `name`:

```ts
  readonly supportsAudioInput = true;
```

החלף את `toContents`:

```ts
  private toContents(request: LlmRequest): GeminiContent[] {
    return request.messages.map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      // האודיו לפני הטקסט: ההנחיה מתייחסת אליו ("תמלל את ההקלטה").
      parts: [
        ...(m.attachments ?? []).map((a) => ({
          inlineData: { mimeType: a.mimeType, data: a.data.toString('base64') },
        })),
        { text: m.content },
      ],
    }));
  }
```

ב-`callOnce`, החלף את בלוק `generationConfig`:

```ts
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.3,
        ...(request.responseFormat === 'json' && { responseMimeType: 'application/json' }),
      },
```

- [ ] **Step 5: Anthropic ו-Metered**

ב-`src/llm/anthropic.provider.ts`, ליד `readonly name = 'anthropic';`:

```ts
  // ה-API של Claude אינו מקבל אודיו. הודעות קוליות דורשות Gemini.
  readonly supportsAudioInput = false;
```

ב-`src/llm/metered-llm.provider.ts`, אחרי ה-getter של `isConfigured`:

```ts
  get supportsAudioInput(): boolean {
    return this.inner.supportsAudioInput;
  }
```

- [ ] **Step 6: הרץ ווודא הצלחה**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest --config test/jest-unit.config.ts src/llm`
Expected: PASS, כולל `llm-pricing.spec.ts` הקיים.

- [ ] **Step 7: Commit**

```bash
git add src/llm
git commit -m "Let the LLM layer carry audio, and say which providers can hear it"
```

---

### Task 2: אימות WAV

**Files:**
- Create: `src/modules/voice-report/wav.util.ts`
- Test: `src/modules/voice-report/wav.util.spec.ts`

**Interfaces:**
- Produces: `parseWav(buf: Buffer): WavInfo` כש-`WavInfo = { sampleRate: number; channels: number; bitsPerSample: number; durationSeconds: number }`; זורק `BadRequestException` על כל חריגה. קבועים: `VOICE_SAMPLE_RATE = 16_000`, `MAX_VOICE_SECONDS = 95`, `MAX_VOICE_BYTES = 3_500_000`.

- [ ] **Step 1: כתוב בדיקה שנכשלת**

`src/modules/voice-report/wav.util.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

import { MAX_VOICE_SECONDS, parseWav } from './wav.util';

/**
 * ה-mimetype בבקשה הוא טענה של הלקוח, לא עובדה. הקובץ נבדק לפי התוכן
 * שלו — אחרת כל קובץ שמוצהר כ-audio/wav מגיע ל-LLM ומחויב לפי אורכו.
 */
function wav({ rate = 16_000, channels = 1, bits = 16, seconds = 1 } = {}): Buffer {
  const dataLen = Math.round(rate * seconds) * channels * (bits / 8);
  const b = Buffer.alloc(44 + dataLen);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + dataLen, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * (bits / 8), 28);
  b.writeUInt16LE(channels * (bits / 8), 32);
  b.writeUInt16LE(bits, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(dataLen, 40);
  return b;
}

describe('parseWav', () => {
  it('reads a valid 16kHz mono clip', () => {
    expect(parseWav(wav({ seconds: 2 }))).toEqual({
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 16,
      durationSeconds: 2,
    });
  });

  it.each([
    ['not RIFF at all', Buffer.from('%PDF-1.7 not audio at all, just padding bytes....')],
    ['too short to hold a header', Buffer.from('RIFF')],
  ])('rejects %s', (_label, buf) => {
    expect(() => parseWav(buf)).toThrow(BadRequestException);
  });

  it('rejects stereo', () => {
    expect(() => parseWav(wav({ channels: 2 }))).toThrow(/mono/);
  });

  it('rejects another sample rate', () => {
    expect(() => parseWav(wav({ rate: 44_100 }))).toThrow(/16000/);
  });

  it('rejects a clip over the limit', () => {
    expect(() => parseWav(wav({ seconds: MAX_VOICE_SECONDS + 1 }))).toThrow(/long/);
  });

  it('rejects a header that claims more data than the file holds', () => {
    // header שמצהיר על 90 שניות בקובץ של שנייה — המודל היה מחויב לפי
    // מה שהוא מקבל, אבל האורך המוצהר הוא מה שהמגבלה בודקת.
    const b = wav({ seconds: 1 });
    b.writeUInt32LE(16_000 * 2 * 90, 40);
    expect(() => parseWav(b)).toThrow(/truncated/);
  });
});
```

- [ ] **Step 2: הרץ ווודא כישלון**

Run: `npx jest --config test/jest-unit.config.ts src/modules/voice-report/wav.util.spec.ts`
Expected: FAIL — `Cannot find module './wav.util'`.

- [ ] **Step 3: ממש**

`src/modules/voice-report/wav.util.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

export const VOICE_SAMPLE_RATE = 16_000;
/** הלקוח עוצר ב-90; המרווח מכסה header ועיגול. */
export const MAX_VOICE_SECONDS = 95;
/** 95 שניות × 16,000 × 2 בתים ≈ 3.04MB, ועוד header. */
export const MAX_VOICE_BYTES = 3_500_000;

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationSeconds: number;
}

/**
 * מאמת שהקובץ הוא בדיוק מה שהלקוח מייצר: WAV PCM, 16-bit, מונו, 16kHz.
 *
 * צר בכוונה. כל פורמט נוסף הוא עוד מסלול לבדוק, ואין לו צרכן —
 * אפליקציית הטכנאים מייצרת רק את זה.
 */
export function parseWav(buf: Buffer): WavInfo {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new BadRequestException('Voice note must be a WAV file');
  }
  if (buf.toString('ascii', 12, 16) !== 'fmt ' || buf.readUInt16LE(20) !== 1) {
    throw new BadRequestException('Voice note must be uncompressed PCM');
  }

  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  if (channels !== 1) throw new BadRequestException('Voice note must be mono');
  if (sampleRate !== VOICE_SAMPLE_RATE) {
    throw new BadRequestException(`Voice note must be sampled at ${VOICE_SAMPLE_RATE}Hz`);
  }
  if (bitsPerSample !== 16) throw new BadRequestException('Voice note must be 16-bit');
  if (buf.toString('ascii', 36, 40) !== 'data') throw new BadRequestException('WAV data chunk missing');

  const dataLen = buf.readUInt32LE(40);
  if (44 + dataLen > buf.length) throw new BadRequestException('WAV file is truncated');

  const durationSeconds = dataLen / (sampleRate * channels * (bitsPerSample / 8));
  if (durationSeconds > MAX_VOICE_SECONDS) {
    throw new BadRequestException(`Voice note is too long (max ${MAX_VOICE_SECONDS}s)`);
  }

  return { sampleRate, channels, bitsPerSample, durationSeconds };
}
```

- [ ] **Step 4: הרץ ווודא הצלחה**

Run: `npx jest --config test/jest-unit.config.ts src/modules/voice-report/wav.util.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/voice-report/wav.util.ts src/modules/voice-report/wav.util.spec.ts
git commit -m "Validate voice notes by their bytes, not by what the client claims"
```

---

### Task 3: סכמת התשובה ותיאום מול קודי העסק

**Files:**
- Create: `src/modules/voice-report/voice-report.schema.ts`
- Test: `src/modules/voice-report/voice-report.schema.spec.ts`

**Interfaces:**
- Produces:
  - `voiceReportSchema` (zod) ו-`type VoiceReportRaw`
  - `interface VoiceDraftItem { label: string; done: boolean; priceCode: string | null; sku: string | null; qty: number | null }`
  - `interface VoiceDraft { transcript: string; items: VoiceDraftItem[]; notes: string | null; unrecognized: string[] }`
  - `reconcile(raw: VoiceReportRaw, known: { priceCodes: Set<string>; skus: Set<string> }): VoiceDraft`
  - `parseModelJson(text: string): unknown` — זורק `Error` על JSON לא תקין

- [ ] **Step 1: כתוב בדיקה שנכשלת**

`src/modules/voice-report/voice-report.schema.spec.ts`:

```ts
import { parseModelJson, reconcile, voiceReportSchema } from './voice-report.schema';

/**
 * קוד מחיר שהמודל המציא הוא הסכנה הכי שקטה כאן: הוא נראה תקין,
 * עובר לצ'קליסט, ובחשבונית פשוט לא מתומחר. לכן כל קוד נבדק מול
 * המחירון האמיתי, ומה שלא נמצא עובר ל-unrecognized — גלוי לטכנאי.
 */
describe('voice report schema', () => {
  const known = { priceCodes: new Set(['AC-FIX', 'GAS-R32']), skus: new Set(['CAP-35UF']) };

  const raw = (items: unknown[]) =>
    voiceReportSchema.parse({ transcript: 'החלפתי קבל', items, notes: null, unrecognized: [] });

  it('keeps a known price code and SKU', () => {
    const draft = reconcile(
      raw([{ label: 'החלפת קבל', done: true, priceCode: 'AC-FIX', sku: 'CAP-35UF', qty: 1 }]),
      known,
    );
    expect(draft.items).toEqual([
      { label: 'החלפת קבל', done: true, priceCode: 'AC-FIX', sku: 'CAP-35UF', qty: 1 },
    ]);
    expect(draft.unrecognized).toEqual([]);
  });

  it('strips an invented price code and reports it', () => {
    const draft = reconcile(raw([{ label: 'ניקוי', done: true, priceCode: 'CLEAN-99' }]), known);
    expect(draft.items[0]?.priceCode).toBeNull();
    expect(draft.unrecognized).toContain('CLEAN-99');
  });

  it('strips an unknown SKU and drops its quantity with it', () => {
    // כמות בלי מק"ט אינה מנכה כלום — והייתה מטעה את הטכנאי לחשוב שכן.
    const draft = reconcile(raw([{ label: 'x', done: true, sku: 'NOPE', qty: 3 }]), known);
    expect(draft.items[0]).toMatchObject({ sku: null, qty: null });
    expect(draft.unrecognized).toContain('NOPE');
  });

  it('matches codes case-insensitively, returning the canonical spelling', () => {
    const draft = reconcile(raw([{ label: 'x', done: true, priceCode: 'gas-r32' }]), known);
    expect(draft.items[0]?.priceCode).toBe('GAS-R32');
  });

  it.each([
    ['a negative quantity', { label: 'x', done: true, sku: 'CAP-35UF', qty: -2 }],
    ['a fractional quantity', { label: 'x', done: true, sku: 'CAP-35UF', qty: 1.5 }],
    ['an empty label', { label: '', done: true }],
  ])('rejects %s', (_l, item) => {
    expect(() => raw([item])).toThrow();
  });

  it('caps the number of items', () => {
    expect(() => raw(Array.from({ length: 51 }, () => ({ label: 'x', done: true })))).toThrow();
  });

  describe('parseModelJson', () => {
    it('reads plain JSON', () => {
      expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    });
    it('reads JSON wrapped in a markdown fence', () => {
      expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });
    it('throws on prose', () => {
      expect(() => parseModelJson('סליחה, לא הבנתי')).toThrow();
    });
  });
});
```

- [ ] **Step 2: הרץ ווודא כישלון**

Run: `npx jest --config test/jest-unit.config.ts src/modules/voice-report/voice-report.schema.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: ממש**

`src/modules/voice-report/voice-report.schema.ts`:

```ts
import { z } from 'zod';

const code = z.string().trim().min(1).max(64);

export const voiceReportSchema = z.object({
  transcript: z.string().max(4000),
  items: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(200),
        done: z.boolean(),
        priceCode: code.nullish(),
        sku: code.nullish(),
        qty: z.number().int().min(1).max(10_000).nullish(),
      }),
    )
    .max(50),
  notes: z.string().max(2000).nullish(),
  unrecognized: z.array(z.string().max(200)).max(20).default([]),
});

export type VoiceReportRaw = z.infer<typeof voiceReportSchema>;

export interface VoiceDraftItem {
  label: string;
  done: boolean;
  priceCode: string | null;
  sku: string | null;
  qty: number | null;
}

export interface VoiceDraft {
  transcript: string;
  items: VoiceDraftItem[];
  notes: string | null;
  unrecognized: string[];
}

/**
 * גם עם responseMimeType=json, מודלים עוטפים לפעמים ב-```json. מסירים
 * את העטיפה ולא יותר — אין "תיקון" של JSON שבור.
 */
export function parseModelJson(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(stripped);
}

export function reconcile(
  raw: VoiceReportRaw,
  known: { priceCodes: Set<string>; skus: Set<string> },
): VoiceDraft {
  const canonical = (set: Set<string>) => new Map([...set].map((c) => [c.toLowerCase(), c]));
  const priceByLower = canonical(known.priceCodes);
  const skuByLower = canonical(known.skus);
  const unrecognized = new Set(raw.unrecognized);

  const items = raw.items.map((item): VoiceDraftItem => {
    const priceCode = item.priceCode ? (priceByLower.get(item.priceCode.toLowerCase()) ?? null) : null;
    if (item.priceCode && !priceCode) unrecognized.add(item.priceCode);

    const sku = item.sku ? (skuByLower.get(item.sku.toLowerCase()) ?? null) : null;
    if (item.sku && !sku) unrecognized.add(item.sku);

    return { label: item.label, done: item.done, priceCode, sku, qty: sku ? (item.qty ?? null) : null };
  });

  return {
    transcript: raw.transcript,
    items,
    notes: raw.notes ?? null,
    unrecognized: [...unrecognized].slice(0, 20),
  };
}
```

- [ ] **Step 4: הרץ ווודא הצלחה**

Run: `npx jest --config test/jest-unit.config.ts src/modules/voice-report/voice-report.schema.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/voice-report/voice-report.schema.ts src/modules/voice-report/voice-report.schema.spec.ts
git commit -m "Keep invented price codes and SKUs out of a voice-note draft"
```

---

### Task 4: שירות הטיוטה — הרשאה, הקשר וקריאה ל-LLM

**Files:**
- Create: `src/modules/voice-report/voice-report.prompt.ts`
- Create: `src/modules/voice-report/voice-report.service.ts`
- Test: `src/modules/voice-report/voice-report.service.spec.ts`

**Interfaces:**
- Consumes: `LlmProvider` (Task 1), `parseWav` (Task 2), `voiceReportSchema`/`reconcile`/`parseModelJson` (Task 3), `PrismaService.forTenant`.
- Produces: `VoiceReportService.draft(tenantId: string, taskId: string, actor: { id: string; role: UserRole }, wav: Buffer): Promise<VoiceDraft>`

- [ ] **Step 1: כתוב את ההנחיה**

`src/modules/voice-report/voice-report.prompt.ts`:

```ts
/**
 * מונחים שמודל כללי שומע לא נכון. הרשימה נכנסת להנחיה כדי שהמודל
 * יעדיף אותם כשהצליל קרוב. מורחבת לפי תוצאות מבחן הדיוק
 * (scripts/eval-voice-notes.ts) — לא לפי ניחוש.
 */
export const TRADE_GLOSSARY = [
  'קבל', 'מדחס', 'מאייד', 'מעבה', 'גז R32', 'גז R410A', 'מילוי גז', 'ואקום', 'דליפה',
  'צנרת נחושת', 'ניקוי פילטרים', 'ניקוי מאייד', 'לוח פיקוד', 'שלט', 'חיישן טמפרטורה',
  'מנוע מאוורר', 'משאבת ניקוז', 'צינור ניקוז', 'ממסר', 'כרטיס אלקטרוני', 'BTU', 'אינוורטר',
];

export const SYSTEM_PROMPT = `אתה מקבל הקלטה קולית קצרה של טכנאי מיזוג אוויר שמתאר עבודה שסיים.
המשימה: לתמלל ולהפיק צ'קליסט מובנה.

כללים:
- החזר JSON בלבד, בדיוק במבנה שמתואר בהודעת המשתמש.
- השתמש אך ורק בקודי מחיר ובמק"טים מהרשימות שקיבלת. אם הטכנאי מזכיר עבודה או חלק שאינם ברשימה — שים null בשדה הקוד, וכתוב את מה ששמעת ב-unrecognized.
- אל תמציא עבודות שלא נאמרו. אם לא ברור — השאר בחוץ וכתוב ב-notes.
- כמות רק אם נאמרה במפורש או ברורה מההקשר ("החלפתי קבל" = 1).
- אם ההקלטה ריקה, לא בעברית או לא קשורה לעבודה: transcript עם מה שנשמע, items ריק.`;

export function buildUserPrompt(ctx: {
  taskTitle: string;
  checklist: Array<{ label: string; priceCode?: string | null; sku?: string | null }>;
  priceList: Array<{ code: string; description: string }>;
  inventory: Array<{ sku: string; name: string }>;
}): string {
  const lines = (rows: string[]) => (rows.length ? rows.join('\n') : '(ריק)');
  return `משימה: ${ctx.taskTitle}

צ'קליסט נוכחי (אם הטכנאי מתאר פריט קיים — השתמש באותה תווית בדיוק):
${lines(ctx.checklist.map((c) => `- ${c.label}${c.priceCode ? ` [${c.priceCode}]` : ''}`))}

קודי מחיר מותרים:
${lines(ctx.priceList.map((p) => `- ${p.code}: ${p.description}`))}

מק"טים מותרים:
${lines(ctx.inventory.map((i) => `- ${i.sku}: ${i.name}`))}

מונחים מקצועיים שכדאי להעדיף כשהצליל קרוב: ${TRADE_GLOSSARY.join(', ')}

החזר JSON במבנה:
{"transcript": string, "items": [{"label": string, "done": boolean, "priceCode": string|null, "sku": string|null, "qty": number|null}], "notes": string|null, "unrecognized": string[]}`;
}
```

- [ ] **Step 2: כתוב בדיקה שנכשלת**

`src/modules/voice-report/voice-report.service.spec.ts`:

```ts
import { BadGatewayException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import type { LlmProvider, LlmRequest } from '../../llm/llm.types';

import { VoiceReportService } from './voice-report.service';

/**
 * השירות הזה מחזיק שלוש הבטחות: טכנאי לא נוגע במשימה של אחר, קוד
 * שהמודל המציא לא עובר, והקלטה לעולם לא נשמרת. כל אחת נבדקת כאן.
 */
const TENANT = '11111111-1111-1111-1111-111111111111';
const TASK = '22222222-2222-2222-2222-222222222222';
const TECH = { id: '33333333-3333-3333-3333-333333333333', role: UserRole.FIELD };
const OWNER = { id: '44444444-4444-4444-4444-444444444444', role: UserRole.OWNER };

function wav(seconds = 1): Buffer {
  const dataLen = 16_000 * 2 * seconds;
  const b = Buffer.alloc(44 + dataLen);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16_000, 24); b.writeUInt32LE(32_000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(dataLen, 40);
  return b;
}

describe('VoiceReportService', () => {
  let tx: {
    task: { findFirst: jest.Mock };
    priceListItem: { findMany: jest.Mock };
    inventoryItem: { findMany: jest.Mock };
  };
  let llm: jest.Mocked<Pick<LlmProvider, 'complete'>> & { supportsAudioInput: boolean };
  let service: VoiceReportService;

  const modelSays = (json: unknown) =>
    llm.complete.mockResolvedValue({
      text: JSON.stringify(json), toolCalls: [], stopReason: 'end', model: 'm',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

  beforeEach(() => {
    tx = {
      task: { findFirst: jest.fn().mockResolvedValue({ id: TASK, title: 'מזגן מטפטף', checklist: [] }) },
      priceListItem: { findMany: jest.fn().mockResolvedValue([{ code: 'AC-FIX', description: 'תיקון' }]) },
      inventoryItem: { findMany: jest.fn().mockResolvedValue([{ sku: 'CAP-35UF', name: 'קבל 35' }]) },
    };
    const prisma = { forTenant: jest.fn((_t: string, fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
    llm = { complete: jest.fn(), supportsAudioInput: true };
    service = new VoiceReportService(prisma, llm as unknown as LlmProvider);
    modelSays({ transcript: 'החלפתי קבל', items: [{ label: 'קבל', done: true, priceCode: 'AC-FIX', sku: 'CAP-35UF', qty: 1 }], notes: null, unrecognized: [] });
  });

  it('limits a technician to tasks assigned to them, in the query itself', async () => {
    await service.draft(TENANT, TASK, TECH, wav());
    expect(tx.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: TASK, tenantId: TENANT, assignedToUserId: TECH.id }),
      }),
    );
  });

  it('lets an owner draft for any task in the tenant', async () => {
    await service.draft(TENANT, TASK, OWNER, wav());
    const where = (tx.task.findFirst.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where;
    expect(where).not.toHaveProperty('assignedToUserId');
  });

  it('returns 404, not 403, for a task that is not theirs', async () => {
    tx.task.findFirst.mockResolvedValue(null);
    await expect(service.draft(TENANT, TASK, TECH, wav())).rejects.toBeInstanceOf(NotFoundException);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('refuses before spending anything when the provider cannot hear', async () => {
    llm.supportsAudioInput = false;
    await expect(service.draft(TENANT, TASK, TECH, wav())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('sends the audio as a WAV attachment and asks for JSON', async () => {
    const audio = wav();
    await service.draft(TENANT, TASK, TECH, audio);
    const req = llm.complete.mock.calls[0]![0] as LlmRequest;
    expect(req.responseFormat).toBe('json');
    expect(req.tenantId).toBe(TENANT);
    expect(req.purpose).toBe('voice_report.draft');
    expect(req.messages[0]?.attachments).toEqual([{ mimeType: 'audio/wav', data: audio }]);
  });

  it('puts only this tenant’s codes in the prompt', async () => {
    await service.draft(TENANT, TASK, TECH, wav());
    expect(tx.priceListItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, isActive: true } }),
    );
    const prompt = (llm.complete.mock.calls[0]![0] as LlmRequest).messages[0]!.content;
    expect(prompt).toContain('AC-FIX');
    expect(prompt).toContain('CAP-35UF');
  });

  it('reconciles the answer against the real codes', async () => {
    modelSays({ transcript: 't', items: [{ label: 'x', done: true, priceCode: 'INVENTED' }], notes: null, unrecognized: [] });
    const draft = await service.draft(TENANT, TASK, TECH, wav());
    expect(draft.items[0]?.priceCode).toBeNull();
    expect(draft.unrecognized).toContain('INVENTED');
  });

  it('turns an unusable model answer into 502, not a half-filled draft', async () => {
    llm.complete.mockResolvedValue({ text: 'לא הבנתי', toolCalls: [], stopReason: 'end', model: 'm', usage: { inputTokens: 1, outputTokens: 1 } });
    await expect(service.draft(TENANT, TASK, TECH, wav())).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects a bad file before touching the database', async () => {
    await expect(service.draft(TENANT, TASK, TECH, Buffer.from('nope'))).rejects.toThrow(/WAV/);
    expect(tx.task.findFirst).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: הרץ ווודא כישלון**

Run: `npx jest --config test/jest-unit.config.ts src/modules/voice-report/voice-report.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: ממש**

`src/modules/voice-report/voice-report.service.ts`:

```ts
import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TaskStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { LLM_PROVIDER, type LlmProvider } from '../../llm/llm.types';

import { buildUserPrompt, SYSTEM_PROMPT } from './voice-report.prompt';
import { parseModelJson, reconcile, voiceReportSchema, type VoiceDraft } from './voice-report.schema';
import { parseWav } from './wav.util';

/** מחירון של עסק שירות הוא עשרות שורות; התקרה מגינה על ההנחיה. */
const MAX_PRICE_ITEMS = 200;
const MAX_INVENTORY_ITEMS = 300;

@Injectable()
export class VoiceReportService {
  private readonly logger = new Logger(VoiceReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /**
   * מחזיר טיוטה בלבד. לא סוגר, לא שומר, ולא שומר את ההקלטה — היא
   * קיימת רק בזיכרון של הבקשה הזו.
   */
  async draft(
    tenantId: string,
    taskId: string,
    actor: { id: string; role: UserRole },
    wav: Buffer,
  ): Promise<VoiceDraft> {
    parseWav(wav);

    if (!this.llm.supportsAudioInput) {
      throw new ServiceUnavailableException(
        'Voice notes need an LLM provider with audio input (set LLM_PROVIDER=gemini).',
      );
    }

    const ctx = await this.prisma.forTenant(tenantId, async (tx) => {
      // ההגבלה לטכנאי בתוך ה-WHERE ולא בבדיקה אחרי הקריאה: כך אין
      // חלון שבו המשימה נקראה, ואין דרך להבחין בין "לא קיים" ל"לא שלך".
      const task = await tx.task.findFirst({
        where: {
          id: taskId,
          tenantId,
          status: { not: TaskStatus.CLOSED },
          ...(actor.role === UserRole.FIELD && { assignedToUserId: actor.id }),
        },
        select: { id: true, title: true, checklist: true },
      });
      if (!task) return null;

      const [priceList, inventory] = await Promise.all([
        tx.priceListItem.findMany({
          where: { tenantId, isActive: true },
          select: { code: true, description: true },
          orderBy: { code: 'asc' },
          take: MAX_PRICE_ITEMS,
        }),
        tx.inventoryItem.findMany({
          where: { tenantId, isActive: true },
          select: { sku: true, name: true },
          orderBy: { name: 'asc' },
          take: MAX_INVENTORY_ITEMS,
        }),
      ]);
      return { task, priceList, inventory };
    });

    if (!ctx) throw new NotFoundException('Task not found');

    const checklist = Array.isArray(ctx.task.checklist)
      ? (ctx.task.checklist as Array<{ label: string; priceCode?: string | null; sku?: string | null }>)
      : [];

    const response = await this.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt({ taskTitle: ctx.task.title, checklist, priceList: ctx.priceList, inventory: ctx.inventory }),
          attachments: [{ mimeType: 'audio/wav', data: wav }],
        },
      ],
      responseFormat: 'json',
      maxTokens: 2048,
      temperature: 0.1,
      purpose: 'voice_report.draft',
      tenantId,
    });

    let raw;
    try {
      raw = voiceReportSchema.parse(parseModelJson(response.text));
    } catch (err) {
      // לא מתעדים את התמלול: הוא תוכן של הקלטה, ואסור לו להגיע ללוג.
      this.logger.warn({ tenantId, taskId, err: (err as Error).message }, 'Unusable voice report from LLM');
      throw new BadGatewayException('Could not understand the voice note. Please try again or fill in manually.');
    }

    return reconcile(raw, {
      priceCodes: new Set(ctx.priceList.map((p) => p.code)),
      skus: new Set(ctx.inventory.map((i) => i.sku)),
    });
  }
}
```

- [ ] **Step 5: הרץ ווודא הצלחה**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest --config test/jest-unit.config.ts src/modules/voice-report`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/voice-report
git commit -m "Draft a job report from a voice note, scoped to the technician's own task"
```

---

### Task 5: הנתיב — `POST /v1/tasks/:id/voice-draft`

**Files:**
- Create: `src/modules/voice-report/voice-report.controller.ts`
- Create: `src/modules/voice-report/voice-report.module.ts`
- Modify: `src/app.module.ts` (import + רישום אחרי `PriceListModule`)

**Interfaces:**
- Consumes: `VoiceReportService.draft` (Task 4), `MAX_VOICE_BYTES` (Task 2)
- Produces: `POST /v1/tasks/:id/voice-draft`, multipart, שדה `audio`, תשובה `VoiceDraft`

- [ ] **Step 1: ממש את הבקר והמודול**

`src/modules/voice-report/voice-report.controller.ts`:

```ts
import {
  BadRequestException,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { AnyRole } from '../../common/decorators/roles.decorator';

import { VoiceReportService } from './voice-report.service';
import { MAX_VOICE_BYTES } from './wav.util';

@Controller('tasks')
export class VoiceReportController {
  constructor(private readonly voiceReport: VoiceReportService) {}

  // כל תפקיד — ההגבלה לטכנאי על המשימות שלו נאכפת בשירות, ב-WHERE.
  // throttle: כל בקשה עולה כסף ב-LLM; עשר בדקה מספיקות לטכנאי אמיתי.
  @AnyRole()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/voice-draft')
  @UseInterceptors(
    FileInterceptor('audio', {
      // memoryStorage (ברירת המחדל): ההקלטה לעולם לא נכתבת לדיסק.
      limits: { fileSize: MAX_VOICE_BYTES, files: 1, fields: 0, parts: 2 },
    }),
  )
  draft(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Missing "audio" file');
    return this.voiceReport.draft(req.tenantId!, id, { id: req.user!.id, role: req.user!.role }, file.buffer);
  }
}
```

`src/modules/voice-report/voice-report.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { VoiceReportController } from './voice-report.controller';
import { VoiceReportService } from './voice-report.service';

@Module({
  imports: [AuthModule],
  controllers: [VoiceReportController],
  providers: [VoiceReportService],
})
export class VoiceReportModule {}
```

ב-`src/app.module.ts`: הוסף `import { VoiceReportModule } from './modules/voice-report/voice-report.module';` ליד ה-import של `PriceListModule`, ו-`VoiceReportModule,` ברשימה אחרי `PriceListModule,`.

> אם `req.user.role` אינו מוקלד ב-`Express.Request`, בדוק את `src/types/express.d.ts` (או המקביל) — שם מוגדר `user`. אל תשתמש ב-`as any`.

- [ ] **Step 2: ודא שבדיקת המדיניות רואה את הנתיב**

ב-`src/common/guards/route-policies.spec.ts`, הוסף לבדיקה הראשונה:

```ts
    expect(routes.map((r) => r.route)).toContain('VoiceReportController.draft');
```

Run: `npx jest --config test/jest-unit.config.ts src/common/guards/route-policies.spec.ts`
Expected: PASS.

- [ ] **Step 3: בדיקה חיה מול שרת מקומי**

```bash
npm run build && PORT=3010 node dist/main &
sleep 10
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3010/v1/tasks/00000000-0000-0000-0000-000000000000/voice-draft -H "X-Tenant: ac-maintenance"
```

Expected: `401` (הנתיב קיים ודורש התחברות). עצור את השרת אחרי הבדיקה.

- [ ] **Step 4: הרץ את כל החבילה**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest --config test/jest-unit.config.ts && npx jest --config test/jest-integration.config.ts`
Expected: הכול עובר.

- [ ] **Step 5: Commit**

```bash
git add src/modules/voice-report src/app.module.ts src/common/guards/route-policies.spec.ts
git commit -m "Expose voice-note drafting at POST /tasks/:id/voice-draft"
```

---

### Task 6: מקודד WAV באפליקציית הטכנאים

**Files:**
- Modify: `frontend-pwa/package.json` (devDependencies + script)
- Modify: `frontend-pwa/vite.config.ts` (בלוק `test`)
- Create: `frontend-pwa/src/features/voice/wav-encoder.ts`
- Test: `frontend-pwa/src/features/voice/wav-encoder.test.ts`

**Interfaces:**
- Produces: `encodeWav(chunks: Float32Array[], inputRate: number): Blob` · `TARGET_RATE = 16_000`

- [ ] **Step 1: הוסף Vitest**

```bash
cd frontend-pwa && npm install -D vitest@^3.2.4 --no-audit --no-fund
```

ב-`package.json` תחת `scripts`: `"test": "vitest run"`. ב-`vite.config.ts`, שנה את השורה הראשונה ל-`import { defineConfig } from 'vitest/config';` והוסף בתוך `defineConfig({...})`:

```ts
  test: { environment: 'node' },
```

- [ ] **Step 2: כתוב בדיקה שנכשלת**

`src/features/voice/wav-encoder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { encodeWav, TARGET_RATE } from './wav-encoder';

/**
 * השרת מקבל רק WAV 16kHz מונו 16-bit. המקודד הוא המקום היחיד שמבטיח
 * את זה, בכל דפדפן — ולכן הוא נבדק ישירות על הבתים.
 */
const bytes = async (b: Blob) => new DataView(await b.arrayBuffer());

describe('encodeWav', () => {
  it('writes a 16kHz mono 16-bit PCM header', async () => {
    const v = await bytes(encodeWav([new Float32Array(48_000)], 48_000));
    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(TARGET_RATE);
    expect(v.getUint16(34, true)).toBe(16);
  });

  it('downsamples 48kHz to 16kHz, keeping the duration', async () => {
    // שנייה אחת ב-48kHz → שנייה אחת ב-16kHz = 16,000 דגימות × 2 בתים.
    const v = await bytes(encodeWav([new Float32Array(48_000)], 48_000));
    expect(v.getUint32(40, true)).toBe(16_000 * 2);
  });

  it('joins chunks as one continuous signal', async () => {
    const one = await bytes(encodeWav([new Float32Array(32_000)], 16_000));
    const two = await bytes(encodeWav([new Float32Array(16_000), new Float32Array(16_000)], 16_000));
    expect(two.getUint32(40, true)).toBe(one.getUint32(40, true));
  });

  it('clips out-of-range samples instead of wrapping around', async () => {
    // בלי clipping, 1.5 הופך ל-int16 שלילי — קליק חזק שהמודל שומע כמילה.
    const v = await bytes(encodeWav([new Float32Array([1.5, -1.5])], 16_000));
    expect(v.getInt16(44, true)).toBe(32_767);
    expect(v.getInt16(46, true)).toBe(-32_768);
  });
});
```

- [ ] **Step 3: הרץ ווודא כישלון**

Run: `npx vitest run src/features/voice/wav-encoder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: ממש**

`src/features/voice/wav-encoder.ts`:

```ts
export const TARGET_RATE = 16_000;

/**
 * Float32 בקצב של המיקרופון → WAV 16kHz מונו 16-bit.
 *
 * למה לא MediaRecorder: Chrome מקליט webm/opus ו-Safari mp4/aac, ולאף
 * אחד מהם אין תמיכה מאומתת ב-Gemini. WAV נתמך בוודאות. 90 שניות ≈ 2.9MB.
 *
 * דגימה מחדש בממוצע של חלון — מספיק לדיבור, ולא מכניס aliasing
 * שמודל שומע כרעש.
 */
export function encodeWav(chunks: Float32Array[], inputRate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const input = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    input.set(c, offset);
    offset += c.length;
  }

  const ratio = inputRate / TARGET_RATE;
  const outLen = Math.floor(total / ratio);
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j] ?? 0;
    const s = Math.max(-1, Math.min(1, sum / (end - start)));
    pcm[i] = s < 0 ? Math.round(s * 32_768) : Math.round(s * 32_767);
  }

  const header = new DataView(new ArrayBuffer(44));
  const tag = (o: number, s: string) => [...s].forEach((ch, k) => header.setUint8(o + k, ch.charCodeAt(0)));
  const dataLen = pcm.length * 2;
  tag(0, 'RIFF');
  header.setUint32(4, 36 + dataLen, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, TARGET_RATE, true);
  header.setUint32(28, TARGET_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  tag(36, 'data');
  header.setUint32(40, dataLen, true);

  return new Blob([header.buffer, pcm.buffer], { type: 'audio/wav' });
}
```

- [ ] **Step 5: הרץ ווודא הצלחה**

Run: `npx vitest run`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend-pwa/package.json frontend-pwa/package-lock.json frontend-pwa/vite.config.ts frontend-pwa/src/features/voice
git commit -m "Encode voice notes as 16kHz mono WAV in the browser"
```

---

### Task 7: הקלטה, טיוטה ומיזוג בממשק הסגירה

**Files:**
- Modify: `frontend-pwa/src/lib/api.ts:102-125` (`send`)
- Create: `frontend-pwa/src/features/voice/use-voice-recorder.ts`
- Create: `frontend-pwa/src/features/voice/voice-draft.ts`
- Test: `frontend-pwa/src/features/voice/voice-draft.test.ts`
- Create: `frontend-pwa/src/features/voice/voice-note-panel.tsx`
- Modify: `frontend-pwa/src/features/jobs/close-job-dialog.tsx`, `frontend-pwa/src/features/jobs/job-detail-page.tsx`

**Interfaces:**
- Consumes: `encodeWav` (Task 6), `POST /v1/tasks/:id/voice-draft` (Task 5)
- Produces: `mergeDraft(current: ChecklistItem[], draft: VoiceDraft): ChecklistItem[]` · `<VoiceNotePanel taskId onApply={(items) => void} />` · `CloseJobDialog` מקבל `onChecklistChange`

- [ ] **Step 1: `send` מקבל FormData**

ב-`frontend-pwa/src/lib/api.ts`, בתוך `send`, החלף:

```ts
  if (body !== undefined) headers['Content-Type'] = 'application/json';
```

ב:

```ts
  // FormData: הדפדפן קובע Content-Type עם boundary בעצמו. קביעה ידנית
  // שוברת את ה-multipart.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
```

ובקריאה ל-`fetch` החלף את `body: ...` ב:

```ts
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
```

- [ ] **Step 2: כתוב בדיקה שנכשלת למיזוג**

`src/features/voice/voice-draft.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { mergeDraft, type VoiceDraft } from './voice-draft';

/**
 * המיזוג קובע מה הטכנאי רואה לפני הסגירה. שני כללים: פריט קיים לא
 * מאבד את הקוד שלו, ופריט שהטכנאי כבר סימן לא מתבטל בגלל ההקלטה.
 */
const draft = (items: VoiceDraft['items']): VoiceDraft => ({ transcript: 't', items, notes: null, unrecognized: [] });

describe('mergeDraft', () => {
  it('marks an existing item done by exact label, keeping its codes', () => {
    const out = mergeDraft(
      [{ label: 'ניקוי פילטרים', done: false, priceCode: 'CLEAN' }],
      draft([{ label: 'ניקוי פילטרים', done: true, priceCode: null, sku: null, qty: null }]),
    );
    expect(out).toEqual([{ label: 'ניקוי פילטרים', done: true, priceCode: 'CLEAN' }]);
  });

  it('never un-ticks what the technician already ticked', () => {
    const out = mergeDraft(
      [{ label: 'בדיקה', done: true }],
      draft([{ label: 'בדיקה', done: false, priceCode: null, sku: null, qty: null }]),
    );
    expect(out[0]?.done).toBe(true);
  });

  it('appends new items with their codes', () => {
    const out = mergeDraft([], draft([{ label: 'החלפת קבל', done: true, priceCode: 'AC-FIX', sku: 'CAP', qty: 1 }]));
    expect(out).toEqual([{ label: 'החלפת קבל', done: true, priceCode: 'AC-FIX', sku: 'CAP', qty: 1 }]);
  });

  it('does not duplicate an item mentioned twice', () => {
    const item = { label: 'גז', done: true, priceCode: null, sku: null, qty: null };
    expect(mergeDraft([], draft([item, item]))).toHaveLength(1);
  });
});
```

- [ ] **Step 3: הרץ ווודא כישלון**

Run: `npx vitest run src/features/voice/voice-draft.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: ממש את הטיוטה והמיזוג**

`src/features/voice/voice-draft.ts`:

```ts
import { z } from 'zod';

import { request } from '@/lib/api';
import type { ChecklistItem } from '@/lib/schemas';

export const voiceDraftSchema = z.object({
  transcript: z.string(),
  items: z.array(
    z.object({
      label: z.string(),
      done: z.boolean(),
      priceCode: z.string().nullable(),
      sku: z.string().nullable(),
      qty: z.number().int().positive().nullable(),
    }),
  ),
  notes: z.string().nullable(),
  unrecognized: z.array(z.string()),
});
export type VoiceDraft = z.infer<typeof voiceDraftSchema>;

export function requestVoiceDraft(taskId: string, wav: Blob): Promise<VoiceDraft> {
  const form = new FormData();
  form.append('audio', wav, 'note.wav');
  return request(`/tasks/${taskId}/voice-draft`, { method: 'POST', body: form, schema: voiceDraftSchema });
}

export function mergeDraft(current: ChecklistItem[], draft: VoiceDraft): ChecklistItem[] {
  const out = current.map((c) => ({ ...c }));
  const byLabel = new Map(out.map((c) => [c.label.trim(), c]));

  for (const d of draft.items) {
    const existing = byLabel.get(d.label.trim());
    if (existing) {
      existing.done = existing.done || d.done;
      continue;
    }
    const added: ChecklistItem = {
      label: d.label,
      done: d.done,
      ...(d.priceCode && { priceCode: d.priceCode }),
      ...(d.sku && { sku: d.sku }),
      ...(d.qty && { qty: d.qty }),
    };
    out.push(added);
    byLabel.set(d.label.trim(), added);
  }
  return out;
}
```

- [ ] **Step 5: ה-hook של ההקלטה**

`src/features/voice/use-voice-recorder.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

import { encodeWav } from './wav-encoder';

export const MAX_SECONDS = 90;

// AudioWorklet כמחרוזת: מודול נפרד היה דורש הגדרת bundling לעובד.
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('capture', Capture);`;

type State = 'idle' | 'recording' | 'denied' | 'unsupported';

export function useVoiceRecorder() {
  const [state, setState] = useState<State>('idle');
  const [seconds, setSeconds] = useState(0);
  const chunks = useRef<Float32Array[]>([]);
  const ctx = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  // נקרא רק בעצירה האוטומטית ב-90 שניות. עצירה ידנית מחזירה את ההקלטה
  // דרך ה-Promise בלבד — אחרת היא הייתה נשלחת פעמיים.
  const onAutoStop = useRef<((b: Blob) => void) | null>(null);

  const teardown = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    void ctx.current?.close();
    ctx.current = null;
    stream.current = null;
  }, []);

  const stop = useCallback((): Promise<Blob> => {
    const rate = ctx.current?.sampleRate ?? 48_000;
    teardown();
    setState('idle');
    const blob = encodeWav(chunks.current, rate);
    chunks.current = [];
    return Promise.resolve(blob);
  }, [teardown]);

  const start = useCallback(async (autoStop: (b: Blob) => void) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      setState('unsupported');
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setState('denied');
      return;
    }
    ctx.current = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.current.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx.current, 'capture');
    node.port.onmessage = (e: MessageEvent<Float32Array>) => chunks.current.push(e.data);
    ctx.current.createMediaStreamSource(stream.current).connect(node);

    chunks.current = [];
    onAutoStop.current = autoStop;
    setSeconds(0);
    setState('recording');
    const startedAt = Date.now();
    timer.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) void stop().then((b) => onAutoStop.current?.(b));
    }, 250);
  }, [stop]);

  useEffect(() => teardown, [teardown]);

  return { state, seconds, start, stop };
}
```

- [ ] **Step 6: הפאנל**

`src/features/voice/voice-note-panel.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { Loader2, Mic, Square } from 'lucide-react';

import { Button, useToast } from '@/components/ui';
import { ApiError } from '@/lib/api';

import { MAX_SECONDS, useVoiceRecorder } from './use-voice-recorder';
import { requestVoiceDraft, type VoiceDraft } from './voice-draft';

/**
 * הקלטה → טיוטה. הפאנל לא סוגר כלום: הוא ממלא את הצ'קליסט, והטכנאי
 * רואה, מתקן ולוחץ "סגירה" כרגיל.
 */
export function VoiceNotePanel({ taskId, onDraft }: { taskId: string; onDraft: (d: VoiceDraft) => void }) {
  const recorder = useVoiceRecorder();
  const toast = useToast();

  const send = useMutation({
    mutationFn: (wav: Blob) => requestVoiceDraft(taskId, wav),
    onSuccess: (draft) => {
      onDraft(draft);
      if (draft.unrecognized.length > 0) {
        toast.error('חלק מהדברים לא זוהו', `לא נמצאו במחירון או במלאי: ${draft.unrecognized.join(', ')}`);
      } else {
        toast.success('הצ׳קליסט עודכן מההקלטה', 'בדקו לפני הסגירה');
      }
    },
    onError: (e) =>
      toast.error('לא הצלחנו להבין את ההקלטה', e instanceof ApiError ? e.message : 'נסו שוב או מלאו ידנית'),
  });

  if (recorder.state === 'unsupported') {
    return <p className="text-sm text-fg-muted">הדפדפן הזה לא תומך בהקלטה. אפשר למלא ידנית.</p>;
  }
  if (recorder.state === 'denied') {
    return <p className="text-sm text-danger">אין הרשאה למיקרופון. יש לאשר בהגדרות הדפדפן.</p>;
  }

  if (send.isPending) {
    return (
      <Button variant="secondary" disabled className="w-full">
        <Loader2 className="animate-spin" aria-hidden />
        מעבד את ההקלטה…
      </Button>
    );
  }

  return recorder.state === 'recording' ? (
    <Button variant="danger" className="w-full" onClick={() => void recorder.stop().then((b) => send.mutate(b))}>
      <Square aria-hidden />
      סיום הקלטה ({recorder.seconds}/{MAX_SECONDS} שנ׳)
    </Button>
  ) : (
    <Button variant="secondary" className="w-full" onClick={() => void recorder.start((b) => send.mutate(b))}>
      <Mic aria-hidden />
      לספר מה עשיתי
    </Button>
  );
}
```

> אם ל-`Button` אין `variant="danger"`, השתמש בווריאנט האדום הקיים ב-`src/components/ui/button.tsx`. אל תוסיף ווריאנט חדש בשביל זה.

- [ ] **Step 7: שילוב בדיאלוג הסגירה**

ב-`job-detail-page.tsx` הצ'קליסט מוחזק ב-`useState` (`checklist`, `setChecklist`). העבר את ה-setter ל-`CloseJobDialog`:

```tsx
<CloseJobDialog taskId={id} checklist={checklist} onChecklistChange={setChecklist} />
```

ב-`close-job-dialog.tsx`, הוסף ל-props `onChecklistChange: (items: ChecklistItem[]) => void`, ייבא את `VoiceNotePanel` ו-`mergeDraft`, ובתוך `DialogBody` מעל רשימת הצ'קליסט:

```tsx
<VoiceNotePanel
  taskId={taskId}
  onDraft={(draft) => onChecklistChange(mergeDraft(checklist, draft))}
/>
```

- [ ] **Step 8: בדיקות ובנייה**

Run: `npx vitest run && npx tsc -b && npx vite build`
Expected: הכול עובר.

- [ ] **Step 9: Commit**

```bash
git add frontend-pwa/src
git commit -m "Let a technician fill the closing checklist by describing the job aloud"
```

---

### Task 8: פריסת אפליקציית הטכנאים ב-`/field/`

**Files:**
- Modify: `frontend-pwa/vite.config.ts` (`base`, `start_url`, `scope`, נתיבי אייקונים)
- Create: `frontend-pwa/.env.selfhost`
- Modify: `.gitignore`, `project-skeleton/.gitignore` (החרגה ל-`.env.selfhost` של ה-PWA)
- Modify: `deploy/host-caddy-web.snippet`
- Create: `scripts/deploy-field.sh`

**Interfaces:**
- Produces: `https://craftmind-ai.com/field/` — אותו מקור כמו ה-API.

- [ ] **Step 1: בסיס `/field/`**

ב-`vite.config.ts`, הוסף ברמה העליונה של `defineConfig`: `base: '/field/',`. ב-`manifest`: `start_url: '/field/'`, `scope: '/field/'`, וכל `src: '/icons/...'` → `src: '/field/icons/...'`.

הרישום ב-`src/main.tsx` נעשה דרך `registerSW` מ-`virtual:pwa-register`, שמכבד את `base` — אין צורך לשנות. **ודא בבנייה** ש-`dist/manifest.webmanifest` מכיל `"scope":"/field/"`: service worker עם scope `/` היה משתלט על האתר הראשי.

- [ ] **Step 2: סביבת בנייה**

`frontend-pwa/.env.selfhost`:

```
# אותו מקור כמו ה-API (craftmind-ai.com/v1). ציבורי — אסור סוד.
VITE_API_URL=
VITE_TENANT=ac-maintenance
```

ב-`.gitignore` הראשי כבר קיים `!**/.env.selfhost`. ב-`project-skeleton/.gitignore` הוסף שורה: `!frontend-pwa/.env.selfhost`.

- [ ] **Step 3: Caddy**

ב-`deploy/host-caddy-web.snippet`, בתוך בלוק `craftmind-ai.com`, **לפני** `handle {` הכללי:

```
	handle_path /field/* {
		root * /var/www/craftmind-field
		@entry path / /index.html /sw.js /manifest.webmanifest
		header @entry Cache-Control "no-cache"
		@hashed path /assets/*
		header @hashed Cache-Control "public, max-age=31536000, immutable"
		# ה-worker רשאי לשלוט רק תחת /field/ — לא באתר הראשי.
		header /sw.js Service-Worker-Allowed "/field/"
		try_files {path} /index.html
		file_server
	}
	redir /field /field/ 308
```

- [ ] **Step 4: סקריפט פריסה**

`scripts/deploy-field.sh` — העתק של `scripts/deploy-web.sh` עם ארבעה שינויים: `cd .../frontend-pwa`, `npx vite build --mode selfhost`, תיקיית גרסאות `/var/www/releases-field`, ו-symlink `/var/www/craftmind-field`. הקובץ המלא:

```bash
#!/usr/bin/env bash
# פורס את אפליקציית הטכנאים ל-craftmind-ai.com/field/. ראו deploy-web.sh
# להסבר על ההחלפה האטומית.
set -euo pipefail
HOST="${1:-root@164.90.161.15}"
SSH=(ssh -i "$HOME/.ssh/id_ed25519" -o IdentitiesOnly=yes "$HOST")
cd "$(dirname "$0")/../frontend-pwa"

npx tsc -b
npx vite build --mode selfhost
test -f dist/sw.js || { echo "service worker missing from build"; exit 1; }

REL="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
"${SSH[@]}" "mkdir -p /var/www/releases-field/$REL"
COPYFILE_DISABLE=1 tar --no-xattrs -C dist -czf - . | "${SSH[@]}" "tar -C /var/www/releases-field/$REL -xzf -"
"${SSH[@]}" "set -e
  test -f /var/www/releases-field/$REL/index.html
  ln -sfn /var/www/releases-field/$REL /var/www/craftmind-field.new && mv -Tf /var/www/craftmind-field.new /var/www/craftmind-field
  ls -1dt /var/www/releases-field/* | tail -n +4 | xargs -r rm -rf
  echo live: \$(readlink /var/www/craftmind-field)"
```

`chmod +x scripts/deploy-field.sh`

- [ ] **Step 5: פריסה ובדיקה**

**רק מ-`main` אחרי מיזוג** (ראו `docs/06-deployment.md`). עדכון Caddy בשרת: גיבוי, החלפת הבלוק, `caddy validate`, `systemctl reload caddy` — אותו סדר כמו בפריסה הראשונה. אחר כך:

```bash
scripts/deploy-field.sh
curl -s -o /dev/null -w "%{http_code}\n" https://craftmind-ai.com/field/
curl -sI https://craftmind-ai.com/field/sw.js | grep -i service-worker-allowed
curl -s -o /dev/null -w "%{http_code}\n" https://craftmind-ai.com/
```

Expected: `200`, `service-worker-allowed: /field/`, `200` (האתר הראשי לא נפגע).

- [ ] **Step 6: Commit**

```bash
git add frontend-pwa/vite.config.ts frontend-pwa/.env.selfhost frontend-pwa/src/main.tsx .gitignore project-skeleton/.gitignore deploy/host-caddy-web.snippet scripts/deploy-field.sh
git commit -m "Serve the technician app at /field/ on the same origin as the API"
```

---

### Task 9: מבחן דיוק על הקלטות אמיתיות

**Files:**
- Create: `scripts/eval-voice-notes.ts`
- Create: `scripts/eval-voice-notes.README.md`

**Interfaces:**
- Consumes: `buildUserPrompt`, `SYSTEM_PROMPT`, `voiceReportSchema`, `parseModelJson`, `reconcile`, `GeminiProvider`.

מטרה: להכריע, **לפני** שמוסיפים את הפיצ'ר למשתמשים, אם Gemini מבין את הז'רגון. המחקר לא מצא מספר WER פורסם ל-Gemini בעברית.

- [ ] **Step 1: פורמט הנתונים**

`scripts/eval-voice-notes.README.md`:

```markdown
# מבחן דיוק להודעות קוליות

תיקייה עם זוגות קבצים לכל הקלטה:

    evals/voice/
      001.wav     ← WAV 16kHz מונו (אפשר להמיר: ffmpeg -i in.ogg -ar 16000 -ac 1 001.wav)
      001.json    ← מה שהיה צריך לצאת:
                    { "priceCodes": ["AC-FIX"], "skus": ["CAP-35UF"], "mustMention": ["קבל"] }
      context.json ← המחירון והמלאי: { "priceList": [{"code","description"}], "inventory": [{"sku","name"}] }

**ההקלטות מכילות קולות אמיתיים — לא לעשות להן commit.** `evals/` כבר ב-.gitignore.

    GEMINI_API_KEY=... npx ts-node scripts/eval-voice-notes.ts evals/voice
```

- [ ] **Step 2: הסקריפט**

`scripts/eval-voice-notes.ts`:

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ConfigService } from '@nestjs/config';

import type { AppEnv } from '../src/config/env.schema';
import { GeminiProvider } from '../src/llm/gemini.provider';
import { buildUserPrompt, SYSTEM_PROMPT } from '../src/modules/voice-report/voice-report.prompt';
import { parseModelJson, reconcile, voiceReportSchema } from '../src/modules/voice-report/voice-report.schema';

type Expected = { priceCodes: string[]; skus: string[]; mustMention: string[] };

async function main(dir: string) {
  const ctx = JSON.parse(fs.readFileSync(path.join(dir, 'context.json'), 'utf8')) as {
    priceList: Array<{ code: string; description: string }>;
    inventory: Array<{ sku: string; name: string }>;
  };
  const llm = new GeminiProvider(new ConfigService(process.env) as unknown as ConfigService<AppEnv, true>);
  const known = { priceCodes: new Set(ctx.priceList.map((p) => p.code)), skus: new Set(ctx.inventory.map((i) => i.sku)) };

  const ids = fs.readdirSync(dir).filter((f) => f.endsWith('.wav')).map((f) => f.slice(0, -4)).sort();
  let codeHits = 0, codeTotal = 0, invented = 0, mentionHits = 0, mentionTotal = 0, failures = 0;

  for (const id of ids) {
    const expected = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')) as Expected;
    try {
      const res = await llm.complete({
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: buildUserPrompt({ taskTitle: 'עבודת מיזוג', checklist: [], ...ctx }),
          attachments: [{ mimeType: 'audio/wav', data: fs.readFileSync(path.join(dir, `${id}.wav`)) }],
        }],
        responseFormat: 'json', temperature: 0.1, maxTokens: 2048, purpose: 'eval',
      });
      const draft = reconcile(voiceReportSchema.parse(parseModelJson(res.text)), known);
      const gotCodes = new Set(draft.items.flatMap((i) => [i.priceCode, i.sku]).filter(Boolean));
      const want = [...expected.priceCodes, ...expected.skus];
      const hits = want.filter((c) => gotCodes.has(c)).length;
      codeHits += hits; codeTotal += want.length;
      invented += [...gotCodes].filter((c) => !want.includes(c as string)).length;
      const m = expected.mustMention.filter((w) => draft.transcript.includes(w)).length;
      mentionHits += m; mentionTotal += expected.mustMention.length;
      console.log(`${id}  codes ${hits}/${want.length}  terms ${m}/${expected.mustMention.length}  «${draft.transcript.slice(0, 60)}»`);
    } catch (e) {
      failures++;
      console.log(`${id}  FAILED: ${(e as Error).message}`);
    }
  }

  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a');
  console.log(`\nקודים שזוהו: ${pct(codeHits, codeTotal)}  |  קודים מיותרים: ${invented}  |  מונחים בתמלול: ${pct(mentionHits, mentionTotal)}  |  כשלונות: ${failures}/${ids.length}`);
}

void main(process.argv[2] ?? 'evals/voice');
```

הוסף `evals/` ל-`project-skeleton/.gitignore`.

- [ ] **Step 3: קריטריון החלטה**

רשום ב-`docs/40-growth-roadmap.md` תחת שלב 1 את התוצאה ואת ההחלטה:
- **קודים ≥ 85% וקודים מיותרים ≈ 0** → משחררים לטכנאים.
- **מתחת** → מחליפים לתמלול ייעודי (`gemini-3.5-transcribe` עם רשימת מונחים, או ivrit.ai) ואז חילוץ בטקסט, ומריצים שוב.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval-voice-notes.ts scripts/eval-voice-notes.README.md project-skeleton/.gitignore
git commit -m "Add an accuracy check for voice notes against real recordings"
```

---

## סדר, תלויות וסיום

```
Task 1 ─┐
Task 2 ─┼─→ Task 4 ─→ Task 5 ─┐
Task 3 ─┘                     ├─→ Task 8 (פריסה, מ-main) ─→ Task 9 (מבחן) ─→ שחרור
Task 6 ─→ Task 7 ─────────────┘
```

Tasks 1, 2, 3, 6 בלתי תלויים — אפשר במקביל.

**הגדרת "גמור":** כל הבדיקות עוברות; טכנאי אמיתי מקליט בטלפון ב-`craftmind-ai.com/field/`, רואה צ'קליסט ממולא, מתקן וסוגר; מבחן הדיוק עמד בקריטריון; ההקלטה לא נמצאת בשום מקום בשרת (`grep -r` בלוגים על מזהה המשימה לא מחזיר תמלול).
