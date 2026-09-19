import { createHash, randomBytes } from 'node:crypto';

/**
 * 32 בתים אקראיים = 256 ביט. ניחוש אינו אפשרות מעשית, ולכן הטוקן לבדו
 * יכול לשמש הרשאה לדף של לקוח אחד.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** רק זה נשמר. השוואה ב-DB על hash, לא על הטוקן. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** טוקן שלא יכול להיות שלנו — נדחה בלי לגעת ב-DB. */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
