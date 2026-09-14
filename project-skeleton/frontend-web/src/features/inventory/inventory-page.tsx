import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  PackageSearch,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { InventoryItem } from '@/lib/schemas';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { AdjustQuantityDialog } from './adjust-quantity-dialog';
import {
  INVENTORY_QUERY_KEY,
  PAGE_SIZE,
  fetchInventory,
  isLowStock,
  type InventoryScope,
} from './inventory-api';
import { NewItemDialog } from './new-item-dialog';

/* ---------------------------------------------------------------------------
   מסך המלאי.

   נכתב לוורטיקל RETAIL — עשרות אלפי מק"טים לטננט. לכן אין כאן שליפה
   של כל הטבלה וסינון בזיכרון: לשונית "מלאי בחוסר" פונה ל-`/inventory/
   low-stock`, שמשווה את שתי העמודות ב-SQL ומעמד בשרת.
   --------------------------------------------------------------------------- */

export function InventoryPage() {
  const [scope, setScope] = useState<InventoryScope>('all');
  const [adjustTarget, setAdjustTarget] = useState<InventoryItem | null>(null);
  const [newItemOpen, setNewItemOpen] = useState(false);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="מלאי"
        description="ניהול מק״טים, כמויות ומחירים"
        action={
          <Button size="sm" onClick={() => setNewItemOpen(true)}>
            <Plus aria-hidden />
            פריט חדש
          </Button>
        }
      />

      <Tabs value={scope} onValueChange={(v) => setScope(v as InventoryScope)}>
        <TabsList>
          {/* h-11 — אזור מגע 44px, כמו בכל שאר הפקדים. */}
          <TabsTrigger value="all" className="h-11 px-4 text-sm">
            כל הפריטים
          </TabsTrigger>
          <TabsTrigger value="low" className="h-11 px-4 text-sm">
            מלאי בחוסר
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <InventoryTab scope="all" onAdjust={setAdjustTarget} onCreate={() => setNewItemOpen(true)} />
        </TabsContent>
        <TabsContent value="low">
          <InventoryTab scope="low" onAdjust={setAdjustTarget} onCreate={() => setNewItemOpen(true)} />
        </TabsContent>
      </Tabs>

      {/* מפתח לפי מזהה: כל פתיחה מקבלת טופס נקי עם הכמות העדכנית. */}
      {adjustTarget ? (
        <AdjustQuantityDialog
          key={adjustTarget.id}
          item={adjustTarget}
          onClose={() => setAdjustTarget(null)}
        />
      ) : null}

      {newItemOpen ? <NewItemDialog onClose={() => setNewItemOpen(false)} /> : null}
    </div>
  );
}

function InventoryTab({
  scope,
  onAdjust,
  onCreate,
}: {
  scope: InventoryScope;
  onAdjust: (item: InventoryItem) => void;
  onCreate: () => void;
}) {
  const [page, setPage] = useState(0);

  const list = useQuery({
    queryKey: [INVENTORY_QUERY_KEY, scope, page],
    queryFn: ({ signal }) => fetchInventory(scope, page, signal),
    // שמירת העמוד הקודם על המסך בזמן דפדוף — בלי זה כל לחיצה
    // מחליפה טבלה מלאה בשלד ומקפיצה את הפריסה.
    placeholderData: keepPreviousData,
  });

  const rows = list.data ?? [];
  const hasNext = rows.length === PAGE_SIZE;

  const columns = buildColumns(scope, onAdjust);

  return (
    <Card className="overflow-hidden">
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        scope === 'low' ? (
          <EmptyState
            icon={ShieldCheck}
            title="אין פריטים בחוסר"
            description="כל הפריטים הפעילים מעל סף ההתראה שלהם."
          />
        ) : page > 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="אין פריטים בעמוד הזה"
            description="ייתכן שפריטים נמחקו מאז. חזרו לעמוד הקודם."
            action={
              <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))}>
                לעמוד הקודם
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={PackageSearch}
            title="אין פריטים במלאי"
            description="הוסיפו את המק״ט הראשון כדי שניכוי אוטומטי בסגירת משימה יוכל לעבוד."
            action={
              <Button size="sm" onClick={onCreate}>
                <Plus aria-hidden />
                פריט חדש
              </Button>
            }
          />
        )
      ) : (
        <>
          <DataTable
            caption={scope === 'low' ? 'פריטי מלאי מתחת לסף ההתראה' : 'רשימת פריטי מלאי'}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
          />
          <Pagination
            page={page}
            count={rows.length}
            hasNext={hasNext}
            busy={list.isFetching}
            onChange={setPage}
          />
        </>
      )}
    </Card>
  );
}

