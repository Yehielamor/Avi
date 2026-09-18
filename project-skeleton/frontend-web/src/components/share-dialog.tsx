import { Copy, Send } from 'lucide-react';
import { z } from 'zod';
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

/** התשובה של כל endpoint שמייצר קישור ללקוח. */
export const shareResultSchema = z.object({ url: z.string(), waUrl: z.string().nullable(), message: z.string() });
export type ShareResult = z.infer<typeof shareResultSchema>;

/**
 * מציג את ההודעה לפני שהיא נפתחת ב-WhatsApp.
 *
 * wa.me פותח את ה-WhatsApp של מי שלוחץ, עם ההודעה מוכנה — הוא עדיין לוחץ
 * "שלח" בעצמו. קישור אמיתי ולא window.open אחרי await: חוסמי חלונות קופצים
 * חוסמים פתיחה שאינה תוצאה ישירה של לחיצה.
 */
export function ShareDialog({
  result,
  title,
  description,
  onClose,
}: {
  result: ShareResult;
  title: string;
  description: string;
  onClose: () => void;
}) {
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
          <DialogDescription id="share-desc">{description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="whitespace-pre-wrap rounded-lg bg-surface-sunken p-3 text-sm text-fg">{result.message}</p>
          {!result.waUrl ? (
            <p className="mt-2 text-xs text-warning">
              מספר הטלפון של הלקוח חסר או אינו מספר ישראלי תקין, ולכן אין כפתור WhatsApp. אפשר להעתיק ולשלוח ידנית.
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => void copy()}>
            <Copy aria-hidden />
            העתקה
          </Button>
          {result.waUrl ? (
            <a
              href={result.waUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-fg-on-accent shadow-xs hover:bg-accent-hover"
            >
              <Send className="size-4" aria-hidden />
              פתיחה ב-WhatsApp
            </a>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
