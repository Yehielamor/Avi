import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Search, Users } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { NewCustomerDialog } from './new-customer-dialog';
import { request } from '@/lib/api';
import { customerListSchema, customerSchema, type Customer } from '@/lib/schemas';
import { formatRelative } from '@/lib/utils';

const PAGE_SIZE = 50;

/** SearchCustomersQueryDto מחייב שני תווים — מתחת לזה השרת מחזיר 400. */
const MIN_SEARCH_LENGTH = 2;

/** `/customers/search` מחזיר מערך שטוח, לא עמוד מעומד כמו `/customers`. */
const customerSearchSchema = z.array(customerSchema);

const columns: Array<Column<Customer>> = [
  {
    key: 'name',
    header: 'שם',
    cell: (c) => (
      <Link
        to="/customers/$customerId"
        params={{ customerId: c.id }}
        className="font-medium text-fg hover:text-accent"
      >
        {c.name}
      </Link>
    ),
  },
  {
    key: 'email',
    header: 'אימייל',
    cell: (c) =>
      c.email ? (
        // ltr-inline — בלי זה ה-@ והנקודות קופצים לצד הלא נכון בשורה עברית.
        <a href={`mailto:${c.email}`} className="ltr-inline text-fg-muted hover:text-accent">
          {c.email}
        </a>
      ) : (
        <span className="text-fg-subtle">—</span>
      ),
  },
  {
    key: 'phone',
    header: 'טלפון',
    cell: (c) =>
      c.phone ? (
        <a href={`tel:${c.phone}`} className="ltr-inline tabular text-fg-muted hover:text-accent">
          {c.phone}
        </a>
      ) : (
        <span className="text-fg-subtle">—</span>
      ),
  },
  {
    key: 'createdAt',
    header: 'נוצר',
    cell: (c) => (
      <time dateTime={c.createdAt} className="text-xs text-fg-subtle">
        {formatRelative(c.createdAt)}
      </time>
    ),
  },
];

export function CustomersPage() {
  const [query, setQuery] = useState('');
  // useDeferredValue — ההקלדה לא נחסמת ו-React נוטש רינדור מיושן,
  // במקום להמתין זמן קבוע כמו ב-debounce ידני.
  const deferredQuery = useDeferredValue(query);
  const term = deferredQuery.trim();
  const isSearching = term.length >= MIN_SEARCH_LENGTH;

  const list = useInfiniteQuery({
    queryKey: ['customers', 'list'],
    queryFn: ({ pageParam, signal }) =>
      request(`/customers?take=${PAGE_SIZE}${pageParam ? `&cursor=${pageParam}` : ''}`, {
        schema: customerListSchema,
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !isSearching,
  });

  const search = useQuery({
    queryKey: ['customers', 'search', term],
    queryFn: ({ signal }) =>
      request(`/customers/search?q=${encodeURIComponent(term)}`, {
        schema: customerSearchSchema,
        signal,
      }),
    enabled: isSearching,
  });

  const active = isSearching ? search : list;
  const rows: Customer[] = isSearching
    ? (search.data ?? [])
    : (list.data?.pages.flatMap((p) => p.items) ?? []);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="לקוחות" description="כל הלקוחות של העסק" action={<NewCustomerDialog />} />

      <div className="relative max-w-sm">
        {/* start-3 — ב-RTL האייקון יושב בימין, בלי CSS נפרד לכל כיוון. */}
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם, אימייל או טלפון…"
          aria-label="חיפוש לקוחות"
          className="ps-9"
        />
        {query.trim().length > 0 && !isSearching ? (
          <p className="mt-1.5 text-2xs text-fg-subtle">נא להזין לפחות שני תווים לחיפוש.</p>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {active.isLoading ? (
          <div className="divide-y divide-border" aria-busy>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : active.isError ? (
          <ErrorState error={active.error} onRetry={() => void active.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={isSearching ? 'לא נמצאו לקוחות' : 'אין עדיין לקוחות'}
            description={
              isSearching
                ? `אף לקוח לא תואם ל"${term}". החיפוש בודק שם, אימייל וטלפון של לקוחות פעילים בלבד — נסה מונח קצר יותר, או צור לקוח חדש.`
                : 'לקוחות נוצרים אוטומטית ממיילים נכנסים שמגיעים לתיבה המחוברת, או ידנית כאן. כל עוד לא הגיע מייל ולא נוצר לקוח, הרשימה ריקה.'
            }
            action={<NewCustomerDialog />}
          />
        ) : (
          <>
            <DataTable
              caption="רשימת לקוחות"
              columns={columns}
              rows={rows}
              rowKey={(c) => c.id}
            />
            {!isSearching && list.hasNextPage ? (
              <div className="flex justify-center border-t border-border p-3">
                <Button
                  variant="secondary"
                  onClick={() => void list.fetchNextPage()}
                  loading={list.isFetchingNextPage}
                >
                  טען עוד לקוחות
                </Button>
              </div>
            ) : null}
            {isSearching ? (
              <p className="border-t border-border px-4 py-2.5 text-2xs text-fg-subtle">
                תוצאות החיפוש מוגבלות ל-10 הלקוחות העדכניים ביותר התואמים.
              </p>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
