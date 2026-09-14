import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  TrendingUp,
  UserPlus,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { PageHeader } from '@/components/page-header';
import { PriorityBadge, TaskStatusBadge } from '@/features/tasks/task-status';
import { request } from '@/lib/api';
import { dashboardStatsSchema, taskListSchema } from '@/lib/schemas';
import { formatCurrency, formatNumber, formatRelative } from '@/lib/utils';

export function DashboardPage() {
  const stats = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: ({ signal }) => request('/dashboard/stats', { schema: dashboardStatsSchema, signal }),
  });

  const recent = useQuery({
    queryKey: ['tasks', { recent: true }],
    queryFn: ({ signal }) =>
      request('/tasks?take=8&urgentFirst=true', { schema: taskListSchema, signal }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="סקירה" description="מה פתוח עכשיו" />

      {/* המספר הזה לבדו מצדיק פעולה מיידית, ולכן הוא מעל הכל
          ומופיע רק כשהוא רלוונטי. באנר קבוע נעלם מהעין. */}
      {stats.data && stats.data.overdueUrgent > 0 ? (
        <Link
          to="/tasks"
          className="flex items-center gap-2.5 rounded-(--radius-lg) border border-danger-border bg-danger-subtle px-4 py-3 transition-colors hover:brightness-105"
        >
          <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden />
          <span className="text-sm text-danger">
            <strong className="tabular font-semibold">{stats.data.overdueUrgent}</strong>{' '}
            {stats.data.overdueUrgent === 1 ? 'משימה דחופה פתוחה' : 'משימות דחופות פתוחות'} מעל 24
            שעות
          </span>
        </Link>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={ClipboardList}
          label="משימות פתוחות"
          value={stats.data?.openTasks}
          tone="accent"
          query={stats}
          to="/tasks"
        />
        <Stat
          icon={UserPlus}
          label="ממתינות לשיוך"
          value={stats.data?.unassignedTasks}
          tone={stats.data?.unassignedTasks ? 'warning' : 'accent'}
          query={stats}
          to="/tasks"
        />
        <Stat
          icon={TrendingUp}
          label="הושלמו החודש"
          value={stats.data?.closedThisMonth}
          tone="success"
          query={stats}
        />
        <Stat
          icon={Boxes}
          label="מלאי בחוסר"
          value={stats.data?.lowStockItems}
          tone={stats.data?.lowStockItems ? 'danger' : 'accent'}
          query={stats}
          to="/inventory"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>משימות אחרונות</CardTitle>
            <Link to="/tasks" className="text-xs font-medium text-accent hover:underline">
              הצג הכל
            </Link>
          </CardHeader>

          {recent.isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </div>
          ) : recent.isError ? (
            <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
          ) : recent.data?.items.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="אין עדיין משימות"
              description="משימות נוצרות אוטומטית ממיילים נכנסים, או ידנית ממסך המשימות."
            />
          ) : (
            <ul className="divide-y divide-border">
              {recent.data?.items.map((task) => (
                <li key={task.id}>
                  <Link
                    to="/tasks/$taskId"
                    params={{ taskId: task.id }}
                    className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{task.title}</p>
                      <p className="truncate text-xs text-fg-muted">
                        {task.customer?.name ?? '—'}
                        {task.assignedTo ? ` · ${task.assignedTo.name}` : ' · לא שויך'}
                      </p>
                    </div>
                    <PriorityBadge priority={task.priority} />
                    <TaskStatusBadge status={task.status} />
                    <time
                      dateTime={task.createdAt}
                      className="hidden w-20 shrink-0 text-start text-xs text-fg-subtle sm:block"
                    >
                      {formatRelative(task.createdAt)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleDollarSign className="size-4 text-fg-subtle" aria-hidden />
              הכנסות החודש
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.isLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <>
                <p className="tabular text-2xl font-semibold text-fg">
                  {formatCurrency(stats.data?.revenueThisMonth ?? '0')}
                </p>
                <p className="mt-1 text-xs text-fg-subtle">חשבוניות שהופקו מתחילת החודש</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const TONE = {
  accent: 'bg-accent-subtle text-accent',
  warning: 'bg-warning-subtle text-warning',
  success: 'bg-success-subtle text-success',
  danger: 'bg-danger-subtle text-danger',
} as const;

function Stat({
  icon: Icon,
  label,
  value,
  tone,
  query,
  to,
}: {
  icon: typeof ClipboardList;
  label: string;
  value: number | undefined;
  tone: keyof typeof TONE;
  query: { isLoading: boolean; isError: boolean };
  to?: string;
}) {
  const body = (
    <CardContent className="flex items-center gap-3.5">
      <div className={`grid size-9 shrink-0 place-items-center rounded-(--radius-md) ${TONE[tone]}`}>
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-fg-muted">{label}</p>
        {query.isLoading ? (
          <Skeleton className="mt-1 h-6 w-10" />
        ) : query.isError ? (
          // לא מציגים 0 כשהשליפה נכשלה — אפס שקרי גרוע מ"לא ידוע".
          <p className="text-xl font-semibold text-fg-subtle" title="לא ניתן לטעון">
            —
          </p>
        ) : (
          <p className="tabular text-xl font-semibold text-fg">{formatNumber(value ?? 0)}</p>
        )}
      </div>
    </CardContent>
  );

  if (!to) return <Card>{body}</Card>;
  return (
    <Card className="transition-colors hover:border-border-strong">
      <Link to={to} className="block">
        {body}
      </Link>
    </Card>
  );
}
