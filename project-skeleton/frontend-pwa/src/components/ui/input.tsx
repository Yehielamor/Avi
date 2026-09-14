import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        // h-14 ו-text-base: אזור מגע של 56px, וטקסט שלא מקטין את
        // הפונט מתחת ל-16px — ב-iOS זה מה שגורם לדפדפן להזים את
        // המסך בכל פוקוס על שדה.
        'h-14 w-full rounded-(--radius-lg) border bg-surface px-4 text-base text-fg',
        'placeholder:text-fg-subtle',
        'transition-[border-color,box-shadow] duration-(--duration-fast)',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-sunken',
        invalid
          ? 'border-danger focus-visible:outline-(--color-danger)'
          : 'border-border hover:border-border-strong',
        // אימייל, טלפון ומספרים נשארים LTR גם בטופס עברי — אחרת
        // הסימנים (+, @, -) קופצים לצד הלא נכון בזמן ההקלדה.
        (type === 'email' || type === 'tel' || type === 'url' || type === 'number') && 'text-start [direction:ltr]',
        className,
      )}
      {...props}
    />
  );
});
