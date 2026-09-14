import { BadRequestException } from '@nestjs/common';

// ============================================================
// אימות קבצים שמגיעים ל-POST /onboarding/:id/documents.
//
// ה-endpoint אנונימי, ולכן:
//   • גודל חסום (10MB) — FileInterceptor בלי limits קיבל multipart
//     בלתי מוגבל לזיכרון של התהליך.
//   • allowlist של סוגים, לא denylist.
//   • **magic bytes** — ה-mimetype מגיע מהלקוח והוא טענה, לא עובדה.
//     `Content-Type: application/pdf` על קובץ הרצה היה מגיע היישר
//     ל-pdf-parse.
// ============================================================

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadKind = 'pdf' | 'text';

const ALLOWED_MIME: ReadonlyMap<string, UploadKind> = new Map<string, UploadKind>([
  ['application/pdf', 'pdf'],
  ['text/plain', 'text'],
  ['text/csv', 'text'],
  ['application/csv', 'text'],
]);

export function isAllowedMimetype(mimetype: string): boolean {
  return ALLOWED_MIME.has(mimetype.split(';')[0]?.trim().toLowerCase() ?? '');
}

/**
 * מחזירה את סוג הקובץ כפי שנקבע מ**תוכנו**, ומוודאת שהוא תואם למה
 * שהלקוח הצהיר. אי-התאמה נדחית — היא סימן מובהק לניסיון עקיפה.
 */
export function verifyUpload(file: { buffer: Buffer; mimetype: string; size: number }): UploadKind {
  if (file.size <= 0 || file.buffer.length === 0) {
    throw new BadRequestException('Uploaded file is empty');
  }
  if (file.buffer.length > MAX_UPLOAD_BYTES) {
    throw new BadRequestException(`Uploaded file exceeds ${MAX_UPLOAD_BYTES} bytes`);
  }

  const declared = ALLOWED_MIME.get(file.mimetype.split(';')[0]?.trim().toLowerCase() ?? '');
  if (!declared) {
    throw new BadRequestException('Only PDF, plain text and CSV files are accepted');
  }

  const actual = detectKind(file.buffer);
  if (actual !== declared) {
    throw new BadRequestException('File content does not match its declared type');
  }

  return actual;
}

function detectKind(buffer: Buffer): UploadKind | null {
  // "%PDF-" בתחילת הקובץ. התקן מתיר עד 1024 בתים של זבל לפני החתימה,
  // אבל pdf-parse עצמו סלחני, ואנחנו דווקא לא רוצים להיות.
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';

  // טקסט: אין בתי NUL, וה-decode ל-UTF-8 הוא round-trip נקי. זה חוסם
  // קבצים בינאריים שמתחזים ל-text/plain.
  const head = buffer.subarray(0, 8_192);
  if (head.includes(0)) return null;
  // חיתוך של 3 בתים בקצה כשהקובץ ארוך יותר: בלעדיו תו UTF-8 רב-בתי
  // שנחתך בגבול הדגימה מייצר U+FFFD ומפיל קובץ עברית תקין לחלוטין.
  const sample = buffer.length > head.length ? head.subarray(0, head.length - 3) : head;
  if (sample.toString('utf8').includes('�')) return null;
  return 'text';
}
