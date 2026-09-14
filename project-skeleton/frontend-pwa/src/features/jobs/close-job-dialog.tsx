import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, WifiOff } from 'lucide-react';
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
import { useOnline } from '@/lib/online';
import { closeTaskResultSchema, type ChecklistItem } from '@/lib/schemas';

/**
 * סגירת משימה.
 *
 * הפעולה מפעילה שרשרת בשרת: ניכוי מלאי, שורות חיוב, ומייל ללקוח.
 * לכן היא מאחורי אישור שמראה מה עומד לקרות, ולא כפתור בודד שאפשר
 * ללחוץ עליו בטעות עם כפפה.
 *
 * ============================================================================
 * למה אין תור אופליין
 * ============================================================================
 * הפיתוי ברור: לשמור את הסגירה ולשדר כשהרשת חוזרת. לא עשינו זאת,
 * ובכוונה. סגירה ששודרה באיחור של שעה מגיעה לשרת שאין לו חוזה
 * ליישוב התנגשויות: בינתיים המשימה יכלה להיסגר בידי אחר, להתבטל,
 * או שהמלאי שהסגירה מנכה כבר אינו קיים. `alreadyClosed` מכסה סגירה
 * כפולה של אותה משימה — הוא לא מכסה מצב שהשתנה תחתיה.
 *
 * תור שקט שמייצר חיוב שגוי ללקוח גרוע מכפתור מושבת. הכפתור מושבת
 * ואומר למה.
 */
export function CloseJobDialog({
  taskId,
  checklist,
}: {
  taskId: string;
  checklist: ChecklistItem[];
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const online = useOnline();

  const close = useMutation({
    mutationFn: () =>
      request(`/tasks/${taskId}/close`, {
        method: 'POST',
        schema: closeTaskResultSchema,
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
      // השרת מבחין בין סגירה אמיתית לניסיון חוזר. ההודעה משקפת מה
      // באמת קרה — "נסגרה" על משימה שכבר הייתה סגורה זה שקר קטן
      // שמבלבל בהמשך.
      if (result.alreadyClosed) toast.info('המשימה כבר הייתה סגורה');
      else toast.success('המשימה נסגרה', 'המלאי, החיוב והמייל ללקוח מטופלים ברקע');
      await qc.invalidateQueries({ queryKey: ['job', taskId] });
      await qc.invalidateQueries({ queryKey: ['my-jobs'] });
    },
    onError: (err: Error) => toast.error('סגירת המשימה נכשלה', err.message),
  });

  if (!online) {
    return (
      <div className="space-y-2">
        <Button className="w-full" disabled>
          <WifiOff aria-hidden />
          סגירת משימה
        </Button>
        <p role="status" className="text-center text-xs text-fg-muted">
          אין חיבור לרשת. סגירה מנכה מלאי ויוצרת חיוב, ולכן היא חייבת להישלח עכשיו ולא מאוחר יותר —
          הסימונים שלך נשמרים במסך עד שהחיבור יחזור.
        </p>
      </div>
    );
  }

  const done = checklist.filter((c) => c.done).length;
  const pending = checklist.length - done;
  const consumesStock = checklist.some((c) => c.done && c.sku);
  const billable = checklist.some((c) => c.done && c.priceCode);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full" size="lg">
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
            <div className="rounded-(--radius-md) border border-border bg-surface-sunken/50 p-3 text-sm">
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

          <ul className="space-y-1.5 text-sm text-fg-muted">
            <li>• המשימה תסומן כהושלמה.</li>
            {consumesStock ? <li>• המלאי ינוכה לפי הפריטים שסומנו.</li> : null}
            {billable ? <li>• ייווצרו שורות חיוב לחשבונית הבאה.</li> : null}
            <li>• יישלח מייל עדכון ללקוח.</li>
          </ul>
        </DialogBody>

        <DialogFooter className="flex-col-reverse gap-2 [&>*]:w-full">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            ביטול
          </Button>
          <Button loading={close.isPending} onClick={() => close.mutate()}>
            סגור משימה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
