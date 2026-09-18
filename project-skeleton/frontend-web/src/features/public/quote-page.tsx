import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button, Skeleton } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { PublicShell } from './public-shell';

/* ---------------------------------------------------------------------------
   הצעת מחיר שהלקוח פותח מקישור.

   אישור כאן יוצר עבודה אצל בעל העסק — ולכן הוא מאחורי שלב אישור שני,
   ומציג במפורש את הסכום שמאשרים. "לא עכשיו" הוא כפתור משני ולא נסתר:
   לקוח שלא מצליח לסרב פשוט לא עונה, ובעל העסק נשאר בלי תשובה.
   --------------------------------------------------------------------------- */

const viewSchema = z.object({
  businessName: z.string(),
  quoteNumber: z.number().int(),
  createdAt: z.string(),
  validUntil: z.string(),
  notes: z.string().nullable(),
  lines: z.array(z.object({ description: z.string(), amount: z.string() })),
  totalAmount: z.string(),
  status: z.enum(['DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'EXPIRED']),
  canRespond: z.boolean(),
});
type View = z.infer<typeof viewSchema>;

const dateFmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long', year: 'numeric' });

export function QuotePage() {
  const { token } = useParams({ from: '/c/q/$token' });
  const qc = useQueryClient();
  const key = ['public-quote', token];
  const [confirming, setConfirming] = useState(false);

  const view = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => request(`/public/quote/${token}`, { schema: viewSchema, signal }),
    retry: false,
  });

  const respond = useMutation({
    mutationFn: (action: 'approve' | 'decline') =>
      request(`/public/quote/${token}/${action}`, { method: 'POST', schema: viewSchema }),
    onSuccess: (v: View) => {
      qc.setQueryData(key, v);
      setConfirming(false);
    },
  });

  if (view.isLoading) {
    return (
      <PublicShell>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-6 h-56 w-full" />
      </PublicShell>
    );
  }
  if (view.isError || !view.data) {
    return (
      <PublicShell>
        <div className="py-10 text-center">
          <XCircle className="mx-auto size-10 text-fg-subtle" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold text-fg">הקישור אינו בתוקף</h1>
          <p className="mt-1 text-sm text-fg-muted">אפשר לבקש מבעל העסק לשלוח את ההצעה שוב.</p>
        </div>
      </PublicShell>
    );
  }

  const v = view.data;

  return (
    <PublicShell business={v.businessName}>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-fg">הצעת מחיר</h1>
        <span className="tabular text-sm text-fg-muted">מס׳ {v.quoteNumber}</span>
      </div>
      <p className="mt-1 text-xs text-fg-muted">בתוקף עד {dateFmt.format(new Date(v.validUntil))}</p>

      <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface">
        <ul className="divide-y divide-border">
          {v.lines.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-4 px-4 py-3">
              <span className="text-sm text-fg">{l.description}</span>
              <span className="tabular shrink-0 text-sm text-fg">{formatCurrency(l.amount)}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-border bg-surface-sunken px-4 py-3.5">
          <span className="font-medium text-fg">סה״כ</span>
          <span className="tabular text-lg font-semibold text-fg">{formatCurrency(v.totalAmount)}</span>
        </div>
      </section>

      {v.notes ? <p className="mt-4 whitespace-pre-wrap text-sm text-fg-muted">{v.notes}</p> : null}

      {v.status === 'APPROVED' ? (
        <Result tone="success" title="ההצעה אושרה" body={`${v.businessName} יחזרו אליך לתיאום מועד.`} />
      ) : v.status === 'DECLINED' ? (
        <Result title="ההצעה נדחתה" body="תודה על התשובה. אפשר תמיד לפנות שוב." />
      ) : v.status === 'EXPIRED' ? (
        <Result title="פג תוקף ההצעה" body="אפשר לבקש מבעל העסק הצעה מעודכנת." />
      ) : v.canRespond ? (
        confirming ? (
          <div className="mt-6 space-y-3 rounded-2xl border border-accent-border bg-accent-subtle p-4">
            <p className="text-sm text-fg">
              לאשר את ההצעה על סך <strong className="tabular">{formatCurrency(v.totalAmount)}</strong>?
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" loading={respond.isPending} onClick={() => respond.mutate('approve')}>
                כן, מאשר/ת
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                חזרה
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-2">
            <Button size="lg" className="h-14 w-full text-base" onClick={() => setConfirming(true)}>
              <CheckCircle2 aria-hidden />
              אישור ההצעה
            </Button>
            <Button variant="ghost" className="w-full" loading={respond.isPending} onClick={() => respond.mutate('decline')}>
              לא עכשיו
            </Button>
          </div>
        )
      ) : null}

      {respond.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {respond.error instanceof ApiError && respond.error.status === 409
            ? 'לא ניתן לענות על ההצעה הזו יותר. רעננו את הדף.'
            : 'הפעולה לא הצליחה. נסו שוב בעוד רגע.'}
        </p>
      ) : null}
    </PublicShell>
  );
}

function Result({ title, body, tone }: { title: string; body: string; tone?: 'success' }) {
  return (
    <div className={`mt-6 rounded-2xl p-4 ${tone === 'success' ? 'bg-success-subtle' : 'bg-surface-sunken'}`}>
      <p className={`font-medium ${tone === 'success' ? 'text-success' : 'text-fg'}`}>{title}</p>
      <p className="mt-1 text-sm text-fg-muted">{body}</p>
    </div>
  );
}
