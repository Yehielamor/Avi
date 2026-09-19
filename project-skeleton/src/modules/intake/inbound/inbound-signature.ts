import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * חתימת בקשות מה-Email Worker של Cloudflare.
 *
 * הכותרת: `X-CraftMind-Signature: t=<unix-seconds>,v1=<hex hmac-sha256>`,
 * על המחרוזת `${t}.${rawBody}`. כמו Stripe: חותמת הזמן בתוך החתימה, כך
 * שבקשה שנתפסה לא ניתנת לשידור חוזר אחרי חלון קצר.
 */
export const SIGNATURE_HEADER = 'x-craftmind-signature';
export const MAX_SKEW_SECONDS = 300;

export function signInbound(secret: string, timestamp: number, rawBody: string | Buffer): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' };

export function verifyInbound(
  header: string | undefined,
  rawBody: Buffer | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureCheck {
  if (!header || !rawBody) return { ok: false, reason: 'missing' };
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
  const t = Number(parts['t']);
  const v1 = parts['v1'];
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowSeconds - t) > MAX_SKEW_SECONDS) return { ok: false, reason: 'stale' };

  const expected = Buffer.from(signInbound(secret, t, rawBody).split('v1=')[1]!, 'hex');
  const given = Buffer.from(v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
