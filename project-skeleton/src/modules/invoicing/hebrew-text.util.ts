// ============================================================
// סידור טקסט דו-כיווני (bidi) לצורך pdfkit.
//
// למה זה בכלל קיים: pdfkit כותב glyphs בסדר שבו הם מופיעים
// במחרוזת. הוא *לא* מיישם את אלגוריתם ה-bidi של יוניקוד. כלומר
// `doc.text('שלום 123')` יוצא בקובץ הפוך — האותיות בסדר לוגי,
// לא בסדר ויזואלי. `align: 'right'` מזיז את הבלוק ימינה אבל לא
// מתקן את סדר התווים.
//
// מה שכן קורה ב-pdfkit/fontkit, ובגללו הקובץ הזה נראה כמו שהוא
// נראה: fontkit מזהה סקריפט RTL במחרוזת ו**הופך את כולה** — כולל
// ספרות ולטינית שבתוכה. אימות מול הפלט בפועל (`pdftotext`, לא
// לפי העין):
//
//   קלט  "מ\"עב ... תיירגסמ"  →  ב-PDF: "תיירגסמ ... מ\"עב"
//   קלט  "3 הדיחי AC ןוקית"    →  ב-PDF: "ןוקית AC הדיחי 3"
//
// כלומר גם סידור ידני מראש *וגם* `features: ['rtla']` נשברים —
// שניהם מוסיפים היפוך על היפוך, והתוצאה תלויה בתו הראשון במחרוזת.
//
// לכן ה-API האמיתי כאן הוא `layoutRtlRuns`: פיצול לריצות
// **הומוגניות** וסידורן בסדר ויזואלי, כשכל ריצה נמסרת ל-pdfkit
// בסדר *לוגי*. ריצה עברית — fontkit יהפוך אותה, וזה בדיוק הרצוי.
// ריצה לטינית/ספרתית — אין בה RTL, ולכן היא נשארת כמות שהיא.
// שתי ההתנהגויות דטרמיניסטיות כי כל ריצה חד-כיוונית.
//
// המימוש הוא UBA מצומצם שמספיק בדיוק לשורות של חשבונית
// (שם, תיאור, קוד, סכום, תאריך) ולא מנסה להיות מלא:
//
//   1. כל תו מסווג R (עברית/ערבית), L (לטינית), EN (ספרה) או N (נייטרלי).
//   2. ספרות ופיסוק-מספרי נצמדים לכיוון ה-LTR — "1,234.50" ו-"01/02/2026"
//      חייבים להישאר קריאים משמאל לימין גם בתוך משפט עברי.
//   3. ריצה נייטרלית בין שני צדדים מאותו כיוון מקבלת אותו כיוון;
//      אחרת מקבלת את כיוון הבסיס.
//   4. כיוון הבסיס הוא RTL: סדר הריצות מתהפך. סוגריים בריצת RTL
//      ממופים למראה שלהם — fontkit הופך מיקום, לא glyph.
//
// אין כאן shaping (ligatures/nikud positioning) — עברית ללא ניקוד
// לא זקוקה לו, וה-glyphs עצמם מגיעים מהפונט.
// ============================================================

const HEBREW_RE = /[֐-׿יִ-ﭏ]/;
const ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const LATIN_RE = /[A-Za-zÀ-ɏ]/;
const DIGIT_RE = /[0-9٠-٩]/;
// פיסוק שנחשב חלק מ"מספר" כשהוא בין ספרות: 1,234.50 / 01-02 / 50%
const NUMERIC_GLUE_RE = /[.,:/\-+%]/;

type Dir = 'R' | 'L' | 'N';

const MIRRORED: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
};

function classify(ch: string): Dir {
  if (HEBREW_RE.test(ch) || ARABIC_RE.test(ch)) return 'R';
  if (LATIN_RE.test(ch) || DIGIT_RE.test(ch)) return 'L';
  return 'N';
}

