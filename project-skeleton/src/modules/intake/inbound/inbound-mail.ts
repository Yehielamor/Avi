import { createHash, randomBytes } from 'node:crypto';

/* ---------------------------------------------------------------------------
   החלקים הטהורים של קליטת מייל בהעברה — בלי DB ובלי רשת.
   --------------------------------------------------------------------------- */

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * החלק המקומי של כתובת קליטה: `<subdomain>-<10 תווים אקראיים>`.
 * התחילית מאפשרת לבעל העסק לזהות את הכתובת; 50 ביט אקראיים הם מה
 * שמונע מזר לנחש אותה ולהזרים משימות לעסק.
 */
export function generateLocalPart(subdomain: string): string {
  const slug = subdomain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'biz';
  const bytes = randomBytes(10);
  const rand = Array.from(bytes, (b) => BASE32[b % 32]).join('');
  return `${slug}-${rand}`;
}

/**
 * מתוך `To` (יכול להיות "שם <a@b>", כמה נמענים, או +תג) — החלק המקומי של
 * הכתובת שלנו בדומיין הקליטה. אחרת null.
 */
export function localPartFor(to: string, domain: string): string | null {
  const want = `@${domain.toLowerCase()}`;
  for (const m of to.toLowerCase().matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g)) {
    const addr = m[0];
    if (!addr.endsWith(want)) continue;
    const local = addr.slice(0, -want.length).split('+')[0]!;
    if (/^[a-z0-9-]{3,60}$/.test(local)) return local;
  }
  return null;
}

export interface InboundMessage {
  from: string;
  subject: string;
  text: string;
  messageId?: string;
  autoSubmitted?: string;
  precedence?: string;
  listId?: string;
}

/**
 * Gmail שולח לכתובת העברה חדשה מייל עם קוד אישור. זה לא פנייה של לקוח —
 * זה הצעד שבעל העסק צריך כדי להשלים את ההגדרה.
 */
export function gmailVerification(msg: InboundMessage): { code: string | null; url: string | null } | null {
  if (!/forwarding-noreply@google\.com/i.test(msg.from)) return null;
  const code = /(?:^|\D)(\d{9})(?:\D|$)/.exec(`${msg.subject}\n${msg.text}`)?.[1] ?? null;
  const url = /https:\/\/(?:mail(?:-settings)?\.google\.com|isolated\.mail\.google\.com)\/\S+/i.exec(msg.text)?.[0] ?? null;
  return { code, url };
}

/**
 * הודעות אוטומטיות לא הופכות למשימה: תשובות "מחוץ למשרד", החזרות דואר,
 * רשימות תפוצה. בלי זה, תשובה אוטומטית ללקוח הייתה חוזרת אלינו כמשימה,
 * ולולאת תשובות אוטומטיות הייתה ממלאת את לוח המשימות.
 */
export function automatedReason(msg: InboundMessage): string | null {
  if (msg.autoSubmitted && msg.autoSubmitted.trim().toLowerCase() !== 'no') return 'auto-submitted';
  if (/^(bulk|list|junk|auto_reply)$/i.test(msg.precedence?.trim() ?? '')) return 'bulk';
  if (msg.listId?.trim()) return 'mailing-list';
  if (/(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(msg.from)) return 'no-reply sender';
  return null;
}

/**
 * העברה ידנית ("Forward") במקום העברה אוטומטית: השולח הוא בעל העסק עצמו,
 * והלקוח האמיתי נמצא בכותרת ההודעה המקורית בגוף. Gmail מסמן אותה בשורה
 * "---------- Forwarded message ---------" (או "הודעה שהועברה" בעברית).
 */
export function unwrapForwarded(text: string): { from: string; subject: string | null; body: string } | null {
  const marker = /-{5,}\s*(?:forwarded message|הודעה שהועברה|הודעה מועברת)\s*-{5,}/i.exec(text);
  if (!marker) return null;
  const rest = text.slice(marker.index + marker[0].length);
  const from = /^\s*(?:from|מאת):\s*(.+)$/im.exec(rest)?.[1]?.trim();
  if (!from) return null;
  const subject = /^\s*(?:subject|נושא):\s*(.+)$/im.exec(rest)?.[1]?.trim() ?? null;
  // הגוף מתחיל אחרי השורה הריקה הראשונה שאחרי הכותרות.
  const headerEnd = rest.search(/\n\s*\n/);
  const body = headerEnd >= 0 ? rest.slice(headerEnd).trim() : rest.trim();
  return { from, subject, body };
}

/**
 * מזהה יציב להודעה, לסינון כפילויות (Worker שמנסה שוב, העברה כפולה).
 * Message-ID כשיש; אחרת hash של התוכן — שתי שליחות זהות הן אותה הודעה.
 */
export function sourceIdFor(msg: InboundMessage): string {
  const mid = msg.messageId?.trim().replace(/^<|>$/g, '').toLowerCase();
  if (mid && mid.length <= 250) return `mid:${mid}`;
  const h = createHash('sha256').update(`${msg.from}\n${msg.subject}\n${msg.text}`).digest('hex').slice(0, 40);
  return `hash:${h}`;
}
