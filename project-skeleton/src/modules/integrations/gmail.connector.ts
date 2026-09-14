import { Logger } from '@nestjs/common';
import { google, gmail_v1 } from 'googleapis';

import { Connector } from './connector.interface';
import { callExternal } from './external-call.util';
import { GoogleAuthClient } from './google-oauth.service';

export interface ParsedEmail {
  gmailMessageId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  bodyText: string;
  receivedAt: Date;
}

export interface FetchEmailsResult {
  emails: ParsedEmail[];
  /** ה-`historyId` הגבוה ביותר שנראה — נשמר כ-`syncCursor`. */
  cursor: string | null;
  /** true אם נעצרנו בתקרה ולא מיצינו את כל התוצאות. */
  truncated: boolean;
}

// ============================================================
// Gmail Connector - מסמך הארכיטקטורה, סעיף 3.2.
//
// ------------------------------------------------------------
// ארבעה באגים שתוקנו כאן
// ------------------------------------------------------------
//
// 1. **עימוד.** `messages.list` נקרא פעם אחת ו-`nextPageToken` הוזנח
//    לחלוטין. עם יותר מ-`maxResults` מיילים שלא נקראו, המיילים
//    *הישנים* — הפניות שממתינות הכי הרבה זמן — לא נקלטו לעולם.
//    עכשיו: לולאת עימוד עם תקרה קשיחה.
//
// 2. **watermark.** במקום `is:unread` בלבד, השאילתה נחתכת ב-`after:`
//    לפי `lastSyncedAt`, עם חפיפה לאחור לשעה. בלי זה כל סנכרון סורק
//    את כל תיבת הדואר מחדש.
//
// 3. **גוף HTML.** `extractBodyText` טיפל רק ב-`text/plain` והחזיר
//    מחרוזת ריקה למייל HTML-בלבד — רוב הדואר האמיתי. הפנייה הגיעה
//    ל-LLM ריקה, כלומר בלי שום מידע לחלץ ממנו.
//
// 4. **קידוד.** ה-charset המוצהר (`windows-1255` בעברית מ-Outlook)
//    ו-`quoted-printable` לא טופלו, והתוצאה הייתה ג'יבריש שנשמר
//    כתיאור המשימה.
// ============================================================

const MAX_PAGES = 10;
const DEFAULT_PAGE_SIZE = 50;
const HARD_MESSAGE_CAP = 200;
/** חפיפה לאחור: `internalDate` ו-`after:` לא מסונכרנים לשנייה, וגבול חד מפספס מיילים על הקצה. */
const WATERMARK_OVERLAP_MS = 60 * 60 * 1_000;

export class GmailConnector implements Connector {
  readonly provider = 'GMAIL';
  private readonly logger = new Logger(GmailConnector.name);
  private readonly gmail: gmail_v1.Gmail;

  constructor(private readonly authClient: GoogleAuthClient) {
    this.gmail = google.gmail({ version: 'v1', auth: authClient });
  }

  // לא `async`: אין כאן await, וה-interface מחייב Promise. `async`
  // ריק מפעיל את require-await ומסתיר מתי באמת יש קריאת רשת.
  ensureAuthenticated(): Promise<void> {
    if (!this.authClient.credentials.refresh_token) {
      return Promise.reject(new Error('GmailConnector: no refresh_token set on auth client'));
    }
    return Promise.resolve();
  }

