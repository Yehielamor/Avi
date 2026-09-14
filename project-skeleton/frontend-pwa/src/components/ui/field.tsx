import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
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

  // ה-aria-describedby חייב לשבת על *השדה*, לא על העוטף — קורא מסך
  // מקריא רק את מה שמקושר לפקד עצמו. קודם הוא נכתב על ה-div ולכן
  // הודעות השגיאה לא הוקראו כלל.
  const child = Children.only(children);
  const described =
    isValidElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean; id?: string }>(child)
      ? cloneElement(child, {
          id: child.props.id ?? htmlFor,
          'aria-describedby': describedBy || undefined,
          'aria-invalid': error ? true : child.props['aria-invalid'],
        })
      : child;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-fg-muted">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        ) : null}
      </label>
      {described}
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
