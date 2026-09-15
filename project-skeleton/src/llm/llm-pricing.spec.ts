import { estimateCostMinor, priceFor } from './llm-pricing';

/**
 * תמחור.
 *
 * הבדיקות כאן שומרות על שתי תכונות שקל לשבור בלי לשים לב:
 * שקריאה ממטמון באמת זולה יותר, ושמודל לא מוכר אינו נראה חינם.
 */
describe('LLM pricing', () => {
  const base = { inputTokens: 100_000, outputTokens: 10_000 };

  it('charges more for output than for input', () => {
    const p = priceFor('claude-sonnet-5');
    expect(p.outputMinorPerMillion).toBeGreaterThan(p.inputMinorPerMillion);
  });

  it('makes a cached read cheaper than the same tokens as fresh input', () => {
    // זו כל הסיבה ל-caching. אם זה לא מתקיים, המכפיל שגוי.
    const fresh = estimateCostMinor('claude-sonnet-5', base);
    const cached = estimateCostMinor('claude-sonnet-5', {
      inputTokens: 0,
      outputTokens: base.outputTokens,
      cacheReadTokens: base.inputTokens,
    });
    expect(cached).toBeLessThan(fresh);
  });

  it('makes a cache write slightly more expensive than fresh input', () => {
    // כתיבה למטמון עולה מעט יותר, פעם אחת. אם היא נראית זולה
    // יותר, מישהו הפך את המכפילים.
    const fresh = estimateCostMinor('claude-sonnet-5', base);
    const written = estimateCostMinor('claude-sonnet-5', {
      inputTokens: 0,
      outputTokens: base.outputTokens,
      cacheCreationTokens: base.inputTokens,
    });
    expect(written).toBeGreaterThan(fresh);
  });

  it('never prices an unknown model at zero', () => {
    // מודל חדש שלא נוסף למחירון חייב להיראות יקר, לא חינם —
    // אחרת תקציב לא ייאכף עליו.
    expect(estimateCostMinor('some-future-model', base)).toBeGreaterThan(0);
  });

  it('rounds up, so an estimate is never under the real cost', () => {
    expect(estimateCostMinor('gemini-3.6-flash', { inputTokens: 1, outputTokens: 1 })).toBe(1);
  });

  it('costs nothing for an empty call', () => {
    expect(estimateCostMinor('claude-sonnet-5', { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});
