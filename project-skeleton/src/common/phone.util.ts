/**
 * טלפון ישראלי → הפורמט ש-wa.me דורש: ספרות בלבד, קידומת 972, בלי 0 מוביל.
 *
 * מספר שלא ניתן לנרמל בוודאות מחזיר null, והממשק מסתיר את כפתור ה-WhatsApp.
 * קישור עם מספר שגוי פותח שיחה עם זר — עדיף כפתור חסר.
 */
export function toWaNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');

  let national: string;
  if (digits.startsWith('+972')) national = digits.slice(4);
  else if (digits.startsWith('00972')) national = digits.slice(5);
  else if (digits.startsWith('972')) national = digits.slice(3);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else return null;

  national = national.replace(/^0/, '');
  // נייד: 5X + 7 ספרות. קווי: 2/3/4/8/9 + 7 ספרות, או 7X + 7 ספרות (VoIP).
  if (!/^(5\d{8}|[23489]\d{7}|7\d{8})$/.test(national)) return null;
  return `972${national}`;
}

/** קישור wa.me עם הודעה מוכנה. null כשהמספר אינו תקין. */
export function buildWaLink(phone: string | null | undefined, text: string): string | null {
  const n = toWaNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
