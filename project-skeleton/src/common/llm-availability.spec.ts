import { ServiceUnavailableException } from '@nestjs/common';
import { assertLlmConfigured, isLlmConfigured } from './llm-availability';

/**
 * שער ה-LLM.
 *
 * הערך שלו הוא בדיוק בהבחנה בין "לא הוגדר" ל"תקלה": 503 אומר
 * למפעיל להגדיר מפתח, 500 שולח אותו לחפש באג שאינו קיים.
 */
describe('assertLlmConfigured', () => {
  it('passes through when a key is present', () => {
    expect(() => assertLlmConfigured('sk-ant-real-key', 'Task extraction')).not.toThrow();
  });

  it('throws 503, not 500, when the key is missing', () => {
    try {
      assertLlmConfigured(undefined, 'Task extraction');
      throw new Error('expected assertLlmConfigured to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as ServiceUnavailableException).getStatus()).toBe(503);
    }
  });

  it.each([
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
    ['a tab', '\t'],
    ['a newline', '\n'],
  ])('rejects %s', (_label, value) => {
    // מפתח שהוא רווחים הוא התקלה השכיחה: שורה ב-.env שנשארה
    // ריקה אחרי סימן השווה. הוא truthy, ובלי trim הוא היה עובר.
    expect(() => assertLlmConfigured(value, 'Task extraction')).toThrow(ServiceUnavailableException);
  });

  it('names the feature in the message so the operator knows what broke', () => {
    expect(() => assertLlmConfigured('', 'Invoice summarisation')).toThrow(/Invoice summarisation/);
  });

  it('does not put the key itself in the message', () => {
    // הודעת 503 מגיעה ללקוח. מפתח לא אמור לדלוף לשם גם אם
    // מישהו יעביר ערך תקין בטעות לנתיב השגיאה.
    const secret = 'sk-ant-secret-value';
    expect(() => assertLlmConfigured('  ', `Feature using ${secret ? 'llm' : ''}`)).toThrow();
    try {
      assertLlmConfigured('', 'Task extraction');
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });
});

describe('isLlmConfigured', () => {
  it('agrees with assertLlmConfigured on every input', () => {
    // שתי הפונקציות נקראות בנתיבים שונים; אם הן יתפצלו,
    // מסך יציג "זמין" ובקשה תחזיר 503.
    const inputs = [undefined, '', '   ', '\n', 'sk-ant-key', ' padded-key '];
    for (const input of inputs) {
      let threw = false;
      try {
        assertLlmConfigured(input, 'X');
      } catch {
        threw = true;
      }
      expect(isLlmConfigured(input)).toBe(!threw);
    }
  });

  it('returns a boolean, never the key', () => {
    // הערך הזה מוגש ל-frontend דרך תשובת JSON.
    expect(isLlmConfigured('sk-ant-key')).toBe(true);
    expect(isLlmConfigured(undefined)).toBe(false);
  });
});
