import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CalendarCheck, ChevronLeft, ListChecks, MapPin, Navigation, Phone, Send, Truck } from 'lucide-react';
import { OfflineBanner, StaleBanner } from '@/components/data-freshness';
import { ShareDialog } from '@/components/share-dialog';
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { useOnline } from '@/lib/online';
import type { Stop } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { PriorityBadge } from '@/features/jobs/task-status';
import { fetchMyDay } from './day-api';
import { useFieldActions } from './field-actions';

/* ---------------------------------------------------------------------------
   היום שלי — המסך הראשון שהטכנאי רואה בבוקר.

   שאלה אחת: לאן אני נוסע עכשיו? לכן הביקורים בסדר נסיעה (עם מועד — לפי
   השעה שהלקוח אישר; בלי מועד — הקרוב ביותר קודם), הבא בתור מודגש, ו-Waze
   הוא הכפתור הגדול. כל השאר — פרטי המשימה — במסך הפנימי.
   --------------------------------------------------------------------------- */

const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' });

export function MyDayPage() {
  const online = useOnline();
  const day = useQuery({ queryKey: ['my-day'], queryFn: ({ signal }) => fetchMyDay(signal) });

  if (day.isLoading) return <DaySkeleton />;
  if (day.isError) return <ErrorState error={day.error} onRetry={() => void day.refetch()} />;
  if (!day.data) return null;

  const { stops, done, date } = day.data.data;

  return (
    <div className="space-y-4">
      {!online ? <OfflineBanner /> : null}
      {day.data.fromCache ? <StaleBanner cachedAt={day.data.cachedAt} /> : null}

      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">היום שלי</h1>
          <p className="text-sm text-fg-muted">{dayFmt.format(new Date(`${date}T12:00:00Z`))}</p>
        </div>
        <p className="tabular pb-0.5 text-sm text-fg-muted">
          {stops.length} לביצוע{done.length > 0 ? ` · ${done.length} הושלמו` : ''}
        </p>
      </div>

      {stops.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={done.length > 0 ? 'סיימת להיום' : 'אין ביקורים היום'}
          description={done.length > 0 ? 'כל הביקורים של היום הושלמו.' : 'כשתשובץ לך עבודה היא תופיע כאן, בסדר הנסיעה.'}
        />
      ) : (
        <ol className="space-y-3">
          {stops.map((s, i) => (
            <li key={s.taskId}>
              <StopCard stop={s} index={i + 1} next={i === 0} />
            </li>
          ))}
        </ol>
      )}

      {done.length > 0 ? (
        <section className="space-y-2 pt-1">
          <h2 className="text-xs font-medium text-fg-subtle">הושלמו היום</h2>
          <ul className="divide-y divide-border rounded-(--radius-lg) border border-border bg-surface-sunken/60">
            {done.map((s) => (
              <li key={s.taskId}>
                <Link
                  to="/jobs/$taskId"
                  params={{ taskId: s.taskId }}
                  className="flex min-h-12 items-center gap-3 px-4 text-sm text-fg-muted active:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1 truncate">{s.customer.name}</span>
                  <span className="truncate text-xs">{s.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Link
        to="/jobs"
        className="flex min-h-14 items-center justify-center gap-2 rounded-(--radius-lg) border border-border text-sm font-medium text-fg-muted active:bg-surface-hover"
      >
        <ListChecks className="size-5" aria-hidden />
        כל המשימות שלי
      </Link>
    </div>
  );
}

export function StopCard({ stop: s, index, next }: { stop: Stop; index: number; next: boolean }) {
  const { onTheWay, share, shared, closeShare } = useFieldActions(s.taskId);
  const online = useOnline();

  return (
    <div
      className={cn(
        'rounded-(--radius-lg) border bg-surface-raised shadow-xs',
        next ? 'border-accent-border ring-1 ring-accent-border' : 'border-border',
      )}
    >
      <Link
        to="/jobs/$taskId"
        params={{ taskId: s.taskId }}
        className="flex items-start gap-3 rounded-t-(--radius-lg) p-4 active:bg-surface-hover"
      >
        <span
          className={cn(
            'tabular grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold',
            next ? 'bg-accent text-fg-on-accent' : 'bg-surface-sunken text-fg-muted',
          )}
          aria-label={`עצירה ${index}`}
        >
          {index}
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-base font-semibold text-fg" dir="ltr">
              {s.scheduledStart
                ? `${timeFmt.format(new Date(s.scheduledStart))}${s.scheduledEnd ? `–${timeFmt.format(new Date(s.scheduledEnd))}` : ''}`
                : ''}
            </span>
            {!s.scheduledStart ? <span className="text-sm text-fg-muted">בלי מועד</span> : null}
            {next ? <Badge tone="info">הבא בתור</Badge> : null}
            {s.overdue ? <Badge tone="danger">מיום קודם</Badge> : null}
            {s.rescheduleRequested ? (
              <Badge tone="warning">ביקש מועד אחר</Badge>
            ) : s.confirmed ? (
              <Badge tone="success">הלקוח אישר</Badge>
            ) : null}
            {s.onTheWay ? <Badge tone="info">בדרך</Badge> : null}
            <PriorityBadge priority={s.priority} />
          </div>
          <p className="text-base font-semibold leading-(--leading-tight) text-fg">{s.customer.name}</p>
          <p className="text-sm text-fg-muted">{s.title}</p>
          {s.customer.address ? (
            <p className="flex items-start gap-1.5 text-sm text-fg-muted">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0">{s.customer.address}</span>
            </p>
          ) : null}
        </div>
        <ChevronLeft className="mt-1 size-5 shrink-0 text-fg-subtle" aria-hidden />
      </Link>

      <div className="grid grid-cols-3 border-t border-border">
        {s.wazeUrl ? (
          <a
            href={s.wazeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium text-accent active:bg-surface-hover"
          >
            <Navigation className="size-5" aria-hidden />
            Waze
          </a>
        ) : (
          <span className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-fg-subtle">
            <Navigation className="size-5" aria-hidden />
            אין כתובת
          </span>
        )}
        {s.customer.phone ? (
          <a
            href={`tel:${s.customer.phone}`}
            className="flex min-h-14 flex-col items-center justify-center gap-0.5 border-s border-border text-xs font-medium text-fg active:bg-surface-hover"
          >
            <Phone className="size-5 text-accent" aria-hidden />
            חיוג
          </a>
        ) : (
          <span className="flex min-h-14 flex-col items-center justify-center gap-0.5 border-s border-border text-xs text-fg-subtle">
            <Phone className="size-5" aria-hidden />
            אין טלפון
          </span>
        )}
        {s.onTheWay ? (
          <Button
            variant="ghost"
            className="h-auto min-h-14 flex-col gap-0.5 rounded-none border-s border-border text-xs"
            loading={share.isPending}
            disabled={!online}
            onClick={() => share.mutate()}
          >
            <Send className="size-5 text-accent" aria-hidden />
            קישור ללקוח
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="h-auto min-h-14 flex-col gap-0.5 rounded-none border-s border-border text-xs"
            loading={onTheWay.isPending}
            disabled={!online}
            onClick={() => onTheWay.mutate()}
          >
            <Truck className="size-5 text-accent" aria-hidden />
            אני בדרך
          </Button>
        )}
      </div>

      {shared ? <ShareDialog result={shared.result} title={shared.title} onClose={closeShare} /> : null}
    </div>
  );
}

function DaySkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-32" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-44 rounded-(--radius-lg)" />
      ))}
    </div>
  );
}
