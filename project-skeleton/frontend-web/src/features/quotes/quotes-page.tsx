import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, Plus, Send } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { ShareDialog, shareResultSchema, type ShareResult } from '@/components/share-dialog';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
  Textarea,
  useToast,
} from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { customerSchema } from '@/lib/schemas';
import { formatCurrency, formatDate } from '@/lib/utils';
import { fetchPriceList, PRICE_LIST_QUERY_KEY } from '@/features/price-list/price-list-api';

/* ---------------------------------------------------------------------------
   הצעות מחיר.

   הצעה נבנית רק מהמחירון — כך מה שהלקוח מאשר הוא בדיוק מה שהחשבונית
   תחייב בסוף. הלקוח מאשר מקישור, והאישור הופך למשימה חדשה.
   --------------------------------------------------------------------------- */

const quoteStatusSchema = z.enum(['DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'EXPIRED']);
const quoteSchema = z.object({
  id: z.string().uuid(),
  quoteNumber: z.number().int(),
  status: quoteStatusSchema,
  totalAmount: z.string(),
  validUntil: z.string(),
  createdAt: z.string(),
  taskId: z.string().uuid().nullable(),
  customer: z.object({ id: z.string().uuid(), name: z.string() }),
  lines: z.array(z.object({ description: z.string(), amount: z.string() })),
});
type Quote = z.infer<typeof quoteSchema>;

const STATUS: Record<Quote['status'], { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' | 'warning' }> = {
  DRAFT: { label: 'טיוטה', tone: 'neutral' },
  SENT: { label: 'נשלחה', tone: 'info' },
  APPROVED: { label: 'אושרה', tone: 'success' },
  DECLINED: { label: 'נדחתה', tone: 'danger' },
  EXPIRED: { label: 'פג תוקף', tone: 'warning' },
};

const QUOTES_KEY = 'quotes';

export function QuotesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [shared, setShared] = useState<ShareResult | null>(null);

  const list = useQuery({
    queryKey: [QUOTES_KEY],
    queryFn: ({ signal }) => request('/quotes', { schema: z.array(quoteSchema), signal }),
  });

  const send = useMutation({
    mutationFn: (id: string) => request(`/quotes/${id}/send`, { method: 'POST', schema: shareResultSchema }),
    onSuccess: (r) => {
      setShared(r);
      void qc.invalidateQueries({ queryKey: [QUOTES_KEY] });
    },
    onError: (e) => toast.error('השליחה נכשלה', e instanceof ApiError ? e.message : undefined),
  });

  const now = Date.now();
  const rows = list.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="הצעות מחיר"
        description="הלקוח מאשר מקישור, והאישור הופך מיד לעבודה"
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            הצעה חדשה
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileSignature}
            title="עוד אין הצעות מחיר"
            description="הצעה נבנית מהמחירון בכמה לחיצות. הלקוח מאשר בקישור — בלי חתימה ובלי סריקה."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                הצעה חדשה
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((q) => {
              const expired = q.status === 'SENT' && new Date(q.validUntil).getTime() < now;
              const status = STATUS[expired ? 'EXPIRED' : q.status];
              const canSend = (q.status === 'DRAFT' || q.status === 'SENT') && !expired;
              return (
                <li key={q.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
                  <span className="tabular w-14 text-sm text-fg-muted">#{q.quoteNumber}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-fg">{q.customer.name}</p>
                    <p className="truncate text-xs text-fg-muted">{q.lines.map((l) => l.description).join(' · ')}</p>
                  </div>
                  <span className="tabular text-sm font-medium text-fg">{formatCurrency(q.totalAmount)}</span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <span className="hidden text-xs text-fg-subtle sm:inline">בתוקף עד {formatDate(q.validUntil)}</span>
                  {canSend ? (
                    <Button
                      size="sm"
                      variant={q.status === 'DRAFT' ? 'primary' : 'secondary'}
                      loading={send.isPending && send.variables === q.id}
                      onClick={() => send.mutate(q.id)}
                    >
                      <Send aria-hidden />
                      {q.status === 'DRAFT' ? 'שליחה' : 'שליחה שוב'}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {creating ? (
        <NewQuoteDialog
          onClose={() => setCreating(false)}
          onCreated={(q) => {
            setCreating(false);
            void qc.invalidateQueries({ queryKey: [QUOTES_KEY] });
            send.mutate(q.id);
          }}
        />
      ) : null}

      {shared ? (
        <ShareDialog
          result={shared}
          title="שליחת הצעת מחיר"
          description="ההודעה תיפתח ב-WhatsApp שלך. הלקוח יראה את הפירוט ויוכל לאשר בלחיצה."
          onClose={() => setShared(null)}
        />
      ) : null}
    </div>
  );
}

export function NewQuoteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (q: Quote) => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const customers = useQuery({
    queryKey: ['customer-search', term],
    queryFn: ({ signal }) =>
      request(`/customers/search?q=${encodeURIComponent(term)}`, { schema: z.array(customerSchema), signal }),
    enabled: term.length >= 2 && !customer,
  });
  const prices = useQuery({
    queryKey: [PRICE_LIST_QUERY_KEY, false],
    queryFn: ({ signal }) => fetchPriceList(false, signal),
  });

  const total = useMemo(() => {
    // לתצוגה בלבד. השרת מחשב את הסכום ב-Decimal מהמחירון שלו.
    const cents = (prices.data ?? [])
      .filter((p) => codes.includes(p.code))
      .reduce((sum, p) => sum + Math.round(Number(p.price) * 100), 0);
    return (cents / 100).toFixed(2);
  }, [prices.data, codes]);

  const create = useMutation({
    mutationFn: () =>
      request('/quotes', {
        method: 'POST',
        body: { customerId: customer!.id, priceCodes: codes, ...(notes.trim() && { notes: notes.trim() }) },
        schema: quoteSchema,
      }),
    onSuccess: onCreated,
    onError: (e) => toast.error('יצירת ההצעה נכשלה', e instanceof ApiError ? e.message : undefined),
  });

  const toggle = (code: string) => setCodes((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby="new-quote-desc">
        <DialogHeader>
          <DialogTitle>הצעת מחיר חדשה</DialogTitle>
          <DialogDescription id="new-quote-desc">
            בוחרים לקוח ועבודות מהמחירון. כל עבודה מופיעה פעם אחת — כך בדיוק היא תחויב.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {customer ? (
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-sm font-medium text-fg">{customer.name}</span>
              <Button size="sm" variant="ghost" onClick={() => setCustomer(null)}>
                החלפה
              </Button>
            </div>
          ) : (
            // Field מקבל ילד אחד בדיוק (הוא משכפל אותו כדי לשים עליו את
            // ה-aria). רשימת התוצאות יושבת לכן מחוץ לו, והעוטף שומר אותה
            // צמודה לשדה ולא במרווח המלא של גוף הדיאלוג.
            <div>
              <Field label="לקוח" htmlFor="q-customer" required hint="לפחות שתי אותיות">
                <Input id="q-customer" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
              {customers.data && customers.data.length > 0 ? (
                <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-border">
                  {customers.data.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-start text-sm hover:bg-surface-sunken"
                        onClick={() => setCustomer({ id: c.id, name: c.name })}
                      >
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

          <fieldset className="space-y-1">
            <legend className="mb-2 text-sm font-medium text-fg">עבודות</legend>
            {prices.isLoading ? <Skeleton className="h-24 w-full" /> : null}
            {prices.data?.length === 0 ? (
              <p className="text-sm text-fg-muted">המחירון ריק. מוסיפים עבודות במסך "מחירון".</p>
            ) : null}
            <div className="max-h-56 space-y-1 overflow-auto">
              {prices.data?.map((p) => (
                <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-surface-sunken">
                  <Checkbox checked={codes.includes(p.code)} onCheckedChange={() => toggle(p.code)} />
                  <span className="flex-1 text-sm text-fg">{p.description}</span>
                  <span className="tabular text-sm text-fg-muted">{formatCurrency(p.price)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field label="הערות ללקוח" htmlFor="q-notes">
            <Textarea id="q-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <p className="flex justify-between border-t border-border pt-3 text-sm">
            <span className="text-fg-muted">סה״כ</span>
            <span className="tabular font-semibold text-fg">{formatCurrency(total)}</span>
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button disabled={!customer || codes.length === 0} loading={create.isPending} onClick={() => create.mutate()}>
            יצירה ושליחה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
