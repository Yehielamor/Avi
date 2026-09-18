import { isCalendarDate } from './calendar-date';

describe('isCalendarDate', () => {
  it.each(['2026-09-18', '2024-02-29', '2026-12-31', '1900-01-01', '2100-06-30'])('accepts %s', (d) => {
    expect(isCalendarDate(d)).toBe(true);
  });

  it.each([
    ['a day past the end of the month', '2026-10-32'],
    ['a rolled-over date (JS would silently make it 2 March)', '2026-02-30'],
    ['29 February outside a leap year', '2026-02-29'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-10'],
    ['day 00', '2026-01-00'],
    ['year 0000 (Postgres rejects it)', '0000-01-01'],
    ['a year before 1900', '1899-12-31'],
    ['a date with a time', '2026-09-18T00:00:00Z'],
    ['a short year', '26-09-18'],
    ['an empty string', ''],
  ])('rejects %s', (_l, d) => {
    expect(isCalendarDate(d)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isCalendarDate(20260918)).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
  });
});