  async fetch<T = FetchEmailsResult>(
    resource: string,
    filter: Record<string, unknown> = {},
  ): Promise<T> {
    if (resource !== 'unread_messages') {
      throw new Error(`GmailConnector.fetch: unsupported resource "${resource}"`);
    }

    const pageSize = Math.min(
      Number(filter.maxResults ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE,
      100,
    );
    const maxMessages = Math.min(
      Number(filter.maxMessages ?? HARD_MESSAGE_CAP) || HARD_MESSAGE_CAP,
      HARD_MESSAGE_CAP,
    );
    const since = filter.since instanceof Date ? filter.since : null;

    const emails: ParsedEmail[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    let truncated = false;
    let cursor: string | null = null;

    do {
      const token = pageToken;
      const list = await callExternal(
        () =>
          this.gmail.users.messages.list({
            userId: 'me',
            q: this.buildQuery(since),
            maxResults: pageSize,
            pageToken: token,
          }),
        { label: 'Gmail messages.list', timeoutMs: 20_000 },
      );

      for (const { id } of list.data.messages ?? []) {
        if (!id) continue;
        if (emails.length >= maxMessages) {
          truncated = true;
          break;
        }

        const full = await callExternal(
          () => this.gmail.users.messages.get({ userId: 'me', id, format: 'full' }),
          { label: 'Gmail messages.get', timeoutMs: 20_000 },
        );
        const parsed = this.parseMessage(full.data);
        emails.push(parsed);

        // historyId מונוטוני עולה לכל התיבה — מתאים בדיוק כ-cursor.
        const historyId = full.data.historyId;
        if (historyId && (cursor === null || BigInt(historyId) > BigInt(cursor))) {
          cursor = historyId;
        }
      }

      pageToken = list.data.nextPageToken ?? undefined;
      pages++;

      if (pageToken && (pages >= MAX_PAGES || emails.length >= maxMessages)) {
        // עצירה מבוקרת ולא שקטה: הריצה הבאה תמשיך מכאן דרך
        // ה-watermark, ובינתיים מישהו רואה בלוג שיש פיגור.
        truncated = true;
        this.logger.warn(
          { pages, fetched: emails.length },
          'Gmail sync stopped at the page cap with results still pending; next run will continue',
        );
        break;
      }
    } while (pageToken);

    return { emails, cursor, truncated } as unknown as T;
  }

  /**
   * `is:unread` לבדו סורק את כל התיבה בכל ריצה. `after:` חותך לפי
   * ה-watermark — Gmail מקבל שם חותמת זמן ב-epoch seconds.
   */
  private buildQuery(since: Date | null): string {
    if (!since) return 'is:unread';
    const afterSeconds = Math.floor((since.getTime() - WATERMARK_OVERLAP_MS) / 1_000);
    return `is:unread after:${Math.max(afterSeconds, 0)}`;
  }

  async send<T = { messageId: string }>(resource: string, payload: unknown): Promise<T> {
    if (resource !== 'message') {
      throw new Error(`GmailConnector.send: unsupported resource "${resource}"`);
    }
    const { to, subject, body, threadId } = payload as {
      to: string;
      subject: string;
      body: string;
      threadId?: string;
    };

    const raw = this.buildRawMessage(to, subject, body);
    const res = await callExternal(
      () => this.gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId } }),
      { label: 'Gmail messages.send', timeoutMs: 20_000 },
    );

