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
    '[&_svg]:size-4 [&_svg]:shrink-0',
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
        // 44px — מינימום אזור מגע נוח. טכנאי מפעיל את זה בכפפות.
        md: 'h-11 px-4 text-sm rounded-(--radius-md)',
        sm: 'h-9 px-3 text-xs rounded-(--radius-sm)',
        lg: 'h-12 px-6 text-base rounded-(--radius-lg)',
        icon: 'size-11 rounded-(--radius-md)',
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
