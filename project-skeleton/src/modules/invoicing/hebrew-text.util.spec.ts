import { containsRtl, layoutRtlRuns, toVisualRtl } from './hebrew-text.util';

/**
 * סידור bidi לחשבונית.
 *
 * הבאג שהיה: הקוד הפך ריצות עברית בעצמו, ו-fontkit הפך אותן שוב.
 * ההיפוך הכפול לא נעצר בעברית — הוא סחב איתו גם ספרות, ומספר
 * חשבונית 1042 הודפס 2401 ותאריך 01/02/2026 הודפס 6202/20/10.
 * מספר שקריא הפוך הוא מסמך חשבונאי שגוי, לא פגם אסתטי.
 *
 * החוזה שנבדק כאן:
 *   • `layoutRtlRuns` מחזיר ריצות בסדר *ויזואלי*, כל ריצה בסדר *לוגי*
 *     (אסור להפוך ידנית — זו העבודה של fontkit).
 *   • ספרות, תאריכים, סכומים ולטינית נשארים משמאל לימין.
 *   • `toVisualRtl` הוא הייצוג הסופי כפי שהוא ייראה בדף.
 */
describe('hebrew-text.util', () => {
  describe('containsRtl', () => {
    it('detects Hebrew', () => {
      expect(containsRtl('שלום')).toBe(true);
    });

    it('is false for a pure Latin/number line, so it is left untouched', () => {
      expect(containsRtl('Invoice 1042')).toBe(false);
      expect(toVisualRtl('Invoice 1042')).toBe('Invoice 1042');
    });

    it('is false for an empty string', () => {
      expect(containsRtl('')).toBe(false);
      expect(toVisualRtl('')).toBe('');
    });
  });

  describe('layoutRtlRuns — runs stay in logical order', () => {
    it('never hands back a pre-reversed Hebrew run', () => {
      // זה הלב של התיקון. אם ריצה עברית חוזרת הפוכה, fontkit יהפוך
      // אותה בחזרה והטקסט יצא ג'יבריש בסדר לוגי על הדף.
      const runs = layoutRtlRuns('תיקון AC יחידה 3');
      const hebrew = runs.filter((r) => r.dir === 'R').map((r) => r.text);
      expect(hebrew).toEqual([' יחידה ', 'תיקון ']);
      expect(hebrew.join('')).not.toContain('ןוקית');
    });

    it('orders runs right-to-left: the first logical run is rendered last', () => {
      expect(layoutRtlRuns('תיקון AC יחידה 3')).toEqual([
        { dir: 'L', text: '3' },
        { dir: 'R', text: ' יחידה ' },
        { dir: 'L', text: 'AC' },
        { dir: 'R', text: 'תיקון ' },
      ]);
    });

    it('keeps a whole line of Latin as a single untouched run', () => {
      expect(layoutRtlRuns('Acme Ltd')).toEqual([{ dir: 'L', text: 'Acme Ltd' }]);
    });

    it('returns nothing for an empty line', () => {
      expect(layoutRtlRuns('')).toEqual([]);
    });
  });

  describe('numbers keep reading left-to-right', () => {
    it('does not reverse a bare invoice number', () => {
      // 1042 שהודפס 2401 הוא הבאג שהוליד את הקובץ הזה.
      expect(toVisualRtl('1042')).toBe('1042');
    });

    it('does not reverse a number embedded in a Hebrew sentence', () => {
      expect(toVisualRtl('מסמך Invoice מספר 1042')).toBe('1042 רפסמ Invoice ךמסמ');
      expect(toVisualRtl('מסמך Invoice מספר 1042')).toContain('1042');
    });

    it('keeps a date as one left-to-right run, slashes included', () => {
      // "01/02/2026" שנשבר לשלוש ריצות היה יוצא "2026/02/01" ומשנה
      // את המשמעות של תקופת החיוב.
      expect(layoutRtlRuns('תאריך: 01/02/2026')).toEqual([
        { dir: 'L', text: '01/02/2026' },
        { dir: 'R', text: 'תאריך: ' },
      ]);
      expect(toVisualRtl('תאריך: 01/02/2026')).toBe('01/02/2026 :ךיראת');
    });

    it('keeps a currency amount intact — thousands separator and decimal point', () => {
      expect(toVisualRtl('סה"כ 1,234.50 ש"ח')).toBe('ח"ש 1,234.50 כ"הס');
      expect(toVisualRtl('סה"כ 1,234.50 ש"ח')).toContain('1,234.50');
    });

    it('keeps a decimal number glued when it sits between Hebrew words', () => {
      expect(toVisualRtl('מזגן 2.5 כ"ס')).toContain('2.5');
    });

    it('does not glue a slash that is not between digits', () => {
      // "מס/קבלה" הוא טקסט עברי, לא מספר — הלוכסן חייב להישאר בריצה
      // העברית ולא לפצל אותה.
      expect(layoutRtlRuns('חשבונית מס/קבלה 7')).toEqual([
        { dir: 'L', text: '7' },
        { dir: 'R', text: 'חשבונית מס/קבלה ' },
      ]);
    });
  });

  describe('mixed and mirrored content', () => {
    it('mirrors brackets inside a Hebrew run so they render the right way round', () => {
      // fontkit הופך *מיקום*, לא glyph. בלי המיפוי "(דחוף)" יוצא ")דחוף(".
      const runs = layoutRtlRuns('תיקון (דחוף) במשרד');
      expect(runs).toEqual([{ dir: 'R', text: 'תיקון )דחוף( במשרד' }]);
      expect(toVisualRtl('תיקון (דחוף) במשרד')).toBe('דרשמב (ףוחד) ןוקית');
    });

    it('does not mirror brackets inside a Latin run', () => {
      expect(layoutRtlRuns('פריט (AC-1) חדש')).toContainEqual({ dir: 'L', text: 'AC-1' });
    });

    it('lays out a plain Hebrew line right-to-left', () => {
      expect(toVisualRtl('שלום')).toBe('םולש');
    });

    it('handles each line of a multi-line block independently', () => {
      expect(toVisualRtl('שלום\nInvoice 1042')).toBe('םולש\nInvoice 1042');
    });

    it('preserves every character of the input', () => {
      // היפוך כפול או ריצה שנבלעה מתגלים כאן גם כשהסדר במקרה יוצא נכון.
      const line = 'תיקון AC יחידה 3 — 1,234.50 ש"ח';
      const sorted = (s: string) => [...s].sort().join('');
      expect(sorted(toVisualRtl(line))).toBe(sorted(line));
    });
  });
});
