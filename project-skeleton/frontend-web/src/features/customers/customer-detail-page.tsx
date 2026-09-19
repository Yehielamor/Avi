import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ClipboardList } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EquipmentCard } from './equipment-card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PriorityBadge, TaskStatusBadge } from '@/features/tasks/task-status';
import { PageHeader } from '@/components/page-header';
import { request } from '@/lib/api';
import { taskListSchema, customerSchema } from '@/lib/schemas';
import { formatDateTime, formatRelative } from '@/lib/utils';

export function CustomerDetailPage() {
  // strict:false — הרכיב מיוצא לפני רישום המסלול, ולכן הפרמטר אינו
  // מוכר לטיפוסי הראוטר בזמן קומפילציה.
  const params = useParams({ strict: false });
  const customerId = params.customerId ?? '';

  const customer = useQuery({
    queryKey: ['customers', 'detail', customerId],
    queryFn: ({ signal }) =>
      request(`/customers/${customerId}`, { schema: customerSchema, signal }),
    enabled: customerId !== '',
  });

  // הסינון עבר לשרת: `customerId` נוסף ל-ListTasksQueryDto, והאינדקס
  // [tenantId, customerId, createdAt] כבר היה קיים. קודם זה היה 400,
  // ולכן המסך הציג מצב ריק במקום נתונים.
  const tasks = useQuery({
    queryKey: ['tasks', { customerId }],
    queryFn: ({ signal }) =>
      request(`/tasks?customerId=${customerId}&take=20`, { schema: taskListSchema, signal }),
  });

  if (customer.isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-5" aria-busy>
        <Skeleton className="h-8 w-56" />
        <Card>
          <CardContent className="space-y-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (customer.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <Card>
          <ErrorState error={customer.error} onRetry={() => void customer.refetch()} />
        </Card>
      </div>
    );
  }

  const data = customer.data;
  if (!data) {
    return (
      <div className="mx-auto max-w-4xl">
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="הלקוח לא נמצא"
            description="ייתכן שהלקוח נמחק, או שהקישור שגוי. חזרה לרשימת הלקוחות תציג את הלקוחות הקיימים."
            action={
              <Button variant="secondary" asChild>
                <Link to="/customers">לרשימת הלקוחות</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title={data.name} description="פרטי לקוח" />

      <Card>
        <CardHeader>
          <CardTitle>פרטי קשר</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="אימייל">
              {data.email ? (
                <a href={`mailto:${data.email}`} className="ltr-inline text-fg hover:text-accent">
                  {data.email}
                </a>
              ) : null}
            </Detail>
            <Detail label="טלפון">
              {data.phone ? (
                <a href={`tel:${data.phone}`} className="ltr-inline tabular text-fg hover:text-accent">
                  {data.phone}
                </a>
              ) : null}
            </Detail>
            <Detail label="כתובת">{data.address ?? null}</Detail>
            <Detail label="נוצר">
              <time dateTime={data.createdAt}>{formatDateTime(data.createdAt)}</time>
            </Detail>
          </dl>
        </CardContent>
      </Card>

      <EquipmentCard customerId={customerId} />

      <Card>
        <CardHeader>
          <CardTitle>משימות הלקוח</CardTitle>
        </CardHeader>
        {tasks.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : tasks.isError ? (
          <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
        ) : tasks.data?.items.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="אין משימות ללקוח הזה"
            description="משימות נוצרות אוטומטית ממייל נכנס מהלקוח, או ידנית ממסך המשימות."
          />
        ) : (
          <ul className="divide-y divide-border">
            {tasks.data?.items.map((task) => (
              <li key={task.id}>
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: task.id }}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{task.title}</span>
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
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className="mt-1 text-sm text-fg">{children ?? <span className="text-fg-subtle">—</span>}</dd>
    </div>
  );
}
