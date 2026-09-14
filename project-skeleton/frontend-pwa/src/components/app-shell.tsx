import { useNavigate } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/online';

/**
 * קליפה מינימלית בכוונה.
 *
 * אין ניווט צדדי ואין תפריט: ל-PWA שלושה מסכים, והמעבר ביניהם הוא
 * רשימה → משימה → חזרה. סרגל ניווט היה תופס גובה מסך שבו כל שורה
 * היא משימה שצריך לקרוא בשמש.
 *
 * הגובה נקבע מ-safe-area: במצב standalone אין ממשק דפדפן סביב הדף,
 * והכותרת הייתה נכנסת מתחת ל-notch.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { session, status, logout } = useAuth();
  const online = useOnline();
  const navigate = useNavigate();

  // סיום סשן (401 מכל קריאה, או התנתקות) מעיף מיד ולא ממתין לניווט
  // הבא. ה-guard במסלול בודק רק בכניסה אליו, ובלי זה הטכנאי היה
  // נשאר על מסך שכל בקשה בו נכשלת.
  useEffect(() => {
    if (status === 'anonymous') void navigate({ to: '/login', replace: true });
  }, [status, navigate]);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-(--radius-md) focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-fg-on-accent"
      >
        דילוג לתוכן
      </a>

      <header
        className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-(--radius-md) bg-accent text-2xs font-bold text-fg-on-accent">
              CM
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{session?.user.name ?? 'עבודות'}</p>
              <p className="truncate text-2xs text-fg-subtle">{session?.tenant.name ?? ''}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* מצב החיבור קבוע בכותרת ולא קופץ כהודעה: הטכנאי צריך
                לדעת אותו לפני שהוא מנסה לסגור משימה, לא אחרי. */}
            {online ? null : (
              <span
                className="rounded-full border border-warning-border bg-warning-subtle px-2.5 py-1 text-2xs font-medium text-warning"
                role="status"
              >
                אופליין
              </span>
            )}
            <Button variant="ghost" size="icon" onClick={logout} aria-label="התנתקות">
              <LogOut aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      <main
        id="main"
        className="flex-1 px-4 py-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
      >
        {children}
      </main>
    </div>
  );
}
