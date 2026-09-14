import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * מצב ריק אמיתי אומר *למה* ריק ומה לעשות הלאה. "אין נתונים" לבדו
 * משאיר את המשתמש תקוע.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 grid size-11 place-items-center rounded-full bg-surface-sunken text-fg-subtle">
        <Icon className="size-5" aria-hidden />
      </div>
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-xs text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
