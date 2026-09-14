import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'danger' | 'info';
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((tone: Tone, title: string, description?: string) => {
    const id = ++nextId;
    setItems((prev) => [...prev, { id, title, description, tone }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, d) => push('success', t, d),
      error: (t, d) => push('danger', t, d),
      info: (t, d) => push('info', t, d),
    }),
    [push],
  );

  const dismiss = (id: number) => setItems((prev) => prev.filter((i) => i.id !== id));

  return (
    <ToastContext value={api}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((item) => (
          <Toast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
        {/* ב-RTL הודעות נכנסות מהצד השמאלי התחתון. */}
        <ToastPrimitive.Viewport className="fixed bottom-0 end-0 z-100 flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext>
  );
}

const TONE: Record<Tone, { icon: typeof Info; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'text-success' },
  danger: { icon: AlertCircle, cls: 'text-danger' },
  info: { icon: Info, cls: 'text-info' },
};

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { icon: Icon, cls } = TONE[item.tone];
  return (
    <ToastPrimitive.Root
      onOpenChange={(open) => !open && onDismiss()}
      className={cn(
        'flex items-start gap-3 rounded-(--radius-lg) border border-border bg-surface-raised p-3.5 shadow-lg',
        'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2',
        'data-[swipe=end]:animate-out data-[swipe=end]:fade-out-0',
      )}
    >
      <Icon className={cn('mt-px size-4 shrink-0', cls)} aria-hidden />
      <div className="min-w-0 flex-1">
        <ToastPrimitive.Title className="text-xs font-medium text-fg">{item.title}</ToastPrimitive.Title>
        {item.description ? (
          <ToastPrimitive.Description className="mt-0.5 text-2xs text-fg-muted">
            {item.description}
          </ToastPrimitive.Description>
        ) : null}
      </div>
    </ToastPrimitive.Root>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
