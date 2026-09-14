import * as fs from 'node:fs';
import * as path from 'node:path';
import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { layoutRtlRuns } from './hebrew-text.util';

// ============================================================
// יצירת PDF פנימי לחשבונית (מסמך הארכיטקטורה, סעיף 6.4: "ב-MVP
// הפקת PDF פנימי, ללא חשבונית ירוקה").
//
// ------------------------------------------------------------
// למה זה נכתב מחדש
// ------------------------------------------------------------
// הגרסה הקודמת השתמשה ב-`Helvetica` המובנה של pdfkit. זהו פונט
// WinAnsi (Latin-1) — אין בו glyph לאף אות עברית. כל שם טננט, שם
// לקוח ותיאור שורה במוצר הזה הם בעברית, ולכן *כל* חשבונית שנוצרה
// יצאה משובשת — והקובץ הזה הוא מה שמגיע לרואה החשבון של הלקוח.
//
// התיקון: פונט TTF פתוח עם כיסוי עברי (David Libre, רישיון OFL —
// ראו assets/fonts/OFL.txt), שנרשם ב-`doc.registerFont`, + פריסה
// מימין לשמאל.
//
// למה David Libre ולא Noto Sans Hebrew: Noto Sans Hebrew מופץ היום
// כפונט *משתנה* (wght/wdth) בלבד, ומנוע ה-subsetting של pdfkit נופל
// עליו (`First argument to DataView constructor must be an ArrayBuffer`).
// David Libre מגיע כקבצים סטטיים Regular/Bold, וגם נראה כמו "דוד" —
// גופן המסמכים העברי המקובל, מה שמתאים בדיוק לקובץ שמגיע לרואה חשבון.
//
// pdfkit לא מיישם bidi, ו-fontkit הופך כל מחרוזת שיש בה עברית —
// כולל הספרות שבתוכה. לכן כל שורה מפוצלת ל-`layoutRtlRuns` וכל
// ריצה ממוקמת ב-x משלה. ראו hebrew-text.util.ts להסבר מלא.
//
// ------------------------------------------------------------
// כסף
// ------------------------------------------------------------
// הסכומים נכנסים כ-`Prisma.Decimal`, לא כ-`number`. עיגול בינארי
// בשלב ה-*הצגה* מייצר חשבונית שבה סכום השורות לא מסתדר עם הסך
// הכולל, וזה בדיוק המסמך שאמור להסתדר.
// ============================================================

export interface InvoicePdfLineItem {
  description: string;
  priceCode: string;
  amount: Prisma.Decimal;
}

export interface InvoicePdfData {
  tenantName: string;
  customerName: string;
  /** המספר הרץ לכל טננט — זה מה שמופיע כ"מספר חשבונית", לא ה-UUID. */
  invoiceNumber: number;
  invoiceId: string;
  periodStart: Date;
  periodEnd: Date;
  lineItems: InvoicePdfLineItem[];
  totalAmount: Prisma.Decimal;
}

const FONT_REGULAR = 'Hebrew';
const FONT_BOLD = 'Hebrew-Bold';
const FONT_FILE_REGULAR = 'DavidLibre-Regular.ttf';
const FONT_FILE_BOLD = 'DavidLibre-Bold.ttf';

/**
 * הפונט נטען מ-`assets/fonts/` בשורש הפרויקט. ה-build של Nest
 * מוציא ל-`dist/`, ולכן מחפשים גם יחסית ל-`__dirname` וגם יחסית
 * ל-cwd — קובץ שנמצא רק באחד מהם היה שובר בפרודקשן בלבד.
 */
