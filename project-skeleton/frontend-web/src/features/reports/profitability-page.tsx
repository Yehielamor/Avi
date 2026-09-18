import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, PiggyBank } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Skeleton, Tabs, TabsList, TabsTrigger } from '@/components/ui';
import { request } from '@/lib/api';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';

/* ---------------------------------------------------------------------------
   רווחיות.

   המטרה: שבעל העסק יגלה אילו עבודות מרוויחות ואילו לא. לכן הדו"ח אומר
   בקול כשהוא לא יודע — חלק בלי עלות, עבודה שעוד לא חויבה, ושעות עבודה
   שאין לנו בכלל — במקום להציג מספר נקי שנראה בטוח ואינו.
   --------------------------------------------------------------------------- */

const lineSchema = z.object({
  key: z.string(),
  jobs: z.number().int(),
  revenue: z.string(),
  partsCost: z.string(),
  grossProfit: z.string(),
  marginPct: z.number().nullable(),
  hasEstimates: z.boolean(),
  partial: z.boolean(),
});
type Line = z.infer<typeof lineSchema>;
const reportSchema = z.object({
  from: z.string(),
  to: z.string(),
  truncated: z.boolean(),
  total: lineSchema.nullable(),
  byJobType: z.array(lineSchema),
  byTechnician: z.array(lineSchema),
  byCustomer: z.array(lineSchema),
});

type Preset = 'this_month' | 'last_month' | 'last_90';
const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: 'this_month', label: 'החודש' },
  { value: 'last_month', label: 'חודש שעבר' },
  { value: 'last_90', label: '90 יום' },
];

/** טווח תאריכים לפי לוח השנה בישראל, כ-YYYY-MM-DD. */
function range(preset: Preset): { from: string; to: string } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const [y, m] = today.split('-').map(Number) as [number, number];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === 'this_month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === 'last_month') {
    return { from: iso(new Date(Date.UTC(y, m - 2, 1))), to: iso(new Date(Date.UTC(y, m - 1, 0))) };
  }
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 89);
  return { from: iso(d), to: today };
}

type Group = 'byJobType' | 'byTechnician' | 'byCustomer';

export function ProfitabilityPage() {
  const [preset, setPreset] = useState<Preset>('this_month');
  const [group, setGroup] = useState<Group>('byJobType');
  const { from, to } = range(preset);

  const report = useQuery({
    queryKey: ['profitability', from, to],
    queryFn: ({ signal }) => request(`/reports/profitability?from=${from}&to=${to}`, { schema: reportSchema, signal }),
  });

  const r = report.data;
  const t = r?.total;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="רווחיות" description="כמה נשאר מכל עבודה אחרי החלקים" />

      <Tabs value={preset} onValueChange={(v) => setPreset(v as Preset)}>
        <TabsList aria-label="תקופה">
          {PRESETS.map((p) => (
            <TabsTrigger key={p.value} value={p.value} className="h-11 px-4 text-sm">
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {report.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : !t ? (
        <Card>
          <EmptyState icon={PiggyBank} title="אין עבודות שנסגרו בתקופה" description="הדו״ח נבנה מעבודות סגורות. נסו תקופה ארוכה יותר." />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="הכנסה" value={formatCurrency(t.revenue)} sub={`${formatNumber(t.jobs)} עבודות`} />
            <Stat label="עלות חלקים" value={formatCurrency(t.partsCost)} />
            <Stat
              label="רווח גולמי"
              value={formatCurrency(t.grossProfit)}
              sub={t.marginPct === null ? undefined : `${t.marginPct}% מההכנסה`}
              tone={Number(t.grossProfit) < 0 ? 'danger' : 'success'}
            />
          </div>

          <Caveats total={t} />

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>פירוט</CardTitle>
              <Tabs value={group} onValueChange={(v) => setGroup(v as Group)}>
                <TabsList aria-label="קיבוץ">
                  <TabsTrigger value="byJobType" className="h-10 px-3 text-sm">סוג עבודה</TabsTrigger>
                  <TabsTrigger value="byTechnician" className="h-10 px-3 text-sm">טכנאי</TabsTrigger>
                  <TabsTrigger value="byCustomer" className="h-10 px-3 text-sm">לקוח</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <BreakdownTable lines={r[group]} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'success' | 'danger' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-fg-muted">{label}</p>
        <p
          className={cn(
            'tabular mt-1 text-2xl font-semibold',
            tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-fg',
          )}
        >
          {value}
        </p>
        {sub ? <p className="mt-0.5 text-xs text-fg-subtle">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function Caveats({ total }: { total: Line }) {
  const notes: React.ReactNode[] = [];
  if (total.partial) {
    notes.push(
      <>
        חלק מהחלקים שנצרכו חסרים עלות קנייה, ולכן <strong>הרווח בפועל נמוך מהמוצג</strong>.{' '}
        <Link to="/inventory" className="underline">
          השלמת עלויות במלאי
        </Link>
      </>,
    );
  }
  if (total.hasEstimates) notes.push('עבודות שעוד לא חויבו מוערכות לפי המחירון הנוכחי.');
  notes.push('עלות שעות עבודה ונסיעות אינה כלולה — הרווח הוא לפני כוח אדם.');

  return (
    <ul className="space-y-1.5 rounded-xl border border-border bg-surface-sunken px-4 py-3 text-sm text-fg-muted">
      {notes.map((n, i) => (
        <li key={i} className="flex gap-2">
          <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', i === 0 && total.partial ? 'text-warning' : 'text-fg-subtle')} aria-hidden />
          <span>{n}</span>
        </li>
      ))}
    </ul>
  );
}

function BreakdownTable({ lines }: { lines: Line[] }) {
  return (
    <table className="w-full min-w-[36rem] text-sm">
      <thead>
        <tr className="border-b border-border text-xs text-fg-muted">
          <th className="px-4 py-2.5 text-start font-medium">שם</th>
          <th className="px-4 py-2.5 text-end font-medium">עבודות</th>
          <th className="px-4 py-2.5 text-end font-medium">הכנסה</th>
          <th className="px-4 py-2.5 text-end font-medium">חלקים</th>
          <th className="px-4 py-2.5 text-end font-medium">רווח גולמי</th>
          <th className="px-4 py-2.5 text-end font-medium">%</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {lines.map((l) => {
          const loss = Number(l.grossProfit) < 0;
          return (
            <tr key={l.key}>
              <td className="px-4 py-2.5 text-fg">
                {l.key}{' '}
                {l.partial ? (
                  <Badge tone="warning" dot={false}>
                    חלקי
                  </Badge>
                ) : null}
              </td>
              <td className="tabular px-4 py-2.5 text-end text-fg-muted">{formatNumber(l.jobs)}</td>
              <td className="tabular px-4 py-2.5 text-end text-fg">{formatCurrency(l.revenue)}</td>
              <td className="tabular px-4 py-2.5 text-end text-fg-muted">{formatCurrency(l.partsCost)}</td>
              <td className={cn('tabular px-4 py-2.5 text-end font-medium', loss ? 'text-danger' : 'text-fg')}>
                {formatCurrency(l.grossProfit)}
              </td>
              <td className={cn('tabular px-4 py-2.5 text-end', loss ? 'text-danger' : 'text-fg-muted')}>
                {l.marginPct === null ? '—' : `${l.marginPct}%`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