function buildColumns(
  scope: InventoryScope,
  onAdjust: (item: InventoryItem) => void,
): Array<Column<InventoryItem>> {
  const sku: Column<InventoryItem> = {
    key: 'sku',
    header: 'מק״ט',
    // מזהה — LTR גם בתוך טבלה עברית, אחרת מקפים קופצים לצד הלא נכון.
    cell: (row) => <span className="ltr-inline font-medium text-fg">{row.sku}</span>,
  };

  const name: Column<InventoryItem> = {
    key: 'name',
    header: 'שם הפריט',
    cell: (row) => <span className="text-fg">{row.name}</span>,
  };

  const quantity: Column<InventoryItem> = {
    key: 'quantity',
    header: 'כמות',
    numeric: true,
    cell: (row) =>
      isLowStock(row) ? (
        // לא צבע בלבד: ל-Badge יש רקע, גבול ונקודה, ובנוסף טקסט
        // לקורא מסך. גוון שטוח לבדו נעלם באור שמש ולעיוורי צבעים.
        <Badge tone="danger" className="tabular">
          {formatNumber(row.quantity)}
          <span className="sr-only">— מלאי בחוסר</span>
        </Badge>
      ) : (
        <span className="tabular text-fg">{formatNumber(row.quantity)}</span>
      ),
  };

  const actions: Column<InventoryItem> = {
    key: 'actions',
    header: 'פעולות',
    className: 'text-end',
    cell: (row) => (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onAdjust(row)}
        aria-label={`עדכון כמות עבור ${row.name}`}
      >
        <SlidersHorizontal aria-hidden />
      </Button>
    ),
  };

  if (scope === 'low') {
    // `/inventory/low-stock` מחזיר projection מצומצם (StockRow) ללא
    // category ו-unitPrice. מוטב להציג את מה שיש מאשר עמודה של מקפים.
    return [
      sku,
      name,
      quantity,
      {
        key: 'lowStockThreshold',
        header: 'סף התראה',
        numeric: true,
        cell: (row) => (
          <span className="tabular text-fg-muted">{formatNumber(row.lowStockThreshold)}</span>
        ),
      },
      actions,
    ];
  }

  return [
    sku,
    name,
    {
      key: 'category',
      header: 'קטגוריה',
      cell: (row) => <span className="text-fg-muted">{row.category ?? '—'}</span>,
    },
    quantity,
    {
      key: 'unitPrice',
      header: 'מחיר ליחידה',
      numeric: true,
      // unitPrice מגיע כמחרוזת (Decimal מסורלז). לא להמיר ל-number.
      cell: (row) => (
        <span className="tabular text-fg">
          {row.unitPrice == null ? '—' : formatCurrency(row.unitPrice)}
        </span>
      ),
    },
    actions,
  ];
}

function Pagination({
  page,
  count,
  hasNext,
  busy,
  onChange,
}: {
  page: number;
  count: number;
  hasNext: boolean;
  busy: boolean;
  onChange: (next: number) => void;
}) {
  const from = page * PAGE_SIZE + 1;
  const to = page * PAGE_SIZE + count;

  return (
    <nav
      aria-label="עימוד פריטי מלאי"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-sunken/50 px-4 py-2.5"
    >
      <p className="text-2xs text-fg-muted" aria-live="polite">
        מציג <span className="tabular">{formatNumber(from)}</span>–
        <span className="tabular">{formatNumber(to)}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page === 0 || busy}
          onClick={() => onChange(Math.max(0, page - 1))}
        >
          <ChevronRight aria-hidden />
          הקודם
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasNext || busy}
          onClick={() => onChange(page + 1)}
        >
          הבא
          <ChevronLeft aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

function TableSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
