import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * לכל וריאנט יש רקע *וגם* גבול *וגם* נקודה צבעונית. זה לא קישוט:
 * כ-8% מהגברים הם עיוורי צבעים, וטכנאי בשמש רואה גוונים שטוחים.
 * הצורה נושאת את המשמעות יחד עם הצבע, לא במקומו.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-sunken text-fg-muted border-border',
        accent: 'bg-accent-subtle text-accent border-accent-border',
        success: 'bg-success-subtle text-success border-success-border',
        warning: 'bg-warning-subtle text-warning border-warning-border',
        danger: 'bg-danger-subtle text-danger border-danger-border',
        info: 'bg-info-subtle text-info border-info-border',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, tone, dot = true, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}
