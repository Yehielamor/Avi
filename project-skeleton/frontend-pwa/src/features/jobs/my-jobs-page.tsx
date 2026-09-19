import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight, ChevronLeft, ClipboardCheck, MapPin, Phone } from 'lucide-react';
import { OfflineBanner, StaleBanner } from '@/components/data-freshness';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/online';
import { formatRelative } from '@/lib/utils';
import type { Task } from '@/lib/schemas';
import { fetchMyJobs } from './jobs-api';
import { PriorityBadge, TaskStatusBadge } from './task-status';

/**
 * המסך הראשי. טכנאי לא מדפדף — הוא פותח את האפליקציה כדי לראות
 * מה הבא בתור. לכן: רק המשימות שלו, הפתוחות קודם, דחוף בראש,
 * וכל שורה היא אזור מגע אחד גדול.
 */
export function MyJobsPage() {
  const { session } = useAuth();
  const online = useOnline();
  const userId = session?.user.id;

  const jobs = useQuery({
    queryKey: ['my-jobs', userId],
    queryFn: ({ signal }) => fetchMyJobs(userId!, signal),
    enabled: !!userId,
  });

  if (jobs.isLoading || !userId) return <ListSkeleton />;
  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />;
  if (!jobs.data) return null;

  const { open, closed, truncated } = jobs.data.data;

  return (
    <div className="space-y-4">
      <Link
        to="/"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-fg-muted transition-colors active:text-fg"
      >
        <ArrowRight className="size-4" aria-hidden />
        להיום שלי
      </Link>

      {!online ? <OfflineBanner /> : null}
      {jobs.data.fromCache ? <StaleBanner cachedAt={jobs.data.cachedAt} /> : null}

      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-fg">המשימות שלי</h1>
        {open.length > 0 ? (
          <span className="tabular text-sm text-fg-muted">{open.length} פתוחות</span>
        ) : null}
      </div>

      {truncated ? (
        // שקיפות על מגבלה אמיתית. ראו ה-TODO ב-jobs-api.ts: הסינון
        // נעשה בצד הלקוח על עמוד אחד, ולכן "ריק" כאן אינו בהכרח ריק.
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-(--radius-lg) border border-info-border bg-info-subtle px-4 py-3"
        >
          <AlertTriangle className="mt-px size-4 shrink-0 text-info" aria-hidden />
          <p className="text-xs text-fg-muted">
            מוצגות המשימות מתוך 100 האחרונות שנוצרו. ייתכנו משימות ישנות יותר שאינן כאן.
          </p>
        </div>
      ) : null}

      {open.length === 0 && closed.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="אין משימות משויכות אליך"
          description="כשמנהל ישייך אליך משימה היא תופיע כאן. אפשר למשוך מלמעלה כדי לרענן."
        />
      ) : null}

      {open.length > 0 ? (
        <ul className="space-y-3">
          {open.map((t) => (
            <li key={t.id}>
              <JobCard task={t} />
            </li>
          ))}
        </ul>
      ) : null}

      {closed.length > 0 ? (
        <section className="space-y-3 pt-2">
          <h2 className="text-xs font-medium text-fg-subtle">שהושלמו לאחרונה</h2>
          <ul className="space-y-3">
            {closed.map((t) => (
              <li key={t.id}>
                <JobCard task={t} muted />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function JobCard({ task, muted = false }: { task: Task; muted?: boolean }) {
  const phone = task.customer?.phone;

  return (
    <div
      className={
        muted
          ? 'rounded-(--radius-lg) border border-border bg-surface-sunken/60'
          : 'rounded-(--radius-lg) border border-border bg-surface-raised shadow-xs'
      }
    >
      {/* min-h-14 = 56px. השורה כולה היא היעד, לא רק הכותרת. */}
      <Link
        to="/jobs/$taskId"
        params={{ taskId: task.id }}
        className="flex min-h-14 items-start gap-3 rounded-t-(--radius-lg) p-4 transition-colors active:bg-surface-hover"
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>

          <p className="text-base font-semibold leading-(--leading-tight) text-fg">{task.title}</p>

          <p className="text-sm text-fg-muted">{task.customer?.name ?? 'לקוח לא ידוע'}</p>

          {task.customer?.address ? (
            <p className="flex items-start gap-1.5 text-sm text-fg-muted">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0">{task.customer.address}</span>
            </p>
          ) : null}

          <p className="text-xs text-fg-subtle">נפתחה {formatRelative(task.createdAt)}</p>
        </div>

        {/* ב-RTL "פנימה" הוא שמאלה. */}
        <ChevronLeft className="mt-1 size-5 shrink-0 text-fg-subtle" aria-hidden />
      </Link>

      {phone ? (
        // חיוג הוא הפעולה השנייה בשכיחותה אחרי פתיחת המשימה, והוא
        // נדרש לפני היציאה לדרך — לכן הוא כאן ולא רק במסך הפנימי.
        <a
          href={`tel:${phone}`}
          className="flex min-h-14 items-center justify-center gap-2 border-t border-border text-sm font-medium text-accent transition-colors active:bg-surface-hover"
        >
          <Phone className="size-5" aria-hidden />
          התקשר ל{task.customer?.name ?? 'לקוח'}
          <span className="ltr-inline text-fg-muted">{phone}</span>
        </a>
      ) : null}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-40" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-44 rounded-(--radius-lg)" />
        ))}
      </div>
    </div>
  );
}
