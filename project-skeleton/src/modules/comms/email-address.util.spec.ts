import { normalizeRecipientAddress } from './email-address.util';

/**
 * הכתובת הזו הופכת לכותרת `To:` במייל יוצא מחשבון ה-Gmail של הטננט,
 * והמקור שלה הוא `From` של מייל *נכנס* — כלומר מחרוזת בשליטת תוקף.
 *
 * הבדיקות כאן מכסות את הממצא I23:
 *   • CR/LF/NUL בקלט = הזרקת headers (`\r\nBcc: attacker@evil.com`)
 *   • `X <a@evil.com, victim@target.com>` גרם למייל סיום עבודה, על
 *     פירוט העבודות שבוצעו, להישלח גם לתוקף
 */
describe('normalizeRecipientAddress', () => {
  describe('accepted forms', () => {
    it('accepts a bare address', () => {
      expect(normalizeRecipientAddress('a@b.com')).toBe('a@b.com');
    });

    it('accepts a display-name form and returns only the address', () => {
      expect(normalizeRecipientAddress('Name <a@b.com>')).toBe('a@b.com');
    });

    it('accepts a Hebrew display name', () => {
      expect(normalizeRecipientAddress('ישראל ישראלי <israel@example.co.il>')).toBe(
        'israel@example.co.il',
      );
    });

    it('trims surrounding whitespace', () => {
      expect(normalizeRecipientAddress('  a@b.com  ')).toBe('a@b.com');
      expect(normalizeRecipientAddress('  Name <  a@b.com  >  ')).toBe('a@b.com');
    });

    it.each([
      'first.last@example.com',
      "o'brien@example.com",
      'user+tag@example.co.uk',
      'a_b-c@sub.domain.example.com',
      'x@e-x-ample.com',
    ])('accepts the legitimate address %j', (value) => {
      expect(normalizeRecipientAddress(value)).toBe(value);
    });
  });

  describe('header injection', () => {
    // כל אחד מאלה, אם היה עובר, היה מוסיף כותרת שלמה למייל היוצא.
    it.each([
      ['CR', 'a@b.com\r'],
      ['LF', 'a@b.com\n'],
      ['CRLF + Bcc', 'a@b.com\r\nBcc: attacker@evil.com'],
      ['LF + Bcc', 'a@b.com\nBcc: attacker@evil.com'],
      ['NUL', 'a@b.com\u0000'],
      ['NUL mid-string', 'a@b.com\u0000attacker@evil.com'],
      ['U+2028 line separator', 'a@b.com\u2028Bcc: attacker@evil.com'],
      ['U+2029 paragraph separator', 'a@b.com\u2029Bcc: attacker@evil.com'],
      ['CR before the address', '\r\nBcc: attacker@evil.com\r\na@b.com'],
      ['CRLF inside a display name', 'Name\r\nBcc: attacker@evil.com <a@b.com>'],
      ['CRLF inside the angle brackets', 'Name <a@b.com\r\nBcc: attacker@evil.com>'],
    ])('rejects %s', (_label, value) => {
      expect(normalizeRecipientAddress(value)).toBeNull();
    });
  });

  describe('exactly one recipient', () => {
    // הווקטור המקורי: שתי כתובות בתוך סוגריים אחד, ופרטי העבודה של
    // הלקוח מגיעים גם לתוקף.
    it.each([
      'X <a@evil.com, victim@target.com>',
      'a@b.com, c@d.com',
      'a@b.com,c@d.com',
      'a@b.com; c@d.com',
      'a@b.com;c@d.com',
      '<a@b.com>, <c@d.com>',
      'a@b.com c@d.com',
    ])('rejects the recipient list %j', (value) => {
      expect(normalizeRecipientAddress(value)).toBeNull();
    });

    it.each([
      'Name <<a@b.com>>',
      'Name <a@b.com> <c@d.com>',
      '<a@b.com> trailing',
      'Name <a@b.com> ,',
      'a@b.com>',
      '<a@b.com',
    ])('rejects the nested or unbalanced angle-bracket form %j', (value) => {
      expect(normalizeRecipientAddress(value)).toBeNull();
    });
  });

  describe('malformed input', () => {
    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
      ['no at sign', 'not-an-address'],
      ['no domain', 'a@'],
      ['no local part', '@b.com'],
      ['no TLD', 'a@b'],
      ['two at signs', 'a@b@c.com'],
      ['leading dot in local part', '.a@b.com'],
      ['trailing dot in local part', 'a.@b.com'],
      ['double dot in local part', 'a..b@c.com'],
      ['leading hyphen in domain', 'a@-b.com'],
      ['trailing hyphen in domain', 'a@b-.com'],
      ['empty domain label', 'a@b..com'],
      ['angle brackets with nothing inside', 'Name <>'],
    ])('rejects %s', (_label, value) => {
      expect(normalizeRecipientAddress(value)).toBeNull();
    });

    it.each([null, undefined])('rejects %p', (value) => {
      expect(normalizeRecipientAddress(value)).toBeNull();
    });

    it('rejects a non-string value', () => {
      expect(normalizeRecipientAddress(42 as unknown as string)).toBeNull();
    });
  });

  describe('length limits', () => {
    it('rejects input over 320 characters', () => {
      const local = 'a'.repeat(320);
      expect(normalizeRecipientAddress(`${local}@b.com`)).toBeNull();
    });

    it('rejects an address over 254 characters even inside a short-looking wrapper', () => {
      const address = `${'a'.repeat(250)}@b.com`;
      expect(address.length).toBeGreaterThan(254);
      expect(normalizeRecipientAddress(`N <${address}>`)).toBeNull();
    });

    it('accepts an address just under the limit', () => {
      const address = `${'a'.repeat(240)}@b.com`;
      expect(address.length).toBeLessThanOrEqual(254);
      expect(normalizeRecipientAddress(address)).toBe(address);
    });
  });
});
