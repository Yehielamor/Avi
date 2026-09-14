import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* ---------------------------------------------------------------------------
   עיצוב מספרים וזמנים — עברית, ישראל.

   כל תצוגה עוברת דרך כאן. עיצוב מפוזר ב-JSX הוא איך שמטבע אחד מופיע
   בשלוש צורות שונות באותו מסך.
   --------------------------------------------------------------------------- */

const LOCALE = 'he-IL';
const TZ = 'Asia/Jerusalem';

const currencyFmt = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 2,
});

/**
 * סכומים מגיעים מהשרת כמחרוזת, לא כ-number.
 * Decimal(12,2) לא נכנס ל-double של JS בלי אובדן, ו-JSON.parse היה
 * הופך אותו ל-float. השרת מסרלז כמחרוזת, וכאן מעצבים אותה כפי שהיא.
 */
export function formatCurrency(amount: string | number): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  return Number.isFinite(n) ? currencyFmt.format(n) : '—';
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(LOCALE).format(n);
}

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * השרת שולח UTC (Timestamptz). התצוגה תמיד בשעון ישראל — מפורשות,
 * לא לפי שעון הדפדפן: מנהל שנוסע לחו"ל צריך לראות את אותן שעות
 * שהטכנאי בשטח רואה.
 */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/** "לפני 3 שעות". נופל לתאריך מלא מעבר לשבוע — "לפני 43 ימים" לא קריא. */
export function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';

  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);

  if (abs < 60) return 'עכשיו';
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 604_800) return rtf.format(Math.round(diffSec / 86_400), 'day');
  return formatDate(d);
}

/** ראשי תיבות לאווטאר. עובד לעברית ולאנגלית. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return (parts[0]![0] ?? '') + (parts[parts.length - 1]![0] ?? '');
}
