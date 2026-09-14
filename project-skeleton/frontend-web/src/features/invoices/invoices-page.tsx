import { useQuery } from '@tanstack/react-query';
import { Ban, CheckCircle2, FileText, PencilLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { request } from '@/lib/api';
import type { Invoice } from '@/lib/schemas';
import { formatCurrency, formatDate, formatRelative } from '@/lib/utils';
import { GenerateInvoiceDialog } from './generate-invoice-dialog';
import { invoiceListSchema, invoicesQueryKey } from './invoices-api';

type InvoiceStatus = Invoice['status'];

/**
 * מקור יחיד לתרגום, לגוון ולאייקון של סטטוס חשבונית. הצבע לבדו לא
 * נושא את המשמעות — לכל מצב יש גם אייקון משלו, כי טכנאי שמסתכל על
 * המסך בשמש רואה גוונים שטוחים.
 */
const STATUS: Record<
  InvoiceStatus,
  { label: string; tone: 'neutral' | 'success' | 'danger'; icon: typeof FileText }
> = {
  DRAFT: { label: 'טיוטה', tone: 'neutral', icon: PencilLine },
  FINALIZED: { label: 'הופקה', tone: 'success', icon: CheckCircle2 },
  VOID: { label: 'מבוטלת', tone: 'danger', icon: Ban },
};

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone} dot={false}>
      <Icon className="size-3" aria-hidden />
      {s.label}
    </Badge>
  );
}

const columns: Array<Column<Invoice>> = [
  {
    key: 'invoiceNumber',
    header: 'מספר',
    cell: (inv) => (
      // מספר רץ פר-טננט — דרישה חשבונאית, ולכן הוא הזיהוי הראשי של
      // השורה. ltr-inline כדי שה-# לא יקפוץ לצד הלא נכון בעברית.
      <span className="ltr-inline tabular text-sm font-semibold text-fg">
        #{inv.invoiceNumber}
      </span>
    ),
  },
  {
    key: 'customer',
    header: 'לקוח',
    cell: (inv) => <span className="text-fg">{inv.customer?.name ?? '—'}</span>,
  },
  {
    key: 'period',
    header: 'תקופה',
    cell: (inv) => (
      <span className="ltr-inline tabular text-xs text-fg-muted">
        {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
      </span>
    ),
  },
  {
    key: 'totalAmount',
    header: 'סה״כ',
    // numeric — יישור לסוף + tabular. בלי זה עמודת הכסף לא מתיישרת.
    numeric: true,
    // totalAmount מגיע כ-*מחרוזת* (Decimal(12,2) מהשרת) ועובר
    // כפי שהוא ל-formatCurrency. המרה ל-Number הייתה מחזירה את
    // שגיאת העיגול הבינארית שתוקנה בצד השרת.
    cell: (inv) => <span className="font-medium text-fg">{formatCurrency(inv.totalAmount)}</span>,
  },
  {
    key: 'status',
    header: 'סטטוס',
    cell: (inv) => <InvoiceStatusBadge status={inv.status} />,
  },
  {
    key: 'createdAt',
    header: 'נוצרה',
    cell: (inv) => (
      <time dateTime={inv.createdAt} className="text-xs text-fg-subtle">
        {formatRelative(inv.createdAt)}
      </time>
    ),
  },
];

export function InvoicesPage() {
  const invoices = useQuery({
    queryKey: invoicesQueryKey,
    queryFn: ({ signal }) => request('/invoices', { schema: invoiceListSchema, signal }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="חשבוניות"
        description="כל החשבוניות שהופקו, לפי מספר רץ"
        action={<GenerateInvoiceDialog />}
      />

      <Card className="overflow-hidden">
        {invoices.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : invoices.isError ? (
          <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
        ) : !invoices.data || invoices.data.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="אין חשבוניות"
            description="חשבונית נוצרת בהפקה יזומה: בוחרים לקוח ותקופה, והמערכת מחייבת את המשימות שנסגרו באותה תקופה וטרם חויבו."
            action={<GenerateInvoiceDialog />}
          />
        ) : (
          <DataTable
            caption="רשימת חשבוניות"
            columns={columns}
            rows={invoices.data}
            rowKey={(inv) => inv.id}
          />
        )}
      </Card>
    </div>
  );
}
