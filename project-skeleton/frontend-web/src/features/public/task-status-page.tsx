import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Car, CheckCircle2, CircleDashed, ClipboardCheck, Clock3, Wrench, XCircle } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button, Skeleton, Textarea } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PublicShell } from './public-shell';

/* ---------------------------------------------------------------------------
   הדף שהלקוח פותח מתוך WhatsApp.

   בלי התחברות: הטוקן בכתובת הוא ההרשאה. הלקוח לא מכיר את המערכת, לא
   ביקש חשבון, ופותח מטלפון — לכן הדף קצר, גדול, ועונה על שאלה אחת לפני
   הכול: מתי מגיעים.
   --------------------------------------------------------------------------- */

const viewSchema = z.object({
  businessName: z.string(),
  title: z.string(),
  status: z.enum(['received', 'scheduled', 'on_the_way', 'done', 'cancelled']),
  scheduledStart: z.string().nullable(),
  scheduledEnd: z.string().nullable(),
  technicianFirstName: z.string().nullable(),
  customerConfirmedAt: z.string().nullable(),
  rescheduleRequested: z.boolean(),
  canConfirm: z.boolean(),
  canRequestReschedule: z.boolean(),
});
type View = z.infer<typeof viewSchema>;

const STEPS = [
  { key: 'received', label: 'התקבלה', icon: ClipboardCheck },
  { key: 'scheduled', label: 'נקבע מועד', icon: Clock3 },
  { key: 'on_the_way', label: 'בדרך', icon: Car },
  { key: 'done', label: 'הושלמה', icon: Wrench },
] as const;