/** האם המחרוזת מכילה בכלל תו RTL — אם לא, אין מה לסדר. */
export function containsRtl(text: string): boolean {
  return HEBREW_RE.test(text) || ARABIC_RE.test(text);
}

export interface DirectionalRun {
  /** טקסט הריצה **בסדר לוגי**. אל תהפכו אותו — pdfkit יעשה זאת לריצת RTL. */
  text: string;
  dir: 'R' | 'L';
}

/** מחזיר את הכיוון הפתור לכל תו בשורה. */
function resolveDirections(chars: string[]): Array<'R' | 'L'> {
  const classes = chars.map(classify);

  // שלב 1: פיסוק בין ספרות הופך לחלק מהמספר (LTR), כדי ש-"1,234.50"
  // ו-"01/02/2026" לא יתפרקו לשלוש ריצות עם הנייטרלים ביניהן.
  for (let i = 1; i < chars.length - 1; i++) {
    const ch = chars[i];
    if (!ch || classes[i] !== 'N' || !NUMERIC_GLUE_RE.test(ch)) continue;
    const prev = chars[i - 1];
    const next = chars[i + 1];
    if (prev && next && DIGIT_RE.test(prev) && DIGIT_RE.test(next)) {
      classes[i] = 'L';
    }
  }

  // שלב 2: לכל נייטרל — הכיוון של השכן החזק משני הצדדים אם הם
  // מסכימים, אחרת כיוון הבסיס (RTL).
  const resolved: Array<'R' | 'L'> = classes.map((c) => (c === 'N' ? 'R' : c));
  for (let i = 0; i < classes.length; i++) {
    if (classes[i] !== 'N') continue;

    let before: 'R' | 'L' | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const cls = classes[j];
      if (cls !== undefined && cls !== 'N') {
        before = cls;
        break;
      }
    }
    let after: 'R' | 'L' | null = null;
    for (let j = i + 1; j < classes.length; j++) {
      const cls = classes[j];
      if (cls !== undefined && cls !== 'N') {
        after = cls;
        break;
      }
    }

    resolved[i] = before !== null && before === after ? before : 'R';
  }

  return resolved;
}

/**
 * מפצל שורה לריצות חד-כיווניות ומחזיר אותן **בסדר ויזואלי**
 * (שמאל→ימין על הדף), כשכל ריצה בסדר לוגי.
 *
 * זו הפונקציה שה-PDF משתמש בה. הקורא ממקם כל ריצה ב-x משלה
 * ברצף — ראו invoice-pdf.util.ts.
 */
export function layoutRtlRuns(line: string): DirectionalRun[] {
  const chars = [...line];
  if (chars.length === 0) return [];

  const resolved = resolveDirections(chars);

  const runs: DirectionalRun[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const dir = resolved[i];
    if (ch === undefined || dir === undefined) continue;
    // סוגריים בהקשר RTL ממופים למראה: fontkit הופך *מיקום*, לא glyph,
    // ובלי זה "(דחוף)" יוצא ")דחוף(".
    const glyph = dir === 'R' ? (MIRRORED[ch] ?? ch) : ch;

    const last = runs[runs.length - 1];
    if (last && last.dir === dir) {
      last.text += glyph;
    } else {
      runs.push({ dir, text: glyph });
    }
  }

  // בסיס RTL: הריצה הלוגית הראשונה מוצגת הכי ימינה, כלומר סדר
  // הריצות על הדף הוא הפוך.
  runs.reverse();
  return runs;
}

/**
 * סדר ויזואלי כמחרוזת אחת. משמש לבדיקות ולכל צרכן שאינו pdfkit;
 * **לא** להעברה ל-`doc.text`, כי fontkit יהפוך אותה שוב.
 */
export function toVisualRtl(text: string): string {
  if (!text) return '';
  if (!containsRtl(text)) return text;

  return text
    .split('\n')
    .map((line) =>
      layoutRtlRuns(line)
        .map((run) => (run.dir === 'R' ? [...run.text].reverse().join('') : run.text))
        .join(''),
    )
    .join('\n');
}
