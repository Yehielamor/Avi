import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Circle,
  FileSignature,
  Receipt,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

import { Badge, Card, CardContent, CardHeader, CardTitle, ErrorState, Skeleton } from '@/components/ui';
import { request } from '@/lib/api';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';

/* ---------------------------------------------------------------------------
   תדריך הבוקר — הסיבה לפתוח את המערכת כל יום.

   כל שורה מובילה לפעולה, וכל סכום אומר אם הוא מדויק או הערכה. שורה
   ריקה לא מוצגת: מסך מלא באפסים מלמד להפסיק להסתכל.
   --------------------------------------------------------------------------- */

const briefSchema = z.object({
  today: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      status: z.string(),
      customerName: z.string(),
      technician: z.string().nullable(),
      scheduledStart: z.string(),
      scheduledEnd: z.string().nullable(),
      confirmed: z.boolean(),
      onTheWay: z.boolean(),
    }),
  ),
  needsReply: z.object({
    reschedules: z.array(
      z.object({ taskId: z.string().uuid(), title: z.string(), customerName: z.string(), note: z.string().nullable() }),
    ),
    expiringQuotes: z.array(
      z.object({
        quoteId: z.string().uuid(),
        quoteNumber: z.number().int(),
        customerName: z.string(),
        totalAmount: z.string(),
        validUntil: z.string(),
      }),
    ),
  }),
  moneyWaiting: z.object({
    approvedUnscheduled: z.object({ count: z.number().int(), amount: z.string() }),
    closedUnbilled: z.object({ count: z.number().int(), estimatedAmount: z.string() }),
    maintenanceDue: z.object({ count: z.number().int(), estimatedAmount: z.string().nullable() }),
  }),
  week: z.object({
    bookedByCustomers: z.number().int(),
    quotesApproved: z.number().int(),
    quotesApprovedAmount: z.string(),
    visitsConfirmed: z.number().int(),
    statusLinksSent: z.number().int(),
    jobsClosed: z.number().int(),
  }),
});
export type Brief = z.infer<typeof briefSchema>;

const activationSchema = z.object({
  steps: z.array(z.object({ key: z.enum(['priceList', 'equipment', 'statusLink', 'quote']), done: z.boolean() })),
  completed: z.number().int(),
  total: z.number().int(),
  allDone: z.boolean(),
});
export type Activation = z.infer<typeof activationSchema>;

const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });

export function MorningBrief() {
  const brief = useQuery({
    queryKey: ['dashboard', 'brief'],
    queryFn: ({ signal }) => request('/dashboard/brief', { schema: briefSchema, signal }),
  });
  const activation = useQuery({
    queryKey: ['dashboard', 'activation'],
    queryFn: ({ signal }) => request('/dashboard/activation', { schema: activationSchema, signal }),
  });

  return (
    <div className="space-y-4">
      {activation.data && !activation.data.allDone ? <ActivationChecklist activation={activation.data} /> : null}
      {brief.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : brief.isError ? (
        <Card>
          <ErrorState error={brief.error} onRetry={() => void brief.refetch()} />
        </Card>
      ) : brief.data ? (
        <BriefView brief={brief.data} />
      ) : null}
    </div>
  );
}