    return { messageId: res.data.id ?? '' } as unknown as T;
  }

  /** מסמן מייל כנקרא, כדי שלא ייקלט שוב בריצה הבאה. */
  async markRead(messageId: string): Promise<void> {
    await callExternal(
      () =>
        this.gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: { removeLabelIds: ['UNREAD'] },
        }),
      { label: 'Gmail messages.modify', timeoutMs: 15_000 },
    );
  }

  // ============================================================
  // push notifications אמיתיות (Gmail API watch) דורשות GCP Pub/Sub —
  // תלוי סביבה, לא רק ב-OAuth. ב-MVP הסנכרון הוא polling.
  // ============================================================
  subscribe(_event: string): Promise<string | null> {
    this.logger.warn(
      'GmailConnector.subscribe: Gmail push (watch) requires GCP Pub/Sub - using polling',
    );
    return Promise.resolve(null);
  }

  private parseMessage(msg: gmail_v1.Schema$Message): ParsedEmail {
    const headers = msg.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

    return {
      gmailMessageId: msg.id ?? '',
      threadId: msg.threadId ?? '',
      from: decodeMimeWords(getHeader('From')),
      subject: decodeMimeWords(getHeader('Subject')),
      snippet: decodeHtmlEntities(msg.snippet ?? ''),
      bodyText: this.extractBodyText(msg.payload),
      receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
    };
  }

  /**
   * מעדיף `text/plain`, ונופל ל-`text/html` שמומר לטקסט. הגרסה
   * הקודמת החזירה '' למייל HTML-בלבד, כלומר לרוב הדואר האמיתי.
   */
  private extractBodyText(part?: gmail_v1.Schema$MessagePart): string {
    if (!part) return '';
    const plain = this.findPart(part, 'text/plain');
    if (plain) return plain;
    const html = this.findPart(part, 'text/html');
    return html ? htmlToText(html) : '';
  }

  private findPart(part: gmail_v1.Schema$MessagePart, mimeType: string): string {
    if (part.mimeType === mimeType && part.body?.data) {
      return this.decodePartBody(part);
    }
    for (const sub of part.parts ?? []) {
      const found = this.findPart(sub, mimeType);
      if (found) return found;
    }
    return '';
  }

  /**
   * שלוש שכבות פענוח, שכולן היו חסרות:
   *   base64url (זה מה ש-Gmail מחזיר תמיד)
   *   → quoted-printable, אם `Content-Transfer-Encoding` אומר זאת
   *   → ה-charset המוצהר. עברית מ-Outlook מגיעה ב-`windows-1255`,
   *     ופענוח שלה כ-UTF-8 מייצר ג'יבריש שנשמר כתיאור המשימה.
   */
  private decodePartBody(part: gmail_v1.Schema$MessagePart): string {
    const data = part.body?.data;
    if (!data) return '';

    let buffer: Buffer = Buffer.from(data, 'base64url');

    const headers = part.headers ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name)?.value ?? '';

    if (/quoted-printable/i.test(header('content-transfer-encoding'))) {
      buffer = decodeQuotedPrintable(buffer);
    }

    const charset =
      /charset="?([^";]+)"?/i.exec(part.mimeType ?? '')?.[1] ??
      /charset="?([^";]+)"?/i.exec(header('content-type'))?.[1] ??
      'utf-8';

    return decodeBuffer(buffer, charset);
  }

  private buildRawMessage(to: string, subject: string, body: string): string {
    // CRLF בכותרת = header injection (Bcc זר, נמען נוסף). כתובות
    // נבדקות בשכבה שמעליה; כאן נחתך כל מה שיכול לפצל כותרת.
    const safeTo = to.replace(/[\r\n]+/g, ' ').trim();

    const message = [
      `To: ${safeTo}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body,
    ].join('\r\n');

    return Buffer.from(message, 'utf8').toString('base64url');
  }
}

// ---------------------------------------------------------------------------
// עזרי פענוח. פונקציות חופשיות כדי שיהיו ניתנות לבדיקה בלי OAuth client.
// ---------------------------------------------------------------------------

/**
 * `TextDecoder` של Node תומך ב-windows-1255/1252/iso-8859-8 כשה-build
 * כולל ICU מלא. Alpine עם `small-icu` לא — ולכן יש fallback ל-latin1
 * במקום זריקה, כדי שמייל אחד בקידוד חריג לא יפיל את כל הסנכרון.
 */
export function decodeBuffer(buffer: Buffer, charset: string): string {
  const normalized = charset.trim().toLowerCase();
  if (normalized === 'utf-8' || normalized === 'utf8' || normalized === 'us-ascii') {
    return buffer.toString('utf8');
  }
  try {
    return new TextDecoder(normalized, { fatal: false }).decode(buffer);
  } catch {
    return buffer.toString('latin1');
  }
}

/** RFC 2045 §6.7. */
export function decodeQuotedPrintable(buffer: Buffer): Buffer {
  const text = buffer.toString('latin1');
  const unfolded = text.replace(/=(?:\r\n|\n|\r)/g, ''); // soft line breaks
  const bytes: number[] = [];

  for (let i = 0; i < unfolded.length; i++) {
    const ch = unfolded[i];
    if (ch === undefined) continue;
    if (ch === '=' && i + 2 < unfolded.length) {
      const hex = unfolded.slice(i + 1, i + 3);
      if (/^[0-9a-f]{2}$/i.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(ch.charCodeAt(0) & 0xff);
  }

  return Buffer.from(bytes);
}

/**
 * RFC 2047 encoded-words בכותרות: `=?windows-1255?B?...?=`.
 * בלי זה, שם שולח בעברית נשמר כמחרוזת המקודדת עצמה ומגיע ככה ל-CRM.
 */
export function decodeMimeWords(value: string): string {
  if (!value.includes('=?')) return value;

  return value.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_match, charset: string, encoding: string, payload: string) => {
      try {
        if (encoding.toLowerCase() === 'b') {
          return decodeBuffer(Buffer.from(payload, 'base64'), charset);
        }
        // Q-encoding: '_' הוא רווח, והשאר quoted-printable.
        return decodeBuffer(
          decodeQuotedPrintable(Buffer.from(payload.replace(/_/g, ' '), 'latin1')),
          charset,
        );
      } catch {
        return payload; // כותרת משובשת לא שווה נפילה
      }
    },
  );
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * המרת HTML לטקסט. מכוון: מספיק כדי ש-ה-LLM יקבל את תוכן הפנייה,
 * לא מנוע רינדור. `script`/`style` מוסרים על תוכנם — אחרת CSS שלם
 * נספר כטקסט הפנייה ואוכל את תקציב הטוקנים.
 */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}
