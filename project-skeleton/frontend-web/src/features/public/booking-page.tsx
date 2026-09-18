import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { CheckCircle2, Plus, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button, Input, Skeleton, Textarea } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PublicShell } from './public-shell';

/* ---------------------------------------------------------------------------
   קביעת טיפול מקישור תזכורת.

   הלקוח לא בוחר שעה מדויקת — הוא לא יודע מה הלו"ז של הטכנאי, ואנחנו לא
   רוצים להבטיח משבצת שאולי תפוסה. הוא נותן עד שלושה חלונות נוחים, ובעל
   העסק קובע מתוכם ושולח קישור סטטוס עם המועד הסופי.
   --------------------------------------------------------------------------- */

const viewSchema = z.object({
  businessName: z.string(),
  equipment: z.object({ kind: z.string(), location: z.string().nullable() }),
  alreadyBooked: z.boolean(),
  minDate: z.string(),
  maxDate: z.string(),
});

type Part = 'morning' | 'noon' | 'evening';
const PARTS: Array<{ value: Part; label: string; hint: string }> = [
  { value: 'morning', label: 'בוקר', hint: '8–12' },
  { value: 'noon', label: 'צהריים', hint: '12–16' },
  { value: 'evening', label: 'אחה״צ', hint: '16–19' },
];

export function BookingPage() {
  const { token } = useParams({ from: '/c/b/$token' });
  const view = useQuery({
    queryKey: ['public-booking', token],
    queryFn: ({ signal }) => request(`/public/booking/${token}`, { schema: viewSchema, signal }),
    retry: false,
  });

  const [windows, setWindows] = useState<Array<{ date: string; part: Part }>>([{ date: '', part: 'morning' }]);
  const [note, setNote] = useState('');

  const book = useMutation({
    mutationFn: () =>
      request(`/public/booking/${token}`, {
        method: 'POST',
        body: { windows: windows.filter((w) => w.date), ...(note.trim() && { note: note.trim() }) },
      }),
  });

  if (view.isLoading) {
    return (
      <PublicShell>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-6 h-40 w-full" />
      </PublicShell>
    );
  }

  if (view.isError || !view.data) {
    return (
      <PublicShell>
        <Message icon={XCircle} title="הקישור אינו בתוקף" body="אפשר לפנות לבעל העסק ולבקש קישור חדש." />
      </PublicShell>
    );
  }

  const v = view.data;
  const conflict = book.error instanceof ApiError && book.error.status === 409;

  if (book.isSuccess || v.alreadyBooked || conflict) {
    return (
      <PublicShell business={v.businessName}>
        <Message
          icon={CheckCircle2}
          tone="success"
          title="הבקשה התקבלה"
          body={`${v.businessName} יחזרו אליך עם מועד מדויק מתוך החלונות שבחרת.`}
        />
      </PublicShell>
    );
  }

  const valid = windows.some((w) => w.date);
  const what = v.equipment.location ? `${v.equipment.kind} (${v.equipment.location})` : v.equipment.kind;

  return (
    <PublicShell business={v.businessName}>
      <h1 className="text-xl font-semibold text-fg">קביעת טיפול תקופתי</h1>
      <p className="mt-1 text-sm text-fg-muted">{what}</p>

      <form
        className="mt-6 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) book.mutate();
        }}
      >
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-fg">מתי נוח לך? אפשר לבחור עד שלוש אפשרויות.</legend>
          {windows.map((w, i) => (
            <div key={i} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  aria-label={`תאריך ${i + 1}`}
                  min={v.minDate}
                  max={v.maxDate}
                  value={w.date}
                  onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))}
                  className="flex-1"
                />
                {windows.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`הסרת אפשרות ${i + 1}`}
                    onClick={() => setWindows(windows.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={`חלק היום ${i + 1}`}>
                {PARTS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={w.part === p.value}
                    onClick={() => setWindows(windows.map((x, j) => (j === i ? { ...x, part: p.value } : x)))}
                    className={cn(
                      'min-h-12 rounded-xl border px-2 py-2 text-sm transition-colors',
                      w.part === p.value
                        ? 'border-accent bg-accent-subtle font-medium text-accent'
                        : 'border-border text-fg-muted hover:border-border-strong',
                    )}
                  >
                    {p.label}
                    <span className="block text-2xs opacity-80" dir="ltr">
                      {p.hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {windows.length < 3 ? (
            <Button type="button" variant="ghost" onClick={() => setWindows([...windows, { date: '', part: 'morning' }])}>
              <Plus aria-hidden />
              עוד אפשרות
            </Button>
          ) : null}
        </fieldset>

        <div className="space-y-2">
          <label htmlFor="booking-note" className="text-sm font-medium text-fg">
            משהו שחשוב לדעת? <span className="font-normal text-fg-subtle">(לא חובה)</span>
          </label>
          <Textarea
            id="booking-note"
            rows={2}
            maxLength={500}
            value={note}
            placeholder="קומה, קוד כניסה, חניה…"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {book.isError && !conflict ? (
          <p role="alert" className="text-sm text-danger">
            {book.error instanceof ApiError && book.error.status === 400
              ? 'אחד התאריכים אינו בטווח. אפשר לבחור מחר ועד חודשיים קדימה.'
              : 'השליחה לא הצליחה. נסו שוב בעוד רגע.'}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="h-14 w-full text-base" disabled={!valid} loading={book.isPending}>
          שליחת בקשה
        </Button>
      </form>
    </PublicShell>
  );
}

function Message({
  icon: Icon,
  title,
  body,
  tone,
}: {
  icon: typeof XCircle;
  title: string;
  body: string;
  tone?: 'success';
}) {
  return (
    <div className="py-10 text-center">
      <Icon className={cn('mx-auto size-12', tone === 'success' ? 'text-success' : 'text-fg-subtle')} aria-hidden />
      <h1 className="mt-3 text-lg font-semibold text-fg">{title}</h1>
      <p className="mt-1 text-sm text-fg-muted">{body}</p>
    </div>
  );
}
