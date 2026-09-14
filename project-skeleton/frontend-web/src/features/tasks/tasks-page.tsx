import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ClipboardList, Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { PriorityBadge, TaskStatusBadge, statusLabel } from './task-status';
import { request } from '@/lib/api';
import { taskListSchema, taskStatusSchema, type TaskStatus } from '@/lib/schemas';
import { cn, formatRelative } from '@/lib/utils';

const FILTERS: Array<TaskStatus | 'ALL'> = ['ALL', ...taskStatusSchema.options];

export function TasksPage() {
  const [status, setStatus] = useState<TaskStatus | 'ALL'>('ALL');
  const [query, setQuery] = useState('');
  // useDeferredValue — הסינון לא חוסם את ההקלדה. עדיף מ-debounce
  // ידני: React מפסיק רינדור מיושן במקום להמתין בזמן קבוע.
  const deferredQuery = useDeferredValue(query);

  const tasks = useQuery({
    queryKey: ['tasks', { status }],
    queryFn: ({ signal }) =>
      request(`/tasks?take=50${status === 'ALL' ? '' : `&status=${status}`}`, {
        schema: taskListSchema,
        signal,
      }),
  });

  const filtered = tasks.data?.items.filter((t) =>
    deferredQuery.trim() === ''
      ? true
      : `${t.title} ${t.customer?.name ?? ''}`.toLowerCase().includes(deferredQuery.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="משימות"
        description="כל העבודות במערכת"
        action={
          <Button size="sm">
            <Plus aria-hidden />
            משימה חדשה
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          {/* start-3 — ב-RTL האייקון בימין, בלי CSS נפרד לכל כיוון. */}
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי כותרת או לקוח…"
            aria-label="חיפוש משימות"
            className="ps-9"
          />
        </div>

        <div role="tablist" aria-label="סינון לפי סטטוס" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={status === f}
              onClick={() => setStatus(f)}
              className={cn(
                'h-9 rounded-(--radius-md) px-3 text-xs font-medium transition-colors duration-(--duration-fast)',
                status === f
                  ? 'bg-accent-subtle text-accent'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              {f === 'ALL' ? 'הכל' : statusLabel(f)}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {tasks.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : tasks.isError ? (
          <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
        ) : !filtered || filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={query ? 'לא נמצאו תוצאות' : 'אין משימות'}
            description={
              query
                ? 'נסה מונח חיפוש אחר, או שנה את הסינון.'
                : 'משימות נוצרות אוטומטית ממיילים נכנסים, או ידנית.'
            }
          />
        ) : (
          // הטבלה גוללת בתוך המכל שלה. גלילה אופקית של ה-body
          // כולו היא באג, לא פיצ'ר.
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <caption className="sr-only">רשימת משימות</caption>
              <thead>
                <tr className="border-b border-border bg-surface-sunken/60 text-start">
                  <Th>משימה</Th>
                  <Th>לקוח</Th>
                  <Th>עדיפות</Th>
                  <Th>סטטוס</Th>
                  <Th>נוצרה</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((task) => (
                  <tr key={task.id} className="transition-colors hover:bg-surface-hover">
                    <td className="px-4 py-3">
                      <Link
                        to="/tasks/$taskId"
                        params={{ taskId: task.id }}
                        className="font-medium text-fg hover:text-accent"
                      >
                        {task.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-fg-muted">{task.customer?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={task.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <TaskStatusBadge status={task.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-fg-subtle">
                      <time dateTime={task.createdAt}>{formatRelative(task.createdAt)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-4 py-2.5 text-start text-2xs font-medium uppercase tracking-wide text-fg-subtle">
      {children}
    </th>
  );
}