export function BriefView({ brief }: { brief: Brief }) {
  const { today, needsReply, moneyWaiting: m, week } = brief;
  const replies = needsReply.reschedules.length + needsReply.expiringQuotes.length;
  const hasMoney = m.approvedUnscheduled.count + m.closedUnbilled.count + m.maintenanceDue.count > 0;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="size-4 text-fg-subtle" aria-hidden />
              היום
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {today.length === 0 ? (
              <p className="text-sm text-fg-muted">אין ביקורים מתוכננים להיום.</p>
            ) : (
              <ul className="space-y-1">
                {today.map((v) => (
                  <li key={v.id}>
                    <Link
                      to="/tasks/$taskId"
                      params={{ taskId: v.id }}
                      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-hover"
                    >
                      <span className="tabular w-12 shrink-0 text-sm font-medium text-fg" dir="ltr">
                        {timeFmt.format(new Date(v.scheduledStart))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">{v.customerName}</span>
                        <span className="block truncate text-xs text-fg-muted">{v.technician ?? 'לא שויך'}</span>
                      </span>
                      {v.status === 'CLOSED' ? (
                        <Badge tone="success">בוצע</Badge>
                      ) : v.onTheWay ? (
                        <Badge tone="info">בדרך</Badge>
                      ) : v.confirmed ? (
                        <Badge tone="success">אישר</Badge>
                      ) : (
                        <Badge tone="neutral">לא אישר</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={cn(replies > 0 && 'border-warning-border')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-fg-subtle" aria-hidden />
              דורש תשובה
              {replies > 0 ? <Badge tone="warning">{replies}</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {replies === 0 ? (
              <p className="text-sm text-fg-muted">אין בקשות פתוחות מלקוחות.</p>
            ) : (
              <ul className="space-y-1">
                {needsReply.reschedules.map((r) => (
                  <li key={r.taskId}>
                    <Link
                      to="/tasks/$taskId"
                      params={{ taskId: r.taskId }}
                      className="-mx-2 block rounded-lg px-2 py-2 hover:bg-surface-hover"
                    >
                      <span className="block text-sm text-fg">{r.customerName} מבקש/ת מועד אחר</span>
                      {r.note ? <span className="block truncate text-xs text-fg-muted">"{r.note}"</span> : null}
                    </Link>
                  </li>
                ))}
                {needsReply.expiringQuotes.map((q) => (
                  <li key={q.quoteId}>
                    <Link to="/quotes" className="-mx-2 block rounded-lg px-2 py-2 hover:bg-surface-hover">
                      <span className="block text-sm text-fg">
                        הצעה #{q.quoteNumber} ל{q.customerName} פגה בקרוב
                      </span>
                      <span className="tabular block text-xs text-fg-muted">{formatCurrency(q.totalAmount)} · שווה תזכורת</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={cn(hasMoney && 'border-accent-border')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="size-4 text-fg-subtle" aria-hidden />
              כסף שמחכה לך
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {!hasMoney ? (
              <p className="text-sm text-fg-muted">הכל מטופל. אין עבודה שמחכה לחיוב או לתיאום.</p>
            ) : (
              <ul className="space-y-1">
                {m.approvedUnscheduled.count > 0 ? (
                  <MoneyRow
                    to="/quotes"
                    icon={FileSignature}
                    label={plural(m.approvedUnscheduled.count, 'הצעה שאושרה ועוד לא תואמה', 'הצעות שאושרו ועוד לא תואמו')}
                    amount={m.approvedUnscheduled.amount}
                  />
                ) : null}
                {m.closedUnbilled.count > 0 ? (
                  <MoneyRow
                    to="/invoices"
                    icon={Receipt}
                    label={plural(m.closedUnbilled.count, 'עבודה שנסגרה ולא חויבה', 'עבודות שנסגרו ולא חויבו')}
                    amount={m.closedUnbilled.estimatedAmount}
                    estimate
                  />
                ) : null}
                {m.maintenanceDue.count > 0 ? (
                  <MoneyRow
                    to="/maintenance"
                    icon={Wrench}
                    label={plural(m.maintenanceDue.count, 'ציוד אחד שמגיע לו טיפול', 'יחידות ציוד שמגיע להן טיפול')}
                    amount={m.maintenanceDue.estimatedAmount}
                    estimate
                  />
                ) : null}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <WeeklyValue week={week} />
    </>
  );
}

function MoneyRow({
  to,
  icon: Icon,
  label,
  amount,
  estimate,
}: {
  to: string;
  icon: typeof Receipt;
  label: string;
  amount: string | null;
  estimate?: boolean;
}) {
  return (
    <li>
      <Link to={to} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-hover">
        <Icon className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1 text-sm text-fg">{label}</span>
        {amount !== null ? (
          <span className="tabular shrink-0 text-sm font-semibold text-fg">
            {estimate ? <span className="font-normal text-fg-subtle">כ-</span> : null}
            {formatCurrency(amount)}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export function WeeklyValue({ week: w }: { week: Brief['week'] }) {
  const items = [
    { n: w.bookedByCustomers, text: plural(w.bookedByCustomers, 'עבודה שלקוח קבע לבד מקישור', 'עבודות שלקוחות קבעו לבד מקישור') },
    {
      n: w.quotesApproved,
      text: `${plural(w.quotesApproved, 'הצעת מחיר אושרה', 'הצעות מחיר אושרו')} (${formatCurrency(w.quotesApprovedAmount)})`,
    },
    { n: w.visitsConfirmed, text: plural(w.visitsConfirmed, 'ביקור שהלקוח אישר', 'ביקורים שלקוחות אישרו') },
    { n: w.statusLinksSent, text: plural(w.statusLinksSent, 'לקוח שקיבל קישור מעקב — בלי שיחת "איפה הטכנאי"', 'לקוחות שקיבלו קישור מעקב — בלי שיחות "איפה הטכנאי"') },
    { n: w.jobsClosed, text: plural(w.jobsClosed, 'עבודה נסגרה', 'עבודות נסגרו') },
  ].filter((i) => i.n > 0);

  if (items.length === 0) return null;

  return (
    <Card className="bg-accent-subtle/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" aria-hidden />
          מה CraftMind עשה בשבילך השבוע
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.text} className="flex items-baseline gap-2 text-sm text-fg">
              <CheckCircle2 className="size-3.5 shrink-0 translate-y-0.5 text-success" aria-hidden />
              {i.text}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const STEPS: Record<Activation['steps'][number]['key'], { title: string; why: string; to: string }> = {
  priceList: { title: 'מחירון', why: 'כל הצעת מחיר וחשבונית נבנות ממנו', to: '/price-list' },
  equipment: { title: 'ציוד ללקוח', why: 'המערכת תזכיר מתי מגיע לו טיפול — ותביא עבודה חוזרת', to: '/customers' },
  statusLink: { title: 'קישור מעקב בוואטסאפ', why: 'הלקוח רואה מתי מגיעים ומאשר — בלי טלפונים', to: '/tasks' },
  quote: { title: 'הצעת מחיר ראשונה', why: 'הלקוח מאשר בלחיצה, והאישור הופך לעבודה', to: '/quotes' },
};

const HIDE_KEY = 'craftmind.activation.hidden';

export function ActivationChecklist({ activation }: { activation: Activation }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (hidden) return null;

  const next = activation.steps.find((s) => !s.done)?.key;
  const pct = Math.round((activation.completed / activation.total) * 100);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>ארבעה צעדים שהופכים את המערכת לשלך</CardTitle>
          <p className="mt-1 text-xs text-fg-muted">
            {activation.completed} מתוך {activation.total} הושלמו
          </p>
        </div>
        <button
          type="button"
          aria-label="הסתרת הרשימה"
          className="grid size-8 place-items-center rounded-md text-fg-subtle hover:bg-surface-hover"
          onClick={() => {
            try {
              localStorage.setItem(HIDE_KEY, '1');
            } catch {
              /* נוחות בלבד */
            }
            setHidden(true);
          }}
        >
          <X className="size-4" aria-hidden />
        </button>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="התקדמות"
        >
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {activation.steps.map((s) => {
            const step = STEPS[s.key];
            return (
              <li key={s.key}>
                <Link
                  to={step.to}
                  className={cn(
                    'flex h-full gap-2.5 rounded-lg border p-3 transition-colors',
                    s.done
                      ? 'border-border bg-surface-sunken'
                      : s.key === next
                        ? 'border-accent-border bg-accent-subtle hover:brightness-105'
                        : 'border-border hover:bg-surface-hover',
                  )}
                >
                  {s.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
                  )}
                  <span>
                    <span className={cn('block text-sm font-medium', s.done ? 'text-fg-muted line-through' : 'text-fg')}>
                      {step.title}
                    </span>
                    {!s.done ? <span className="mt-0.5 block text-xs text-fg-muted">{step.why}</span> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : `${formatNumber(n)} ${many}`;
}
