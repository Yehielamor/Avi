import { PDFParse } from 'pdf-parse';

// ============================================================
// חילוץ טקסט גולמי מ-PDF. לא OCR — מסמך שהוא סריקת תמונה בלי שכבת
// טקסט יחזיר מחרוזת ריקה.
//
// שני מגבלים שלא היו קודם, ושניהם נדרשים כי ה-endpoint אנונימי:
//   • תקרת עמודים — PDF עם 5,000 עמודים חסם את ה-event loop לדקות
//     (pdf-parse רץ בתהליך, לא בעובד).
//   • timeout — מסמך זדוני ("PDF bomb") יכול להיתקע בפרסור ללא גבול.
//
// הערה: pdf-parse v2 שינה API מול v1 (class עם getText() אסינכרוני).
// ============================================================

export const PDF_MAX_PAGES = 30;
export const PDF_PARSE_TIMEOUT_MS = 10_000;

export class PdfParseTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`PDF parsing exceeded ${timeoutMs}ms`);
    this.name = 'PdfParseTimeoutError';
  }
}

export async function extractTextFromPdf(
  buffer: Buffer,
  opts: { maxPages?: number; timeoutMs?: number } = {},
): Promise<string> {
  const maxPages = opts.maxPages ?? PDF_MAX_PAGES;
  const timeoutMs = opts.timeoutMs ?? PDF_PARSE_TIMEOUT_MS;

  const parser = new PDFParse({ data: buffer });

  let timer: NodeJS.Timeout | undefined;
  try {
    // ה-timeout משחרר את הבקשה; הפרסור עצמו עדיין ירוץ עד סופו
    // (אין ביטול ב-pdf-parse). זו הסיבה שתקרת העמודים חשובה ממנו —
    // היא מה שמגביל את העבודה בפועל, וה-timeout הוא רשת ביטחון.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PdfParseTimeoutError(timeoutMs)), timeoutMs);
      timer.unref();
    });

    const result = await Promise.race([parser.getText({ first: maxPages }), timeout]);
    return result.text;
  } finally {
    if (timer) clearTimeout(timer);
    await parser.destroy().catch(() => undefined);
  }
}
