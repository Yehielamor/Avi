// חילוץ שם+מייל מכותרת "From" גולמית, למשל:
// 'ישראל ישראלי <israel@example.com>' -> { name: 'ישראל ישראלי', email: 'israel@example.com' }
//
// הגרסה הקודמת ניגשה ל-`match[1]`/`match[2]` ישירות. תחת
// `noUncheckedIndexedAccess` זו שגיאת קומפילציה, ובזמן ריצה זו
// הייתה נפילה על כותרת שלא תאמה את הצורה שהצפינו לה.

const ADDRESS_RE = /^(.*?)\s*<([^<>]+)>\s*$/;
// לא אימות RFC 5322 מלא — רק סינון של מה שלא יכול להיות כתובת.
// כתובת שנכשלת כאן לא הופכת ל-`To:` יוצא (docs/20-backend-conventions.md §10).
const EMAIL_RE = /^[^\s@,;:<>"']+@[^\s@,;:<>"'.]+(?:\.[^\s@,;:<>"'.]+)+$/;

export interface ParsedFrom {
  name: string;
  email: string;
  /** false כשלא הצלחנו לחלץ כתובת שנראית תקינה. */
  isValidEmail: boolean;
}

export function parseFromHeader(raw: string): ParsedFrom {
  const value = raw.trim();

  const match = ADDRESS_RE.exec(value);
  const email = (match?.[2] ?? value).trim().replace(/[\r\n]/g, '');
  const rawName = match?.[1]?.replace(/["']/g, '').trim() ?? '';

  const isValidEmail = EMAIL_RE.test(email);

  return {
    // שם ריק (כותרת שהיא כתובת בלבד) נופל לכתובת עצמה, כדי שלא
    // ייווצר לקוח בשם ''.
    name: rawName || email || 'לקוח לא מזוהה',
    email,
    isValidEmail,
  };
}