const tz = { timeZone: 'Asia/Jerusalem' } as const;
const dayFmt = new Intl.DateTimeFormat('he-IL', { ...tz, weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { ...tz, hour: '2-digit', minute: '2-digit' });

export function TaskStatusPage() {
  const { token } = useParams({ from: '/c/s/$token' });
  const qc = useQueryClient();
  const key = ['public-status', token];

  const view = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => request(`/public/status/${token}`, { schema: viewSchema, signal }),
    retry: false,
  });

  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');

  const onDone = (v: View) => qc.setQueryData(key, v);
  const confirm = useMutation({
    mutationFn: () => request(`/public/status/${token}/confirm`, { method: 'POST', schema: viewSchema }),
    onSuccess: onDone,
  });
  const reschedule = useMutation({
    mutationFn: () =>
      request(`/public/status/${token}/reschedule`, { method: 'POST', body: { note }, schema: viewSchema }),
    onSuccess: (v) => {
      onDone(v);
      setAsking(false);
    },
  });

  if (view.isLoading) {
    return (
      <PublicShell>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-6 h-28 w-full" />
        <Skeleton className="mt-4 h-12 w-full" />
      </PublicShell>
    );
  }

  if (view.isError || !view.data) {
    const expired = view.error instanceof ApiError && view.error.status === 404;
    return (
      <PublicShell>
        <div className="py-10 text-center">
          <XCircle className="mx-auto size-10 text-fg-subtle" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold text-fg">
            {expired ? 'הקישור אינו בתוקף' : 'לא הצלחנו לטעון את הדף'}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {expired ? 'ייתכן שנשלח קישור חדש יותר. אפשר לבקש מבעל העסק לשלוח שוב.' : 'נסו לרענן בעוד רגע.'}
          </p>
        </div>
      </PublicShell>
    );
  }

  const v = view.data;
  const stepIndex = STEPS.findIndex((s) => s.key === v.status);
  const actionError = confirm.error ?? reschedule.error;

  return (
    <PublicShell business={v.businessName}>
      <h1 className="text-xl font-semibold leading-snug text-fg">{v.title}</h1>

      {v.status === 'cancelled' ? (
        <p className="mt-6 rounded-xl bg-surface-sunken p-4 text-sm text-fg">העבודה בוטלה. לשאלות אפשר לפנות לבעל העסק.</p>
      ) : (
        <ol className="mt-6 grid grid-cols-4 gap-1" aria-label="שלבי העבודה">
          {STEPS.map((s, i) => {
            const reached = i <= stepIndex;
            const Icon = reached ? s.icon : CircleDashed;
            return (
              <li key={s.key} className="flex flex-col items-center gap-1.5 text-center" aria-current={i === stepIndex ? 'step' : undefined}>
                <span
                  className={cn(
                    'grid size-10 place-items-center rounded-full',
                    i === stepIndex ? 'bg-accent text-fg-on-accent' : reached ? 'bg-accent-subtle text-accent' : 'bg-surface-sunken text-fg-subtle',
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className={cn('text-2xs', reached ? 'font-medium text-fg' : 'text-fg-subtle')}>{s.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {v.scheduledStart && v.status !== 'done' && v.status !== 'cancelled' ? (
        <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-xs font-medium text-fg-muted">מועד הביקור</h2>
          <p className="mt-1 text-lg font-semibold text-fg">{dayFmt.format(new Date(v.scheduledStart))}</p>
          {/* dir=ltr מבודד: בלי זה, טווח שעות בתוך RTL מתהפך ויזואלית
              ("22:04–20:04"), והלקוח קורא שעת סיום לפני שעת התחלה. */}
          <p className="text-2xl font-semibold text-fg">
            <span dir="ltr" className="tabular inline-block">
              {timeFmt.format(new Date(v.scheduledStart))}
              {v.scheduledEnd ? ` – ${timeFmt.format(new Date(v.scheduledEnd))}` : ''}
            </span>
          </p>
          {v.technicianFirstName ? <p className="mt-2 text-sm text-fg-muted">הטכנאי: {v.technicianFirstName}</p> : null}

          {v.customerConfirmedAt ? (
            <p className="mt-4 flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              אישרת את המועד. תודה!
            </p>
          ) : v.rescheduleRequested ? (
            <p className="mt-4 text-sm font-medium text-warning">ביקשת מועד אחר — בעל העסק יחזור אליך.</p>
          ) : null}
        </section>
      ) : v.status === 'received' ? (
        <p className="mt-6 rounded-xl bg-surface-sunken p-4 text-sm text-fg">
          קיבלנו את הפנייה. נעדכן כאן ברגע שייקבע מועד.
        </p>
      ) : v.status === 'done' ? (
        <p className="mt-6 rounded-xl bg-success-subtle p-4 text-sm text-success">העבודה הושלמה. תודה שבחרת ב{v.businessName}!</p>
      ) : null}

      {v.canConfirm && !v.customerConfirmedAt && !asking ? (
        <Button size="lg" className="mt-5 h-14 w-full text-base" onClick={() => confirm.mutate()} loading={confirm.isPending}>
          <CheckCircle2 aria-hidden />
          מאשר/ת את המועד
        </Button>
      ) : null}

      {v.canRequestReschedule && !asking ? (
        <Button variant="ghost" className="mt-2 w-full" onClick={() => setAsking(true)}>
          {v.scheduledStart ? 'צריך מועד אחר' : 'יש לי בקשה לגבי המועד'}
        </Button>
      ) : null}

      {asking ? (
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) reschedule.mutate();
          }}
        >
          <label htmlFor="note" className="text-sm font-medium text-fg">
            מתי נוח לך?
          </label>
          <Textarea
            id="note"
            value={note}
            maxLength={500}
            rows={3}
            autoFocus
            placeholder="לדוגמה: כל יום אחרי 16:00, או יום חמישי בבוקר"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={!note.trim()} loading={reschedule.isPending}>
              שליחה
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAsking(false)}>
              ביטול
            </Button>
          </div>
        </form>
      ) : null}

      {actionError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {actionError instanceof ApiError && actionError.status === 429
            ? 'יותר מדי ניסיונות. נסו שוב בעוד דקה.'
            : 'הפעולה לא הצליחה. נסו לרענן את הדף.'}
        </p>
      ) : null}
    </PublicShell>
  );
}
