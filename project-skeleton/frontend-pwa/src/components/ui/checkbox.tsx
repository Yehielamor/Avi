import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        // size-8 (32px) ולא size-5: זו תיבת סימון שמסמנים בכפפה.
        // אזור המגע בפועל גדול יותר — התווית שלידה היא חלק ממנו.
        'peer grid size-8 shrink-0 place-items-center rounded-(--radius-sm) border-2 border-border-strong bg-surface',
        'transition-colors duration-(--duration-fast)',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-fg-on-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-5" strokeWidth={3.5} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
