import { buildWaLink, toWaNumber } from './phone.util';

/**
 * קישור wa.me עם מספר שגוי פותח שיחה עם אדם אחר, עם פרטי העבודה של
 * הלקוח בתוכה. לכן כאן כל מקרה גבולי חייב להחזיר null ולא ניחוש.
 */
describe('toWaNumber', () => {
  it.each([
    ['050-1234567', '972501234567'],
    ['0501234567', '972501234567'],
    ['+972 50 123 4567', '972501234567'],
    ['+972-050-1234567', '972501234567'],
    ['00972501234567', '972501234567'],
    ['972501234567', '972501234567'],
    ['(054) 765-4321', '972547654321'],
    ['03-1234567', '97231234567'],
    ['077-1234567', '972771234567'],
  ])('normalises %s', (input, expected) => {
    expect(toWaNumber(input)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['12345'],
    ['050-12345'], // חסרות ספרות
    ['050-12345678'], // ספרה עודפת
    ['+1 415 555 0100'], // לא ישראלי — לא מנחשים
    ['abc'],
  ])('rejects %s', (input) => {
    expect(toWaNumber(input)).toBeNull();
  });
});

describe('buildWaLink', () => {
  it('encodes Hebrew and the URL inside the message', () => {
    const link = buildWaLink('050-1234567', 'שלום! https://craftmind-ai.com/c/s/abc?x=1&y=2');
    expect(link).toMatch(/^https:\/\/wa\.me\/972501234567\?text=/);
    const text = decodeURIComponent(link!.split('?text=')[1]!);
    expect(text).toBe('שלום! https://craftmind-ai.com/c/s/abc?x=1&y=2');
  });

  it('returns null rather than a link to a wrong number', () => {
    expect(buildWaLink('123', 'x')).toBeNull();
  });
});
