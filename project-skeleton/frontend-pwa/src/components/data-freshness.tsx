import { CloudOff, WifiOff } from 'lucide-react';
import { formatDateTime, formatRelative } from '@/lib/utils';

/* ---------------------------------------------------------------------------
   הצהרת טריות.

   הכלל היחיד כאן: **נתון שמור לעולם אינו מוצג כאילו הוא חי.**

   טכנאי שרואה רשימת משימות לא יודע מאיפה היא הגיעה. אם היא נשמרה
   לפני שעתיים, ובינתיים משימה בוטלה או הכתובת שונתה — הוא ייסע
   לשווא. הפס הזה הוא ההבדל בין "לא יודע" לבין "לא ידע שהוא לא יודע".
   --------------------------------------------------------------------------- */

/** מוצג כשאין רשת בכלל. מסביר גם מה עדיין אפשר לעשות. */
export function OfflineBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-(--radius-lg) border border-warning-border bg-warning-subtle px-4 py-3"
    >
      <WifiOff className="size-5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">אין חיבור לרשת</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          אפשר לצפות במה שנשמר. סגירת משימה תתאפשר כשהחיבור יחזור.
        </p>
      </div>
    </div>
  );
}

/**
 * מוצג כשהנתון הגיע מהמטמון של ה-service worker.
 *
 * הזמן מוצג יחסית ("לפני 3 שעות") ולא כחותמת מלאה — השאלה בשטח
 * היא "כמה זה ישן", לא "מתי בדיוק". החותמת המלאה ב-title.
 */
export function StaleBanner({ cachedAt }: { cachedAt: string | null }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-(--radius-lg) border border-border-strong bg-surface-sunken px-4 py-3"
    >
      <CloudOff className="size-5 shrink-0 text-fg-muted" aria-hidden />
      <p className="min-w-0 text-sm text-fg">
        מוצג מהזיכרון
        {cachedAt ? (
          <>
            {' — '}
            <time dateTime={cachedAt} title={formatDateTime(cachedAt)} className="text-fg-muted">
              עודכן {formatRelative(cachedAt)}
            </time>
          </>
        ) : null}
      </p>
    </div>
  );
}