function resolveFontPath(fileName: string): string {
  const candidates = [
    path.resolve(__dirname, '../../../assets/fonts', fileName),
    path.resolve(__dirname, '../../../../assets/fonts', fileName),
    path.resolve(process.cwd(), 'assets/fonts', fileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // כשל רועש בכוונה. הכשל השקט — נפילה חזרה ל-Helvetica — הוא בדיוק
  // הבאג שתוקן כאן: PDF שנוצר "בהצלחה" ויוצא ג'יבריש אצל הלקוח.
  throw new Error(
    `Hebrew invoice font not found. Looked in:\n${candidates.map((c) => `  • ${c}`).join('\n')}\n` +
      `Every invoice in this product contains Hebrew; rendering without this font produces ` +
      `corrupted output. Ensure assets/fonts/${fileName} ships with the build.`,
  );
}

// פורמט כספי עם שתי ספרות אחרי הנקודה, ישירות מה-Decimal —
// בלי מעבר דרך Number בדרך.
function fmtMoney(amount: Prisma.Decimal): string {
  return amount.toFixed(2);
}

// תאריך בפורמט הישראלי. לא toLocaleDateString: הפלט שלו תלוי
// ב-ICU של הקונטיינר, ומכונת build רזה מחזירה פורמט אחר לגמרי.
function fmtDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// עמודות מימין לשמאל: תיאור (רחב, ימין) → קוד → סכום (שמאל).
const COL_DESCRIPTION = { x: MARGIN + 210, width: CONTENT_WIDTH - 210 };
const COL_CODE = { x: MARGIN + 110, width: 95 };
const COL_AMOUNT = { x: MARGIN, width: 95 };

export function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  // resolve לפני שנפתח מסמך — עדיף לזרוק לפני שיש stream פתוח.
  const regularPath = resolveFontPath(FONT_FILE_REGULAR);
  const boldPath = resolveFontPath(FONT_FILE_BOLD);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      doc.registerFont(FONT_REGULAR, regularPath);
      doc.registerFont(FONT_BOLD, boldPath);
      doc.font(FONT_REGULAR);

      /**
       * כותב שורה אחת מימין לשמאל.
       *
       * **לא** `doc.text(wholeLine, { align: 'right' })`: fontkit
       * יהפוך את כל המחרוזת, ואיתה את "1042" ל-"2401" ואת התאריך
       * ל-"6202/20/10". במקום זה כל ריצה חד-כיוונית ממוקמת בנפרד
       * ב-x מחושב, ו-`lineBreak: false` מונע גלישה שתשבור את המיקום.
       */
      const write = (
        text: string,
        opts: { x?: number; y?: number; width?: number; align?: 'right' | 'left' } = {},
      ) => {
        const x = opts.x ?? MARGIN;
        const boxWidth = opts.width ?? CONTENT_WIDTH;
        const align = opts.align ?? 'right';
        const y = opts.y ?? doc.y;

        const runs = layoutRtlRuns(text);
        if (runs.length === 0) {
          doc.y = y + doc.currentLineHeight();
          return;
        }

        const widths = runs.map((run) => doc.widthOfString(run.text));
        const total = widths.reduce((sum, w) => sum + w, 0);

        // גלישה לשורה שנייה לא נתמכת כאן: המיקום הידני לכל ריצה
        // שובר את חישוב השורות של pdfkit. שורה רחבה מדי נצמדת לשוליים
        // השמאליים ועולה על גדותיה שמאלה בלבד — לעולם לא לתוך העמודה
        // שמימינה, שהיא מה שהיה הופך את הטבלה לבלתי קריאה.
        const cursorStart = align === 'left' ? x : x + Math.max(boxWidth - total, 0);

        let cursor = cursorStart;
        for (let i = 0; i < runs.length; i++) {
          const run = runs[i];
          const runWidth = widths[i];
          if (!run || runWidth === undefined) continue;
          doc.text(run.text, cursor, y, { lineBreak: false });
          cursor += runWidth;
        }

        doc.x = x;
        doc.y = y + doc.currentLineHeight();
      };

      // --- כותרת ---
      doc.font(FONT_BOLD).fontSize(20);
      write(data.tenantName);
      doc.font(FONT_REGULAR);
      doc.moveDown(0.4);

      doc.fontSize(14);
      write(`חשבונית מס' ${data.invoiceNumber}`);

      doc.fontSize(10);
      write(`תקופה: ${fmtDate(data.periodStart)} - ${fmtDate(data.periodEnd)}`);
      write(`לקוח: ${data.customerName}`);
      doc.moveDown(1.5);

      // --- כותרות טבלה ---
      const headerY = doc.y;
      doc.font(FONT_BOLD).fontSize(10);
      write('תיאור', { x: COL_DESCRIPTION.x, y: headerY, width: COL_DESCRIPTION.width });
      write('קוד', { x: COL_CODE.x, y: headerY, width: COL_CODE.width });
      write('סכום', { x: COL_AMOUNT.x, y: headerY, width: COL_AMOUNT.width, align: 'left' });

      doc.font(FONT_REGULAR);
      doc.moveDown(0.5);
      doc.moveTo(MARGIN, doc.y).lineTo(CONTENT_RIGHT, doc.y).stroke();
      doc.moveDown(0.3);

      // --- שורות ---
      for (const item of data.lineItems) {
        // מעבר עמוד ידני: pdfkit מוסיף עמוד לבד רק לכתיבה שזורמת,
        // ולא כשנותנים לו y מפורש כמו כאן.
        if (doc.y > doc.page.height - MARGIN - 60) {
          doc.addPage();
        }
        const rowY = doc.y;
        write(item.description, {
          x: COL_DESCRIPTION.x,
          y: rowY,
          width: COL_DESCRIPTION.width,
        });
        write(item.priceCode, { x: COL_CODE.x, y: rowY, width: COL_CODE.width });
        write(fmtMoney(item.amount), {
          x: COL_AMOUNT.x,
          y: rowY,
          width: COL_AMOUNT.width,
          align: 'left',
        });
        doc.moveDown(0.4);
      }

      // --- סיכום ---
      doc.moveDown(0.5);
      doc.moveTo(MARGIN, doc.y).lineTo(CONTENT_RIGHT, doc.y).stroke();
      doc.moveDown(0.5);

      const totalY = doc.y;
      doc.font(FONT_BOLD).fontSize(12);
      write('סה"כ לתשלום', {
        x: COL_DESCRIPTION.x,
        y: totalY,
        width: COL_DESCRIPTION.width,
      });
      write(fmtMoney(data.totalAmount), {
        x: COL_AMOUNT.x,
        y: totalY,
        width: COL_AMOUNT.width,
        align: 'left',
      });

      doc.end();
    } catch (err: unknown) {
      // ה-stream כבר פתוח; בלי destroy הוא נשאר תלוי ו-ה-Promise
      // לא נפתר לעולם.
      doc.destroy();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
