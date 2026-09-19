import PostalMime from 'postal-mime';

/**
 * Email Worker: כל מייל שמגיע ל-*@in.craftmind-ai.com.
 *
 * מפרק את ה-MIME, שולח לשרת טקסט בלבד (קבצים מצורפים — שמות, לא תוכן),
 * חתום ב-HMAC. תשובת השרת קובעת מה קורה למייל:
 *   2xx — נקלט (או זוהה ככפול / אוטומטי — מבחינת השולח, נמסר).
 *   404 — כתובת לא מוכרת: דוחים מול השולח, כמו תיבה שלא קיימת.
 *   אחר — זורקים. Cloudflare מחזיר כשל זמני, והשרת השולח ינסה שוב.
 */
export interface Env {
  API_URL: string;
  INBOUND_EMAIL_SECRET: string;
}

const MAX_TEXT = 150_000;

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const parsed = await PostalMime.parse(message.raw);
    const text = (parsed.text ?? htmlToText(parsed.html ?? '')).slice(0, MAX_TEXT);

    const body = JSON.stringify({
      to: message.to,
      from: parsed.from ? formatAddress(parsed.from) : message.from,
      subject: parsed.subject ?? '',
      text,
      messageId: parsed.messageId ?? undefined,
      autoSubmitted: message.headers.get('auto-submitted') ?? undefined,
      precedence: message.headers.get('precedence') ?? undefined,
      listId: message.headers.get('list-id') ?? undefined,
      attachments: (parsed.attachments ?? []).slice(0, 50).map((a) => (a.filename ?? 'ללא שם').slice(0, 300)),
    });

    const t = Math.floor(Date.now() / 1000);
    const res = await fetch(env.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CraftMind-Signature': `t=${t},v1=${await hmacHex(env.INBOUND_EMAIL_SECRET, `${t}.${body}`)}`,
      },
      body,
    });

    if (res.ok) return;
    if (res.status === 404) {
      message.setReject('Unknown address');
      return;
    }
    throw new Error(`CraftMind API answered ${res.status}`);
  },
};

function formatAddress(a: { name?: string; address?: string }): string {
  return a.name ? `${a.name} <${a.address ?? ''}>` : (a.address ?? '');
}

/** מייל שיש לו רק HTML (נפוץ במייל מטלפון): טקסט גס, מספיק ל-LLM. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
