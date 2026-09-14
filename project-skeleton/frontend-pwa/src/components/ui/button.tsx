import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // gap-2 עובד נכון בשני הכיוונים; אין צורך ב-margin ידני לאייקון.
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium',
    'transition-[background-color,border-color,color,box-shadow] duration-(--duration-fast)',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:size-5 [&_svg]:shrink-0',
    'active:scale-[0.98]',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-fg-on-accent hover:bg-accent-hover shadow-xs',
        secondary: 'bg-surface-raised text-fg border border-border hover:bg-surface-hover shadow-xs',
        ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        danger: 'bg-danger text-white hover:brightness-110 shadow-xs',
        // קישור אמיתי: קו תחתון בהובר, לא רק שינוי צבע.
        link: 'text-accent underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        /* ב-PWA ברירת המחדל היא 56px ולא 44px.
           44 הוא הרף של WCAG למסך מגע כללי; המשתמש כאן מפעיל טלפון
           ביד אחת, בכפפות, לעיתים באור ישיר. 56 הוא הגודל שמונע
           הקלקות שגויות בתנאים האלה, והוא גם מה שמאפשר לזהות את
           הכפתור בלי להתמקד בו. */
        md: 'h-14 px-5 text-base rounded-(--radius-lg)',
        // sm שמור לפעולות משניות בתוך שורה; עדיין 44px.
        sm: 'h-11 px-4 text-sm rounded-(--radius-md)',
        lg: 'h-16 px-6 text-lg rounded-(--radius-xl)',
        icon: 'size-14 rounded-(--radius-lg)',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      // קורא מסך מקבל הודעה על מצב הטעינה, לא רק ספינר ויזואלי.
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </Comp>
  );
});
