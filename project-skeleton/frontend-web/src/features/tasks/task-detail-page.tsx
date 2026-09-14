import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowRight, Mail, MapPin, Phone, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  ErrorState,
  Skeleton,
  useToast,
} from '@/components/ui';
import { PriorityBadge, TaskStatusBadge } from './task-status';
import { CloseTaskDialog } from './close-task-dialog';
import { request } from '@/lib/api';
import { taskDetailSchema, type ChecklistItem } from '@/lib/schemas';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatRelative } from '@/lib/utils';

export function TaskDetailPage() {
  const { taskId } = useParams({ from: '/protected/tasks/$taskId' });
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();

  const task = useQuery({
    queryKey: ['task', taskId],
    queryFn: ({ signal }) => request(`/tasks/${taskId}`, { schema: taskDetailSchema, signal }),
  });

  // הצ'ק-ליסט נערך מקומית ונשלח רק בסגירה. עריכה אופטימית לכל
  // תיבה הייתה מייצרת בקשה לכל הקלקה, ובשטח הקליטה לא תמיד יציבה.
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  useEffect(() => {
    if (task.data?.checklist) setChecklist(task.data.checklist);
  }, [task.data?.checklist]);

  const assign = useMutation({
    mutationFn: () => request(`/scheduling/${taskId}/assign`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('המשימה שויכה');
      await qc.invalidateQueries({ queryKey: ['task', taskId] });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    // השרת מחזיר סיבה קונקרטית ("אין טכנאי עם הכישור הנדרש") —
    // מציגים אותה במקום הודעה גנרית.
    onError: (err: Error) => toast.error('השיוך נכשל', err.message),
  });

  if (task.isLoading) return <DetailSkeleton />;
  if (task.isError) return <ErrorState error={task.error} onRetry={() => void task.refetch()} />;
  if (!task.data) return null;

  const t = task.data;
  const isOpen = t.status !== 'CLOSED' && t.status !== 'CANCELLED';
  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link
          to="/tasks"
          className="inline-flex items-center gap-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
        >
          {/* החץ מצביע ימינה — ב-RTL זו התנועה "חזרה". */}
          <ArrowRight className="size-3.5" aria-hidden />
          חזרה למשימות
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-fg">{t.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TaskStatusBadge status={t.status} />
              <PriorityBadge priority={t.priority} />
              <Badge tone="neutral" dot={false}>
                {t.source === 'EMAIL' ? 'ממייל' : 'ידנית'}
              </Badge>
            </div>
          </div>

          {isOpen ? (
            <div className="flex gap-2">
              {!t.assignedToUserId && can('OWNER', 'MANAGER') ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={assign.isPending}
                  onClick={() => assign.mutate()}
                >
                  <UserPlus aria-hidden />
                  שייך טכנאי
                </Button>
              ) : null}
              <CloseTaskDialog taskId={t.id} checklist={checklist} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {t.description ? (
            <Card>
              <CardHeader>
                <CardTitle>תיאור</CardTitle>
              </CardHeader>
              <CardContent>
                {/* whitespace-pre-wrap — טקסט שמגיע ממייל מכיל שורות. */}
                <p className="whitespace-pre-wrap text-sm leading-(--leading-normal) text-fg-muted">
                  {t.description}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>רשימת עבודות</CardTitle>
              {checklist.length > 0 ? (
                <span className="tabular text-xs text-fg-subtle">
                  {doneCount} / {checklist.length}
                </span>
              ) : null}
            </CardHeader>
            {checklist.length === 0 ? (
              <CardContent>
                <p className="text-xs text-fg-subtle">אין פריטים ברשימה.</p>
              </CardContent>
            ) : (
              <ul className="divide-y divide-border">
                {checklist.map((item, i) => {
                  const id = `check-${i}`;
                  return (
                    <li key={id} className="flex items-start gap-3 px-5 py-3">
                      <Checkbox
                        id={id}
                        checked={item.done}
                        disabled={!isOpen}
                        onCheckedChange={(v) =>
                          setChecklist((prev) =>
                            prev.map((c, j) => (j === i ? { ...c, done: v === true } : c)),
                          )
                        }
                        className="mt-0.5"
                      />
                      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                        <span className={item.done ? 'text-sm text-fg-subtle line-through' : 'text-sm text-fg'}>
                          {item.label}
                        </span>
                        {item.sku || item.priceCode ? (
                          <span className="mt-0.5 flex flex-wrap gap-1.5">
                            {item.sku ? (
                              <Badge tone="neutral" dot={false}>
                                <span className="ltr-inline">
                                  {item.sku}
                                  {item.qty ? ` ×${item.qty}` : ''}
                                </span>
                              </Badge>
                            ) : null}
                            {item.priceCode ? (
                              <Badge tone="info" dot={false}>
                                <span className="ltr-inline">{item.priceCode}</span>
                              </Badge>
                            ) : null}
                          </span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>לקוח</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <p className="text-sm font-medium text-fg">{t.customer?.name ?? '—'}</p>
              {t.customer?.phone ? (
                <a
                  href={`tel:${t.customer.phone}`}
                  className="flex items-center gap-2 text-xs text-fg-muted transition-colors hover:text-accent"
                >
                  <Phone className="size-3.5 shrink-0" aria-hidden />
                  <span className="ltr-inline">{t.customer.phone}</span>
                </a>
              ) : null}
              {t.customer?.email ? (
                <a
                  href={`mailto:${t.customer.email}`}
                  className="flex items-center gap-2 text-xs text-fg-muted transition-colors hover:text-accent"
                >
                  <Mail className="size-3.5 shrink-0" aria-hidden />
                  <span className="ltr-inline truncate">{t.customer.email}</span>
                </a>
              ) : null}
              {t.customer?.address ? (
                <p className="flex items-start gap-2 text-xs text-fg-muted">
                  <MapPin className="mt-px size-3.5 shrink-0" aria-hidden />
                  {t.customer.address}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>פרטים</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2.5 text-xs">
                <Row label="משויך ל">{t.assignedTo?.name ?? 'לא שויך'}</Row>
                <Row label="סוג עבודה">{t.jobTypeTemplate?.name ?? '—'}</Row>
                <Row label="נוצרה">
                  <time dateTime={t.createdAt} title={formatDateTime(t.createdAt)}>
                    {formatRelative(t.createdAt)}
                  </time>
                </Row>
                {t.closedAt ? (
                  <Row label="נסגרה">
                    <time dateTime={t.closedAt}>{formatDateTime(t.closedAt)}</time>
                  </Row>
                ) : null}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-fg-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-end text-fg">{children}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-7 w-72" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
