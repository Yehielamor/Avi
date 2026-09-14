import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * עוטף שדה טופס. קיים כדי שקישור ה-label, הודעת השגיאה ו-
 * aria-describedby ייעשו נכון פעם אחת ולא ישוכפלו בכל טופס.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const describedBy = [error ? `${htmlFor}-error` : null, hint ? `${htmlFor}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn('space-y-1.5', className)} data-described-by={describedBy || undefined}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-fg-muted">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-2xs text-fg-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-2xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
