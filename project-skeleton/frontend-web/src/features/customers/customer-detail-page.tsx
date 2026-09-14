import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ClipboardList } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { request } from '@/lib/api';
import { customerSchema } from '@/lib/schemas';
import { formatDateTime } from '@/lib/utils';

export function CustomerDetailPage() {
  // strict:false — הרכיב מיוצא לפני רישום המסלול, ולכן הפרמטר אינו
  // מוכר לטיפוסי הראוטר בזמן קומפילציה.
  const params = useParams({ strict: false }) as { customerId?: string };
  const customerId = params.customerId ?? '';

  const customer = useQuery({
    queryKey: ['customers', 'detail', customerId],
    queryFn: ({ signal }) =>
      request(`/customers/${customerId}`, { schema: customerSchema, signal }),
    enabled: customerId !== '',
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

      <Card>
        <CardHeader>
          <CardTitle>משימות הלקוח</CardTitle>
        </CardHeader>
        {/*
          TODO(backend): אין endpoint למשימות של לקוח מסוים.
          `GET /tasks` (ListTasksQueryDto) מקבל status / take / cursor בלבד,
          וה-ValidationPipe רץ עם forbidNonWhitelisted — כלומר
          `?customerId=…` יחזיר 400, ולא יסונן. סינון בצד הלקוח על עמוד
          אחד מתוך רשימה מעומדת יציג תמונה חלקית ושקרית, ולכן לא נעשה כאן.
          חסר: `customerId?: string` ב-ListTasksQueryDto (או
          `GET /customers/:id/tasks`). ברגע שיתווסף — useQuery עם
          taskListSchema ו-DataTable כמו במסך המשימות.
        */}
        <EmptyState
          icon={ClipboardList}
          title="רשימת המשימות אינה זמינה עדיין"
          description="השרת עדיין אינו תומך בשליפת משימות לפי לקוח. בינתיים ניתן לראות את כל המשימות במסך המשימות."
          action={
            <Button variant="secondary" asChild>
              <Link to="/tasks">למסך המשימות</Link>
            </Button>
          }
        />
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
