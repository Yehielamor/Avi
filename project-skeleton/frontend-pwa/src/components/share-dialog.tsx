import { Copy, Send } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from '@/components/ui';
import type { ShareResult } from '@/lib/schemas';

/**
 * ההודעה ללקוח, לפני שהיא נפתחת ב-WhatsApp.
 *
 * wa.me פותח את ה-WhatsApp של הטכנאי עם ההודעה מוכנה — הוא לוחץ "שלח"
 * בעצמו. קישור אמיתי ולא window.open אחרי await: דפדפן בטלפון חוסם
 * פתיחה שאינה תוצאה ישירה של לחיצה.
 */
export function ShareDialog({ result, title, onClose }: { result: ShareResult; title: string; onClose: () => void }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.message);
      toast.success('הועתק');
    } catch {
      toast.error('ההעתקה נחסמה בדפדפן');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby="share-desc">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription id="share-desc">ההודעה תיפתח ב-WhatsApp שלך. שולחים בלחיצה.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="whitespace-pre-wrap rounded-(--radius-md) bg-surface-sunken p-3 text-sm text-fg">{result.message}</p>
          {!result.waUrl ? (
            <p className="mt-2 text-xs text-warning">
              אין ללקוח מספר נייד ישראלי תקין, ולכן אין כפתור WhatsApp. אפשר להעתיק ולשלוח ידנית.
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {result.waUrl ? (
            <a
              href={result.waUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="inline-flex min-h-14 flex-1 items-center justify-center gap-2 rounded-(--radius-lg) bg-accent px-4 text-base font-medium text-fg-on-accent active:brightness-95"
            >
              <Send className="size-5" aria-hidden />
              פתיחה ב-WhatsApp
            </a>
          ) : null}
          <Button variant="secondary" className="min-h-14" onClick={() => void copy()}>
            <Copy aria-hidden />
            העתקה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
