import { randomBytes } from 'node:crypto';

// ============================================================
// הופך שם חברה חופשי (עברית/אנגלית) ל-subdomain תקין.
//
// שני באגים שתוקנו כאן:
//
//   1. רשימת שמורים. שם חברה "Admin" ייצר את התת-דומיין `admin`,
//      ו-`www`/`api`/`bi` נשמרים ב-TenantContextMiddleware.RESERVED —
//      כלומר הטננט היה נוצר בהצלחה ואז בלתי נגיש לצמיתות, או גרוע
//      מכך, חוטף תת-דומיין תשתיתי.
//
//   2. fallback ניחוש. שם כולו בעברית מתרוקן אחרי הסרת non-ASCII,
//      והתוצאה הייתה `tenant-<timestamp base36>` — ניתן לניחוש
//      מהשנייה שבה נוצר הטננט, ומתנגש בין שני עסקים שנרשמו באותה
//      מילישנייה. עכשיו הסיומת אקראית.
// ============================================================

/**
 * תת-דומיינים של תשתית. חייב להישאר על-קבוצה של
 * `TenantContextMiddleware.RESERVED` — ערך משם שמגיע לכאן מייצר טננט
 * שאי אפשר להגיע אליו.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www',
  'api',
  'bi',
  'admin',
  'administrator',
  'root',
  'static',
  'cdn',
  'mail',
  'smtp',
  'imap',
  'ftp',
  'app',
  'apps',
  'dashboard',
  'status',
  'health',
  'docs',
  'support',
  'help',
  'blog',
  'auth',
  'login',
  'signup',
  'register',
  'onboarding',
  'billing',
  'account',
  'accounts',
  'dev',
  'staging',
  'test',
  'demo',
  'internal',
  'assets',
  'media',
  'files',
  'storage',
  'ns',
  'ns1',
  'ns2',
  'mx',
  'vpn',
  'proxy',
  'gateway',
  'webhook',
  'webhooks',
  'metrics',
]);

const MAX_LABEL_LENGTH = 40;
const MIN_LABEL_LENGTH = 3;

/** סיומת אקראית ל-fallback — 5 תווים base32-ish, לא ניתנים לניחוש מזמן היצירה. */
function randomSuffix(): string {
  return randomBytes(4).toString('hex').slice(0, 6);
}

export function slugify(input: string): string {
  const ascii = input
    .toLowerCase()
    .replace(/[^\x00-\x7F]/g, '') // הסרת תווים לא-ASCII (עברית וכו') — DNS לא נושא אותם
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LABEL_LENGTH)
    .replace(/-+$/, '');

  // תווית DNS לא יכולה להתחיל בספרה בכל resolver, ותווית קצרה מדי
  // מתנגשת בקלות — שני המקרים נופלים ל-fallback.
  if (!ascii || ascii.length < MIN_LABEL_LENGTH || /^[0-9]/.test(ascii)) {
    return `co-${randomSuffix()}`;
  }

  if (RESERVED_SUBDOMAINS.has(ascii)) {
    return `${ascii}-${randomSuffix()}`;
  }

  return ascii;
}

/** נבדק שוב לפני כתיבה — גם על מועמד שנוצר עם סיומת ייחודיות. */
export function isReservedSubdomain(candidate: string): boolean {
  return RESERVED_SUBDOMAINS.has(candidate);
}
