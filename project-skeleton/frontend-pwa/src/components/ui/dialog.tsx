import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Radix מטפל בכל מה שקל לטעות בו בחלונית: מלכודת פוקוס, החזרת
 * הפוקוס לטריגר בסגירה, Escape, aria-modal, ונעילת גלילה ברקע.
 * כתיבה עצמאית של זה נכשלת בנגישות כמעט תמיד.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          'fixed start-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg translate-x-1/2 -translate-y-1/2',
          'rounded-(--radius-xl) border border-border bg-surface-raised shadow-lg',
          'max-h-[calc(100dvh-4rem)] overflow-y-auto',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute end-3 top-3 grid size-8 place-items-center rounded-(--radius-sm) text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
          aria-label="סגירה"
        >
          <X className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('border-b border-border px-5 py-4 pe-12', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-sm font-semibold text-fg', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn('mt-0.5 text-xs text-fg-muted', className)} {...props} />
  );
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('space-y-4 p-5', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap justify-end gap-2 border-t border-border bg-surface-sunken/50 px-5 py-3',
        className,
      )}
      {...props}
    />
  );
}
