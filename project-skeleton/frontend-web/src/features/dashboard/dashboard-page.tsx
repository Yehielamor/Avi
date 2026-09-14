import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, Clock, TrendingUp } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { TaskStatusBadge, PriorityBadge } from '@/features/tasks/task-status';
import { request } from '@/lib/api';
import { taskListSchema } from '@/lib/schemas';
import { formatRelative } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';

export function DashboardPage() {
  const openTasks = useQuery({
    queryKey: ['tasks', { status: 'open' }],
    queryFn: ({ signal }) =>
      request('/tasks?take=8', { schema: taskListSchema, signal }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="סקירה" description="מה פתוח עכשיו" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={ClipboardList}
          label="משימות פתוחות"
          value={openTasks.data?.items.length}
          loading={openTasks.isLoading}
          tone="accent"
        />
        <StatCard icon={Clock} label="ממתינות לשיוך" value={undefined} loading={openTasks.isLoading} tone="warning" />
        <StatCard icon={TrendingUp} label="הושלמו החודש" value={undefined} loading={openTasks.isLoading} tone="success" />
        <StatCard icon={AlertTriangle} label="מלאי בחוסר" value={undefined} loading={openTasks.isLoading} tone="danger" />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>משימות אחרונות</CardTitle>
          <Link to="/tasks" className="text-xs font-medium text-accent hover:underline">
            הצג הכל
          </Link>
        </CardHeader>

        {openTasks.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        ) : openTasks.isError ? (
          <ErrorState error={openTasks.error} onRetry={() => void openTasks.refetch()} />
        ) : openTasks.data?.items.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="אין משימות פתוחות"
            description="משימות חדשות ייווצרו אוטומטית ממיילים נכנסים, או ידנית מכאן."
          />
        ) : (
          <ul className="divide-y divide-border">
            {openTasks.data?.items.map((task) => (
              <li key={task.id}>
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: task.id }}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-hover"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{task.title}</p>
                    <p className="truncate text-xs text-fg-muted">{task.customer?.name ?? '—'}</p>
                  </div>
                  <PriorityBadge priority={task.priority} />
                  <TaskStatusBadge status={task.status} />
                  <time
                    dateTime={task.createdAt}
                    className="hidden w-24 shrink-0 text-start text-xs text-fg-subtle sm:block"
                  >
                    {formatRelative(task.createdAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const TONE_CLASS = {
  accent: 'bg-accent-subtle text-accent',
  warning: 'bg-warning-subtle text-warning',
  success: 'bg-success-subtle text-success',
  danger: 'bg-danger-subtle text-danger',
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
  tone,
}: {
  icon: typeof ClipboardList;
  label: string;
  value: number | undefined;
  loading: boolean;
  tone: keyof typeof TONE_CLASS;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3.5">
        <div className={`grid size-9 shrink-0 place-items-center rounded-(--radius-md) ${TONE_CLASS[tone]}`}>
          <Icon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-fg-muted">{label}</p>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-10" />
          ) : (
            // tabular — הספרות מתיישרות בין הכרטיסים ולא "רוקדות"
            // בזמן רענון.
            <p className="tabular text-xl font-semibold text-fg">{value ?? '—'}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
