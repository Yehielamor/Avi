import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Search, Tag } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { PriceItemDialog } from './price-item-dialog';
import { PRICE_LIST_QUERY_KEY, fetchPriceList, type PriceListItem } from './price-list-api';

/* ---------------------------------------------------------------------------
   המחירון.

   עד עכשיו הוא נקבע באונבורדינג וקפא: בעל עסק שהעלה מחיר לא יכול היה
   לעדכן אותו, וכל חשבונית יצאה במחיר הישן.

   מחירון של עסק שירות הוא עשרות עד מאות שורות, ולכן הסינון כאן בצד
   הלקוח — חיפוש מיידי בלי בקשה על כל הקשה.
   --------------------------------------------------------------------------- */

type Dialog = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; item: PriceListItem };

export function PriceListPage() {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [dialog, setDialog] = useState<Dialog>({ mode: 'closed' });

  const list = useQuery({
    queryKey: [PRICE_LIST_QUERY_KEY, includeInactive],
    queryFn: ({ signal }) => fetchPriceList(includeInactive, signal),
  });

  const rows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const all = list.data ?? [];
    if (!q) return all;
    return all.filter((i) => i.code.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
  }, [list.data, deferredSearch]);

  const openCreate = () => setDialog({ mode: 'create' });
  const columns = buildColumns((item) => setDialog({ mode: 'edit', item }));
  const hasAny = (list.data?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="מחירון"
        description="מחירי העבודות שמהם החשבוניות מחושבות"
        action={
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden />
            פריט חדש
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-fg-subtle"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי קוד או תיאור"
            aria-label="חיפוש במחירון"
            className="ps-9"
          />
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-fg-muted">
          <Switch checked={includeInactive} onCheckedChange={setIncludeInactive} aria-label="הצגת פריטים מושבתים" />
          הצגת מושבתים
        </label>
      </div>

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <TableSkeleton />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !hasAny ? (
          <EmptyState
            icon={Tag}
            title="המחירון ריק"
            description="בלי מחירים, חשבוניות יוצאות ריקות. הוסיפו את העבודה הראשונה שאתם מחייבים עליה."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus aria-hidden />
                פריט חדש
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Search}
            title="לא נמצאו פריטים"
            description={`אין קוד או תיאור שמכילים "${deferredSearch.trim()}".`}
            action={
              <Button variant="secondary" size="sm" onClick={() => setSearch('')}>
                ניקוי החיפוש
              </Button>
            }
          />
        ) : (
          <>
            <DataTable caption="פריטי המחירון" columns={columns} rows={rows} rowKey={(r) => r.id} />
            <p
              className="border-t border-border bg-surface-sunken/50 px-4 py-2.5 text-2xs text-fg-muted"
              aria-live="polite"
            >
              <span className="tabular">{formatNumber(rows.length)}</span> פריטים
              {rows.length !== list.data?.length ? (
                <>
                  {' '}
                  מתוך <span className="tabular">{formatNumber(list.data?.length ?? 0)}</span>
                </>
              ) : null}
            </p>
          </>
        )}
      </Card>

      {dialog.mode !== 'closed' ? (
        <PriceItemDialog
          // מפתח לפי פריט: כל פתיחה מקבלת טופס נקי עם הערכים העדכניים.
          key={dialog.mode === 'edit' ? dialog.item.id : 'new'}
          item={dialog.mode === 'edit' ? dialog.item : null}
          onClose={() => setDialog({ mode: 'closed' })}
        />
      ) : null}
    </div>
  );
}

function buildColumns(onEdit: (item: PriceListItem) => void): Array<Column<PriceListItem>> {
  return [
    {
      key: 'code',
      header: 'קוד',
      cell: (row) => (
        <span className={row.isActive ? 'ltr-inline font-medium text-fg' : 'ltr-inline text-fg-subtle line-through'}>
          {row.code}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'תיאור',
      cell: (row) => <span className={row.isActive ? 'text-fg' : 'text-fg-subtle'}>{row.description}</span>,
    },
    {
      key: 'price',
      header: 'מחיר',
      numeric: true,
      // המחרוזת מוצגת כמות שהיא, דרך formatCurrency לתצוגה בלבד. היא
      // לעולם לא נשלחת חזרה אחרי שעברה דרך number.
      cell: (row) => <span className="tabular font-medium text-fg">{formatCurrency(row.price)}</span>,
    },
    {
      key: 'usedByTemplates',
      header: 'בתבניות',
      numeric: true,
      cell: (row) =>
        row.usedByTemplates === 0 ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className="tabular text-fg-muted">{formatNumber(row.usedByTemplates)}</span>
        ),
    },
    {
      key: 'status',
      header: 'סטטוס',
      cell: (row) =>
        row.isActive ? (
          <Badge tone="success">פעיל</Badge>
        ) : (
          <Badge tone="neutral">מושבת</Badge>
        ),
    },
    {
      key: 'actions',
      header: 'פעולות',
      className: 'text-end',
      cell: (row) => (
        <Button variant="ghost" size="icon" onClick={() => onEdit(row)} aria-label={`עריכת ${row.code}`}>
          <Pencil aria-hidden />
        </Button>
      ),
    },
  ];
}

function TableSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
      ))}
    </div>
  );
}
