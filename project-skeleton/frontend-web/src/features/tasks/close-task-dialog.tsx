import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useToast,
} from '@/components/ui';
import { request } from '@/lib/api';
import type { ChecklistItem } from '@/lib/schemas';
import { useEmailEnabled } from '@/lib/use-email-enabled';

/**
 * סגירת משימה היא פעולה שמפעילה שרשרת: ניכוי מלאי, שורות חיוב,
 * ומייל ללקוח. לכן היא מאחורי אישור מפורש שמראה מה עומד לקרות —
 * ולא כפתור בודד שאפשר ללחוץ עליו בטעות.
 *
 * הפעולה עצמה אידמפוטנטית בשרת (סגירה כפולה לא מנכה מלאי פעמיים),
 * אבל זה הרשת ולא התוכנית: הכפתור ננעל בזמן השליחה.
 */
export function CloseTaskDialog({
  taskId,
  checklist,
}: {
  taskId: string;
  checklist: ChecklistItem[];
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const email = useEmailEnabled();

  const close = useMutation({
    mutationFn: () =>
      request<{ alreadyClosed?: boolean }>(`/tasks/${taskId}/close`, {
        method: 'POST',
        body: {
          checklist: checklist.map((c) => ({
            label: c.label,
            done: c.done,
            ...(c.priceCode ? { priceCode: c.priceCode } : {}),
            ...(c.sku ? { sku: c.sku } : {}),
            ...(c.qty ? { qty: c.qty } : {}),
          })),
        },
      }),
    onSuccess: async (result) => {
      setOpen(false);
      // השרת מבחין בין סגירה אמיתית לבין ניסיון חוזר. ההודעה
      // משקפת מה באמת קרה — "נסגרה" על משימה שכבר הייתה סגורה
      // זה שקר קטן שמבלבל בהמשך.
      if (result?.alreadyClosed) toast.info('המשימה כבר הייתה סגורה');
      else
        toast.success(
          'המשימה נסגרה',
          email.enabled
            ? 'המלאי, החיוב והמייל ללקוח מטופלים ברקע'
            : 'המלאי והחיוב מטופלים ברקע',
        );
      await qc.invalidateQueries({ queryKey: ['task', taskId] });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: Error) => toast.error('סגירת המשימה נכשלה', err.message),
  });

  const done = checklist.filter((c) => c.done).length;
  const pending = checklist.length - done;
  const consumesStock = checklist.some((c) => c.done && c.sku);
  const billable = checklist.some((c) => c.done && c.priceCode);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <CheckCircle2 aria-hidden />
          סגירת משימה
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>סגירת משימה</DialogTitle>
          <DialogDescription>הפעולה תפעיל תהליכים נוספים במערכת.</DialogDescription>
        </DialogHeader>

        <DialogBody>
          {checklist.length > 0 ? (
            <div className="rounded-(--radius-md) border border-border bg-surface-sunken/50 p-3 text-xs">
              <p className="tabular text-fg">
                סומנו {done} מתוך {checklist.length} פריטים
              </p>
              {pending > 0 ? (
                <p className="mt-1 text-warning">
                  {pending} פריטים לא סומנו — הם לא יחויבו ולא ינוכו מהמלאי.
                </p>
              ) : null}
            </div>
          ) : null}

          <ul className="space-y-1.5 text-xs text-fg-muted">
            <li>• המשימה תסומן כהושלמה.</li>
            {consumesStock ? <li>• המלאי ינוכה לפי הפריטים שסומנו.</li> : null}
            {billable ? <li>• ייווצרו שורות חיוב לחשבונית הבאה.</li> : null}
            {email.enabled ? (
              <li>• יישלח מייל עדכון ללקוח.</li>
            ) : (
              // אמירת האמת עדיפה על שתיקה: המשתמש צריך לדעת שהלקוח
              // לא יעודכן, כדי שיוכל להתקשר בעצמו.
              <li className="text-warning">
                • הלקוח <strong>לא</strong> יעודכן — אין חשבון מייל מחובר.
              </li>
            )}
          </ul>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            ביטול
          </Button>
          <Button size="sm" loading={close.isPending} onClick={() => close.mutate()}>
            סגור משימה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
