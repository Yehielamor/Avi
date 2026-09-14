import * as crypto from 'crypto';

// ============================================================
// הצפנת טוקנים at-rest לפני כתיבה ל-TenantIntegration
// (מסמך הארכיטקטורה, סעיף 3.3: "טוקנים מוצפנים at-rest").
//
// AES-256-GCM: authenticated encryption - גם מצפין וגם מזהה
// שיבוש/זיוף של הנתון המוצפן (auth tag). הקריפטו עצמו היה תקין;
// מה שחסר היה *גרסאות מפתח*.
//
// למה גרסאות (audit M6): כשמחליפים את INTEGRATION_ENCRYPTION_KEY,
// כל טוקן ששמור ב-DB הוצפן במפתח הישן. בלי לדעת באיזה מפתח כל
// שורה הוצפנה, רוטציה = כל האינטגרציות של כל הטננטים מתות בבת אחת,
// והשגיאה שמתקבלת ("Unsupported state or unable to authenticate data")
// לא מרמזת על הסיבה.
//
// ------------------------------------------------------------
// קונפיגורציה
// ------------------------------------------------------------
//   INTEGRATION_ENCRYPTION_KEY            - המפתח *הנוכחי* (64 תווי hex)
//   INTEGRATION_ENCRYPTION_KEY_VERSION    - מספר הגרסה שלו (ברירת מחדל 1)
//   INTEGRATION_ENCRYPTION_KEY_V<N>       - מפתחות ישנים, לפענוח בלבד
//
// נוהל רוטציה:
//   1. INTEGRATION_ENCRYPTION_KEY_V1 = <המפתח הישן>
//   2. INTEGRATION_ENCRYPTION_KEY = <מפתח חדש>, ..._VERSION = 2
//   3. deploy. כתיבות חדשות בגרסה 2, קריאות ישנות עדיין עובדות.
//   4. re-encrypt ברקע, ואז אפשר להסיר את V1.
//
// ------------------------------------------------------------
// פורמט אחסון
// ------------------------------------------------------------
//   v<version>:<iv>:<authTag>:<ciphertext>   (הכל hex)
//
// הפורמט הישן (`iv:authTag:ciphertext`, שלושה חלקים) עדיין נקרא
// ומטופל כגרסה 1 — שורות קיימות ב-DB לא נשברות.
// ============================================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // מומלץ ל-GCM
const KEY_HEX_LENGTH = 64; // 32 בתים
const LEGACY_KEY_VERSION = 1;

const KEY_GEN_HINT =
  "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";

function parseKeyHex(keyHex: string | undefined, envName: string): Buffer {
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error(
      `${envName} must be set to a ${KEY_HEX_LENGTH}-char hex string (32 bytes). ${KEY_GEN_HINT}`,
    );
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * גרסת המפתח שבה מוצפנות כתיבות חדשות.
 *
 * נקרא מ-`process.env` בכל קריאה ולא נשמר ב-module scope בכוונה:
 * הטסטים מחליפים מפתחות תוך כדי ריצה כדי להוכיח שרוטציה עובדת,
 * ו-cache ברמת המודול היה הופך את זה לבלתי ניתן לבדיקה.
 */
export function currentKeyVersion(): number {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY_VERSION;
  if (!raw) return LEGACY_KEY_VERSION;
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(
      `INTEGRATION_ENCRYPTION_KEY_VERSION must be a positive integer, got ${JSON.stringify(raw)}`,
    );
  }
  return version;
}

function getKeyForVersion(version: number): Buffer {
  // הגרסה הנוכחית יושבת על שם המשתנה ה"נקי", כדי שהמפתח הפעיל
  // ייקרא תמיד מאותו מקום ולא ייעלם כשמעלים גרסה.
  if (version === currentKeyVersion()) {
    return parseKeyHex(process.env.INTEGRATION_ENCRYPTION_KEY, 'INTEGRATION_ENCRYPTION_KEY');
  }

  const envName = `INTEGRATION_ENCRYPTION_KEY_V${version}`;
  const keyHex = process.env[envName];
  if (!keyHex) {
    throw new DecryptionKeyMissingError(version, envName);
  }
  return parseKeyHex(keyHex, envName);
}

/**
 * מפתח לגרסה שנשמרה בשורה חסר מהסביבה. טיפוס נפרד כדי שה-caller
 * יוכל להבדיל בין "המפתח לא כאן" (בעיית deploy — ניתנת לתיקון)
 * לבין "הנתון משובש" (טוקן שנפסל, צריך חיבור מחדש).
 */
export class DecryptionKeyMissingError extends Error {
  constructor(
    readonly keyVersion: number,
    envName: string,
  ) {
    super(
      `No encryption key available for version ${keyVersion}. Set ${envName} to the key that ` +
        `was active when this secret was written, or re-connect the integration.`,
    );
    this.name = 'DecryptionKeyMissingError';
  }
}

export interface EncryptedSecret {
  /** ה-blob לכתיבה לעמודת `*Encrypted`. */
  ciphertext: string;
  /** לכתיבה ל-`TenantIntegration.encryptionKeyVersion`. */
  keyVersion: number;
}

/**
 * מצפין ומחזיר גם את גרסת המפתח, כדי שהקורא יכתוב אותה לשורה.
 * הגרסה מוטבעת גם ב-blob עצמו — שני המקורות קיימים בכוונה, כך
 * שגם blob שהועתק בין עמודות עדיין ניתן לפענוח.
 */
export function encryptSecretVersioned(plaintext: string): EncryptedSecret {
  const keyVersion = currentKeyVersion();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKeyForVersion(keyVersion), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: `v${keyVersion}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`,
    keyVersion,
  };
}

/** עטיפה נוחה כשהקורא לא צריך את מספר הגרסה בנפרד. */
export function encryptSecret(plaintext: string): string {
  return encryptSecretVersioned(plaintext).ciphertext;
}

/**
 * @param stored ה-blob מה-DB.
 * @param rowKeyVersion הערך מעמודת `encryptionKeyVersion`, כ-fallback
 *   ל-blob-ים בפורמט הישן שאין בהם קידומת גרסה.
 */
export function decryptSecret(stored: string, rowKeyVersion?: number | null): string {
  const parts = stored.split(':');

  let keyVersion: number;
  let ivHex: string | undefined;
  let authTagHex: string | undefined;
  let dataHex: string | undefined;

  if (parts.length === 4 && parts[0]?.startsWith('v')) {
    const parsed = Number(parts[0].slice(1));
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error('Invalid encrypted secret format: unparseable key version');
    }
    keyVersion = parsed;
    [, ivHex, authTagHex, dataHex] = parts;
  } else if (parts.length === 3) {
    // פורמט קדם-גרסאות. השורות האלה נכתבו לפני שהעמודה קיימת, ולכן
    // הן בהכרח במפתח הראשון — אלא אם השורה אומרת אחרת.
    keyVersion = rowKeyVersion ?? LEGACY_KEY_VERSION;
    [ivHex, authTagHex, dataHex] = parts;
  } else {
    throw new Error('Invalid encrypted secret format');
  }

  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error('Invalid encrypted secret format');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKeyForVersion(keyVersion),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

/** האם ה-blob הזה צריך הצפנה מחדש במפתח הנוכחי (לעובד רוטציה). */
export function needsReEncryption(stored: string, rowKeyVersion?: number | null): boolean {
  const parts = stored.split(':');
  const blobVersion =
    parts.length === 4 && parts[0]?.startsWith('v')
      ? Number(parts[0].slice(1))
      : (rowKeyVersion ?? LEGACY_KEY_VERSION);
  return blobVersion !== currentKeyVersion();
}
