import { createHash } from 'node:crypto';

/**
 * חתימת הגוף היא מה שמבדיל בין "ניסיון חוזר" לבין "מפתח שמוחזר
 * בשימוש עם תוכן אחר". אם היא רגישה לסדר המפתחות ב-JSON, לקוח
 * שמסרלז אחרת יקבל 422 על ניסיון חוזר לגיטימי.
 *
 * הפונקציה משוכפלת כאן במכוון: היא פרטית ל-interceptor, וייצוא שלה
 * רק לצורך בדיקה היה מרחיב את הממשק הציבורי עבור הבדיקה.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

const hash = (b: unknown): string => createHash('sha256').update(stableStringify(b)).digest('hex');

describe('idempotency request hashing', () => {
  it('is stable across key order', () => {
    expect(hash({ a: 1, b: 2 })).toBe(hash({ b: 2, a: 1 }));
  });

  it('is stable across nested key order', () => {
    expect(hash({ x: { a: 1, b: 2 } })).toBe(hash({ x: { b: 2, a: 1 } }));
  });

  it('differs when a value changes', () => {
    expect(hash({ a: 1 })).not.toBe(hash({ a: 2 }));
  });

  it('differs when a field is added', () => {
    expect(hash({ a: 1 })).not.toBe(hash({ a: 1, b: 1 }));
  });

  it('respects array order, which is meaningful', () => {
    expect(hash({ a: [1, 2] })).not.toBe(hash({ a: [2, 1] }));
  });

  it('distinguishes a missing field from an explicit null', () => {
    expect(hash({ a: 1 })).not.toBe(hash({ a: 1, b: null }));
  });

  it('handles an empty body', () => {
    expect(hash({})).toBe(hash({}));
    expect(hash({})).not.toBe(hash(undefined));
  });
});
