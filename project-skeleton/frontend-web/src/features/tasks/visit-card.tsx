import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CalendarClock, Copy, MessageCircle, Send } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  useToast,
} from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { TaskDetail } from '@/lib/schemas';
import { formatDateTime } from '@/lib/utils';

/* ---------------------------------------------------------------------------
   מועד ביקור + שליחה ללקוח.

   השליחה היא קישור wa.me: היא פותחת את ה-WhatsApp של מי שלוחץ, עם הודעה
   מוכנה. אין API ואין עלות — ולכן גם אין שליחה אוטומטית. זה בכוונה: עד
   שיהיה חיבור מאושר של Meta, אדם לוחץ "שלח".
   --------------------------------------------------------------------------- */

const shareSchema = z.object({ url: z.string(), waUrl: z.string().nullable(), message: z.string() });
type Share = z.infer<typeof shareSchema>;

/** ISO → ערך לשדה datetime-local, בשעון המקומי של הדפדפן. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function VisitCard({ task }: { task: TaskDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canSchedule = can('OWNER', 'MANAGER');
  const isOpen = task.status !== 'CLOSED' && task.status !== 'CANCELLED';

  const [start, setStart] = useState(toLocalInput(task.scheduledStart));
  const [end, setEnd] = useState(toLocalInput(task.scheduledEnd));
  const [shared, setShared] = useState<Share | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['task', task.id] });

  const schedule = useMutation({
    mutationFn: () =>
      request(`/tasks/${task.id}/schedule`, {
        method: 'PATCH',
        body: {
          scheduledStart: new Date(start).toISOString(),
          ...(end && { scheduledEnd: new Date(end).toISOString() }),
        },
      }),
    onSuccess: async () => {
      toast.success('המועד נשמר', 'אם הלקוח כבר אישר מועד קודם — האישור בוטל, ושווה לשלוח לו שוב.');
      await refresh();
    },
    onError: (e) => toast.error('שמירת המועד נכשלה', e instanceof ApiError ? e.message : undefined),
  });

  const share = useMutation({
    mutationFn: () => request(`/tasks/${task.id}/share-link`, { method: 'POST', schema: shareSchema }),
    onSuccess: setShared,
    onError: (e) => toast.error('יצירת הקישור נכשלה', e instanceof ApiError ? e.message : undefined),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('הועתק');
    } catch {
      toast.error('ההעתקה נחסמה בדפדפן');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>מועד ביקור</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {task.rescheduleRequest ? (
          // הבקשה של הלקוח היא הדבר הדחוף ביותר בכרטיס, ולכן ראשונה.
          <div role="status" className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2.5 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-warning">
              <CalendarClock className="size-4" aria-hidden />
              הלקוח ביקש מועד אחר
            </p>
            {/* טקסט חופשי מלקוח — מוצג כטקסט בלבד, לעולם לא כ-HTML. */}
            <p className="mt-1 whitespace-pre-wrap text-fg">{task.rescheduleRequest}</p>
            <p className="mt-1 text-2xs text-fg-muted">{formatDateTime(task.rescheduleRequestedAt)}</p>
          </div>
        ) : task.customerConfirmedAt ? (
          <Badge tone="success">
            <CalendarCheck2 className="size-3.5" aria-hidden />
            הלקוח אישר את המועד
          </Badge>
        ) : task.scheduledStart ? (
          <Badge tone="neutral">ממתין לאישור הלקוח</Badge>
        ) : null}

        {canSchedule && isOpen ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (start) schedule.mutate();
            }}
          >
            <Field label="התחלה" htmlFor="visit-start" required>
              <Input id="visit-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="סיום" htmlFor="visit-end" hint="לא חובה — חלון הגעה">
              <Input id="visit-end" type="datetime-local" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
            </Field>
            <Button type="submit" size="sm" variant="secondary" disabled={!start} loading={schedule.isPending}>
              שמירת מועד
            </Button>
          </form>
        ) : (
          <p className="text-sm text-fg">
            {task.scheduledStart ? formatDateTime(task.scheduledStart) : 'טרם נקבע מועד'}
          </p>
        )}

        {isOpen ? (
          <Button className="w-full" onClick={() => share.mutate()} loading={share.isPending}>
            <MessageCircle aria-hidden />
            שליחה ללקוח ב-WhatsApp
          </Button>
        ) : null}
      </CardContent>

      {shared ? (
        <Dialog open onOpenChange={(open) => !open && setShared(null)}>
          <DialogContent aria-describedby="share-desc">
            <DialogHeader>
              <DialogTitle>שליחה ללקוח</DialogTitle>
              <DialogDescription id="share-desc">
                ההודעה תיפתח ב-WhatsApp שלך. הלקוח יוכל לראות את הסטטוס ולאשר את המועד — בלי להתחבר.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <p className="whitespace-pre-wrap rounded-lg bg-surface-sunken p-3 text-sm text-fg">{shared.message}</p>
              {!shared.waUrl ? (
                <p className="mt-2 text-xs text-warning">
                  מספר הטלפון של הלקוח חסר או אינו מספר ישראלי תקין, ולכן אין כפתור WhatsApp. אפשר להעתיק ולשלוח ידנית.
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => void copy(shared.message)}>
                <Copy aria-hidden />
                העתקה
              </Button>
              {shared.waUrl ? (
                // קישור אמיתי ולא window.open אחרי await: חוסמי חלונות קופצים
                // חוסמים פתיחה שאינה תוצאה ישירה של לחיצה.
                <a
                  href={shared.waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShared(null)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-fg-on-accent shadow-xs hover:bg-accent-hover"
                >
                  <Send className="size-4" aria-hidden />
                  פתיחה ב-WhatsApp
                </a>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}
