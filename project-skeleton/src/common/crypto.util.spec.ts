import {
  DecryptionKeyMissingError,
  currentKeyVersion,
  decryptSecret,
  encryptSecret,
  encryptSecretVersioned,
  needsReEncryption,
} from './crypto.util';

/**
 * מה שמוצפן כאן הוא refresh token של Google — המפתח לתיבת הדואר של
 * העסק. שתי הדרישות שונות זו מזו:
 *
 *   • קריפטוגרפית: AES-GCM חייב *לזרוק* על נתון משובש ולא להחזיר
 *     פלט חלקי, ו-IV חייב להיות חדש בכל הצפנה.
 *   • תפעולית (ממצא M6): בלי סימון גרסת מפתח, החלפת
 *     INTEGRATION_ENCRYPTION_KEY הרגה כל טוקן שמור אצל כל הטננטים.
 */

const KEY_V1 = 'a'.repeat(64);
const KEY_V2 = 'b'.repeat(64);
const KEY_V3 = 'c'.repeat(64);

describe('crypto.util', () => {
  const savedEnv = { ...process.env };

  /** קובע את *כל* משתני ההצפנה מחדש, כדי שדליפה בין טסטים לא תסתיר כשל. */
  const setKeys = (env: Record<string, string | undefined>): void => {
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('INTEGRATION_ENCRYPTION_KEY')) delete process.env[name];
    }
    for (const [name, value] of Object.entries(env)) {
      if (value !== undefined) process.env[name] = value;
    }
  };

  beforeEach(() => {
    setKeys({ INTEGRATION_ENCRYPTION_KEY: KEY_V1 });
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  describe('round trip', () => {
    it('returns the original plaintext', () => {
      const secret = 'ya29.a0AfB_byC-refresh-token';
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
    });

    it.each([
      ['unicode', 'סוד עם עברית ו-emoji 🔐'],
      ['long value', 'x'.repeat(4096)],
      ['colons, which are also the field separator', 'a:b:c:d:e'],
    ])('round-trips %s', (_label, secret) => {
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
    });

    it('reports the key version it used', () => {
      setKeys({ INTEGRATION_ENCRYPTION_KEY: KEY_V2, INTEGRATION_ENCRYPTION_KEY_VERSION: '2' });
      const result = encryptSecretVersioned('s');

      expect(result.keyVersion).toBe(2);
      expect(result.ciphertext.startsWith('v2:')).toBe(true);
    });
  });

  describe('a fresh IV per encryption', () => {
    it('never produces the same blob twice for the same plaintext', () => {
      const blobs = new Set(Array.from({ length: 25 }, () => encryptSecret('same-plaintext')));
      expect(blobs.size).toBe(25);
    });

    it('differs in the IV field specifically, not only in the ciphertext', () => {
      const ivOf = (blob: string): string | undefined => blob.split(':')[1];
      expect(ivOf(encryptSecret('same'))).not.toBe(ivOf(encryptSecret('same')));
    });

    it('uses a 12-byte IV', () => {
      expect(encryptSecret('s').split(':')[1]).toHaveLength(24);
    });
  });

  describe('tampering', () => {
    const parts = (blob: string): [string, string, string, string] => {
      const [v, iv, tag, data] = blob.split(':');
      return [v ?? '', iv ?? '', tag ?? '', data ?? ''];
    };

    it('throws on a flipped ciphertext byte rather than returning garbage', () => {
      const [v, iv, tag, data] = parts(encryptSecret('the-real-token'));
      const flipped = (data[0] === '0' ? '1' : '0') + data.slice(1);

      expect(() => decryptSecret(`${v}:${iv}:${tag}:${flipped}`)).toThrow();
    });

    it('throws on a flipped auth tag byte', () => {
      const [v, iv, tag, data] = parts(encryptSecret('the-real-token'));
      const flipped = (tag[0] === '0' ? '1' : '0') + tag.slice(1);

      expect(() => decryptSecret(`${v}:${iv}:${flipped}:${data}`)).toThrow();
    });

    it('throws on a swapped IV', () => {
      const [v, , tag, data] = parts(encryptSecret('the-real-token'));
      const [, otherIv] = parts(encryptSecret('the-real-token'));

      expect(() => decryptSecret(`${v}:${otherIv}:${tag}:${data}`)).toThrow();
    });

    it('throws when the auth tag of one blob is put on another', () => {
      const [v, iv, , data] = parts(encryptSecret('secret-one'));
      const [, , otherTag] = parts(encryptSecret('secret-two'));

      expect(() => decryptSecret(`${v}:${iv}:${otherTag}:${data}`)).toThrow();
    });

    it('throws on truncated ciphertext', () => {
      const [v, iv, tag, data] = parts(encryptSecret('the-real-token'));
      expect(() => decryptSecret(`${v}:${iv}:${tag}:${data.slice(0, -2)}`)).toThrow();
    });

    it.each([
      ['no separators at all', 'not-encrypted'],
      ['two fields', 'aa:bb'],
      ['five fields', 'v1:aa:bb:cc:dd'],
      ['empty string', ''],
      ['unparseable version', 'vx:aa:bb:cc'],
      ['zero version', 'v0:aa:bb:cc'],
    ])('rejects a malformed blob (%s)', (_label, blob) => {
      expect(() => decryptSecret(blob)).toThrow();
    });
  });

  describe('key rotation', () => {
    it('still decrypts a v1 value after the active key moves to v2', () => {
      // זה בדיוק התרחיש שהרג את כל האינטגרציות: ערך שנכתב לפני
      // הרוטציה חייב להמשיך להיקרא אחריה.
      const blob = encryptSecret('token-written-before-rotation');

      setKeys({
        INTEGRATION_ENCRYPTION_KEY: KEY_V2,
        INTEGRATION_ENCRYPTION_KEY_VERSION: '2',
        INTEGRATION_ENCRYPTION_KEY_V1: KEY_V1,
      });

      expect(decryptSecret(blob)).toBe('token-written-before-rotation');
    });

    it('writes new values under the new key while old ones still read', () => {
      const oldBlob = encryptSecret('old');

      setKeys({
        INTEGRATION_ENCRYPTION_KEY: KEY_V2,
        INTEGRATION_ENCRYPTION_KEY_VERSION: '2',
        INTEGRATION_ENCRYPTION_KEY_V1: KEY_V1,
      });
      const newBlob = encryptSecret('new');

      expect(newBlob.startsWith('v2:')).toBe(true);
      expect(decryptSecret(newBlob)).toBe('new');
      expect(decryptSecret(oldBlob)).toBe('old');
    });

    it('survives two consecutive rotations', () => {
      const v1Blob = encryptSecret('from-v1');

      setKeys({
        INTEGRATION_ENCRYPTION_KEY: KEY_V2,
        INTEGRATION_ENCRYPTION_KEY_VERSION: '2',
        INTEGRATION_ENCRYPTION_KEY_V1: KEY_V1,
      });
      const v2Blob = encryptSecret('from-v2');

      setKeys({
        INTEGRATION_ENCRYPTION_KEY: KEY_V3,
        INTEGRATION_ENCRYPTION_KEY_VERSION: '3',
        INTEGRATION_ENCRYPTION_KEY_V1: KEY_V1,
        INTEGRATION_ENCRYPTION_KEY_V2: KEY_V2,
      });

      expect(decryptSecret(v1Blob)).toBe('from-v1');
      expect(decryptSecret(v2Blob)).toBe('from-v2');
      expect(encryptSecret('now').startsWith('v3:')).toBe(true);
    });

    it('reports a missing old key distinctly from corrupt data', () => {
      // "המפתח לא כאן" ניתן לתיקון ב-deploy; "הנתון משובש" מחייב
      // חיבור מחדש של האינטגרציה. הקורא חייב להבחין ביניהם.
      const blob = encryptSecret('orphan');

      setKeys({ INTEGRATION_ENCRYPTION_KEY: KEY_V2, INTEGRATION_ENCRYPTION_KEY_VERSION: '2' });

      expect(() => decryptSecret(blob)).toThrow(DecryptionKeyMissingError);
      try {
        decryptSecret(blob);
        fail('expected a throw');
      } catch (err) {
        expect(err).toBeInstanceOf(DecryptionKeyMissingError);
        expect((err as DecryptionKeyMissingError).keyVersion).toBe(1);
        expect((err as Error).message).toContain('INTEGRATION_ENCRYPTION_KEY_V1');
      }
    });

    it('does not decrypt a v1 blob with the v2 key', () => {
      const blob = encryptSecret('orphan');

      setKeys({
        INTEGRATION_ENCRYPTION_KEY: KEY_V2,
        INTEGRATION_ENCRYPTION_KEY_VERSION: '2',
        INTEGRATION_ENCRYPTION_KEY_V1: KEY_V2, // המפתח הלא נכון תחת השם הנכון
      });

      expect(() => decryptSecret(blob)).toThrow();
    });
  });

  describe('legacy blobs written before versioning existed', () => {
    const legacy = (blob: string): string => blob.split(':').slice(1).join(':');

    it('reads a three-part blob as version 1', () => {
      const blob = legacy(encryptSecret('pre-versioning'));
      expect(blob.split(':')).toHaveLength(3);
      expect(decryptSecret(blob)).toBe('pre-versioning');
    });

    it('uses the row key version when the blob carries none', () => {
      setKeys({ INTEGRATION_ENCRYPTION_KEY: KEY_V2, INTEGRATION_ENCRYPTION_KEY_VERSION: '2' });
      const blob = legacy(encryptSecret('written-under-v2'));

      setKeys({
        INTEGRATION_ENCRYPTION_KEY: KEY_V3,
        INTEGRATION_ENCRYPTION_KEY_VERSION: '3',
        INTEGRATION_ENCRYPTION_KEY_V2: KEY_V2,
      });

      expect(decryptSecret(blob, 2)).toBe('written-under-v2');
    });
  });

  describe('key configuration', () => {
    it('throws when the key is missing', () => {
      setKeys({});
      expect(() => encryptSecret('s')).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
    });

    it('throws when the key is empty', () => {
      setKeys({ INTEGRATION_ENCRYPTION_KEY: '' });
      expect(() => encryptSecret('s')).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
    });

    it.each([
      ['too short', 'a'.repeat(32)],
      ['too long', 'a'.repeat(128)],
      ['odd length', 'a'.repeat(63)],
      ['not hex', 'z'.repeat(64)],
      ['base64-looking', `${'a'.repeat(62)}==`],
    ])('throws on a %s key', (_label, key) => {
      setKeys({ INTEGRATION_ENCRYPTION_KEY: key });
      expect(() => encryptSecret('s')).toThrow(/64-char hex/);
    });

    it('accepts upper-case hex', () => {
      setKeys({ INTEGRATION_ENCRYPTION_KEY: 'A'.repeat(64) });
      expect(decryptSecret(encryptSecret('s'))).toBe('s');
    });

    it('fails at use, not at import', () => {
      // המודול כבר נטען למעלה עם env ריק לחלוטין בזמן ה-import,
      // ובכל זאת הטסטים כאן רצים — כלומר אין קריאה ל-env בזמן טעינה.
      setKeys({});
      expect(() => currentKeyVersion()).not.toThrow();
      expect(() => encryptSecret('s')).toThrow();
    });

    it.each(['0', '-1', '1.5', 'two', ''])(
      'rejects the key version %j at use',
      (version) => {
        setKeys({ INTEGRATION_ENCRYPTION_KEY: KEY_V1, INTEGRATION_ENCRYPTION_KEY_VERSION: version });
        if (version === '') {
          // ערך ריק הוא "לא הוגדר" — ברירת המחדל היא 1.
          expect(currentKeyVersion()).toBe(1);
        } else {
          expect(() => currentKeyVersion()).toThrow(/positive integer/);
        }
      },
    );

    it('defaults to version 1', () => {
      expect(currentKeyVersion()).toBe(1);
    });
  });

  describe('needsReEncryption', () => {
    it('is false for a blob written under the active key', () => {
      expect(needsReEncryption(encryptSecret('s'))).toBe(false);
    });

    it('is true for a blob written under an older key', () => {
      const blob = encryptSecret('s');
      setKeys({
        INTEGRATION_ENCRYPTION_KEY: KEY_V2,
        INTEGRATION_ENCRYPTION_KEY_VERSION: '2',
        INTEGRATION_ENCRYPTION_KEY_V1: KEY_V1,
      });
      expect(needsReEncryption(blob)).toBe(true);
    });

    it('treats an unversioned blob as version 1 unless the row says otherwise', () => {
      const blob = encryptSecret('s').split(':').slice(1).join(':');
      expect(needsReEncryption(blob)).toBe(false);

      setKeys({ INTEGRATION_ENCRYPTION_KEY: KEY_V2, INTEGRATION_ENCRYPTION_KEY_VERSION: '2' });
      expect(needsReEncryption(blob)).toBe(true);
      expect(needsReEncryption(blob, 2)).toBe(false);
    });
  });
});
