import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowRight, MapPin, Navigation, Phone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { OfflineBanner, StaleBanner } from '@/components/data-freshness';
import { Badge, Card, CardContent, CardHeader, CardTitle, Checkbox, ErrorState, Skeleton } from '@/components/ui';
import { useOnline } from '@/lib/online';
import { formatDateTime, formatRelative } from '@/lib/utils';
import type { ChecklistItem } from '@/lib/schemas';
import { CloseJobDialog } from './close-job-dialog';
import { fetchJob } from './jobs-api';
import { PriorityBadge, TaskStatusBadge } from './task-status';

/**
 * מסך המשימה — הליבה.
 *
 * הסדר על המסך הוא סדר הפעולות בשטח: להגיע (ניווט/חיוג), לעבוד
 * (רשימת העבודות), לסגור. התיאור והפרטים מתחת — הם נקראים פעם אחת.
 */
export function JobDetailPage() {
  const { taskId } = useParams({ from: '/protected/jobs/$taskId' });
  const online = useOnline();

  const job = useQuery({
    queryKey: ['job', taskId],
    queryFn: ({ signal }) => fetchJob(taskId, signal),
  });

  // הצ'ק-ליסט נערך מקומית ונשלח רק בסגירה. בקשה לכל הקלקה הייתה
  // נכשלת חצי מהזמן בקליטה של שטח, ומשאירה את המסך לא מסונכרן.
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  useEffect(() => {
    if (job.data?.data.checklist) setChecklist(job.data.data.checklist);
  }, [job.data?.data.checklist]);

  if (job.isLoading) return <DetailSkeleton />;
  if (job.isError) return <ErrorState error={job.error} onRetry={() => void job.refetch()} />;
  if (!job.data) return null;

  const t = job.data.data;
  const isOpen = t.status !== 'CLOSED' && t.status !== 'CANCELLED';
  const doneCount = checklist.filter((c) => c.done).length;
  const address = t.customer?.address;
  const phone = t.customer?.phone;

  return (
    <div className="space-y-4">
      <Link
        to="/"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-fg-muted transition-colors active:text-fg"
      >
        {/* החץ מצביע ימינה — ב-RTL זו התנועה "חזרה". */}
        <ArrowRight className="size-4" aria-hidden />
        למשימות שלי
      </Link>

      {!online ? <OfflineBanner /> : null}
      {job.data.fromCache ? <StaleBanner cachedAt={job.data.cachedAt} /> : null}

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <TaskStatusBadge status={t.status} />
          <PriorityBadge priority={t.priority} />
          <Badge tone="neutral" dot={false}>
            {t.source === 'EMAIL' ? 'ממייל' : 'ידנית'}
          </Badge>
        </div>
        <h1 className="text-xl font-semibold leading-(--leading-tight) tracking-tight text-fg">
          {t.title}
        </h1>
        <p className="text-base text-fg-muted">{t.customer?.name ?? 'לקוח לא ידוע'}</p>
      </div>

      {/* הגעה: שתי פעולות, שתיהן 56px, זו לצד זו כדי שיימצאו באגודל. */}
      {phone || address ? (
        <div className="grid grid-cols-2 gap-3">
          {phone ? (
            <a
              href={`tel:${phone}`}
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-(--radius-lg) border border-border bg-surface-raised text-sm font-medium text-fg shadow-xs transition-colors active:bg-surface-hover"
            >
              <Phone className="size-5 text-accent" aria-hidden />
              חיוג ללקוח
            </a>
          ) : null}
          {address ? (
            <a
              // maps: מפורש ולא כתובת של ספק אחד — במובייל מערכת
              // ההפעלה פותחת את אפליקציית המפות המותקנת.
              href={`https://maps.google.com/maps?q=${encodeURIComponent(address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-(--radius-lg) border border-border bg-surface-raised text-sm font-medium text-fg shadow-xs transition-colors active:bg-surface-hover"
            >
              <Navigation className="size-5 text-accent" aria-hidden />
              ניווט
            </a>
          ) : null}
        </div>
      ) : null}

      {address ? (
        <p className="flex items-start gap-2 text-sm text-fg-muted">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0">{address}</span>
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle className="text-base">רשימת עבודות</CardTitle>
          {checklist.length > 0 ? (
            <span className="tabular text-sm text-fg-subtle">
              {doneCount} / {checklist.length}
            </span>
          ) : null}
        </CardHeader>

        {checklist.length === 0 ? (
          <CardContent>
            <p className="text-sm text-fg-subtle">אין פריטים ברשימה.</p>
          </CardContent>
        ) : (
          <ul className="divide-y divide-border">
            {checklist.map((item, i) => {
              const id = `check-${i}`;
              return (
                <li key={id}>
                  {/* התווית כולה היא אזור המגע, בגובה 56px — סימון
                      בכפפה על תיבה בת 20px נכשל יותר מפעם אחת. */}
                  <label
                    htmlFor={id}
                    className="flex min-h-14 cursor-pointer items-center gap-4 px-4 py-3 transition-colors active:bg-surface-hover"
                  >
                    <Checkbox
                      id={id}
                      checked={item.done}
                      disabled={!isOpen}
                      onCheckedChange={(v) =>
                        setChecklist((prev) =>
                          prev.map((c, j) => (j === i ? { ...c, done: v === true } : c)),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={
                          item.done
                            ? 'text-base text-fg-subtle line-through'
                            : 'text-base text-fg'
                        }
                      >
                        {item.label}
                      </span>
                      {item.sku || item.priceCode ? (
                        <span className="mt-1 flex flex-wrap gap-1.5">
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
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {isOpen ? <CloseJobDialog taskId={t.id} checklist={checklist} /> : null}

      {t.description ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">תיאור</CardTitle>
          </CardHeader>
          <CardContent>
            {/* whitespace-pre-wrap — טקסט שמגיע ממייל מכיל שורות. */}
            <p className="whitespace-pre-wrap text-sm leading-(--leading-normal) text-fg-muted">
              {t.description}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <dl className="space-y-2 px-1 text-sm">
        <Row label="סוג עבודה">{t.jobTypeTemplate?.name ?? '—'}</Row>
        <Row label="נפתחה">
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
    <div className="space-y-4">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-14 w-full rounded-(--radius-lg)" />
      <Skeleton className="h-64 w-full rounded-(--radius-lg)" />
    </div>
  );
}
