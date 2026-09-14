// ============================================================
// אימות כתובת נמען לפני שהיא הופכת לכותרת `To:` יוצאת.
//
// הכתובת ב-Customer.email מגיעה מכותרת `From` של מייל נכנס — כלומר
// מקלט של תוקף. GmailConnector.buildRawMessage משרשר אותה גולמית
// לתוך `To: ${to}`, ולכן CR/LF בתוכה הוא primitive של header injection:
// מייל אחד עם `From: a@b.com\r\nBcc: attacker@evil.com` הופך כל מייל
// יוצא לעותק שקט לתוקף. ראו docs/20-backend-conventions.md סעיף 10.
//
// הבדיקה כאן היא allow-list מכוונת-צמצום: כתובת אחת, בלי פסיקים,
// בלי כותרות מקוננות. עדיף לדחות כתובת אקזוטית-אך-חוקית מאשר לתת
// ל-CRLF לעבור.
// ============================================================

const LOCAL_PART = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*";
const DOMAIN = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+';
const ADDRESS_RE = new RegExp(`^${LOCAL_PART}@${DOMAIN}$`);

/**
 * תווים שאסור שיופיעו בשום מקום בקלט. CR/LF הם וקטור ההזרקה עצמו,
 * ו-NUL חותך מחרוזות בשכבות נמוכות יותר.
 */
const FORBIDDEN_RE = /[\r\n\x00\u2028\u2029]/;

/**
 * מחזירה כתובת בודדת מנורמלת, או null אם הקלט אינו כתובת יחידה תקינה.
 * מקבלת גם `שם <a@b.com>` וגם `a@b.com` גולמי.
 */
export function normalizeRecipientAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 320) return null;
  if (FORBIDDEN_RE.test(raw)) return null;

  const trimmed = raw.trim();

  // צורת display-name יחידה בלבד. `a@b.com, c@d.com` או כותרת מקוננת
  // לא יתאימו ל-anchor הזה וייפלו.
  const angled = /^[^<>]*<([^<>]+)>$/.exec(trimmed);
  const captured = angled?.[1];
  const address = (captured ?? trimmed).trim();

  if (address.length === 0 || address.length > 254) return null;
  // נמען אחד. רשימת תפוצה דרך השדה הזה היא תמיד באג, לא פיצ'ר.
  if (/[,;\s]/.test(address)) return null;
  if (!ADDRESS_RE.test(address)) return null;

  return address;
}
