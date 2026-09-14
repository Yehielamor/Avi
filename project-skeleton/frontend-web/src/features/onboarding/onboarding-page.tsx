import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowUp, Loader2, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button, ErrorState, useToast } from '@/components/ui';
import { ThemeToggle } from '@/components/theme-toggle';
import { ApiError } from '@/lib/api';
import { onboardingApi, sessionStore, type StoredSession } from './onboarding-api';
import { OnboardingSidebar } from './onboarding-sidebar';
import { FinalizeCard } from './finalize-card';
import { UploadDocumentDialog } from './upload-document-dialog';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * הקמת עסק חדש בשיחה.
 *
 * זו הפגישה הראשונה של לקוח עם המוצר, והיא אנונימית לגמרי — אין עדיין
 * טננט ואין משתמש. במקום טופס הרשמה עם עשרים שדות, המודל אוסף את
 * הפרטים בשיחה וקורא ל-tools; קוד דטרמיניסטי הוא זה שיוצר את הטננט
 * בסוף. ראו docs/01-architecture.md.
 *
 * הסרגל בצד מראה בזמן אמת מה כבר נאסף. בלעדיו המשתמש לא יודע כמה
 * נשאר, ושיחה פתוחה בלי סוף נראה נטושה.
 */
export function OnboardingPage() {
  const toast = useToast();
  const qc = useQueryClient();

  const [session, setSession] = useState<StoredSession | null>(() => sessionStore.get());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [startError, setStartError] = useState<unknown>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // פתיחת סשן. `start` מוגבל ל-1 לדקה בשרת, ולכן הוא רץ פעם אחת
  // בלבד — לא ב-useQuery שעלול לרוץ שוב ב-refetch.
  const started = useRef(false);
  useEffect(() => {
    if (session || started.current) return;
    started.current = true;

    onboardingApi
      .start()
      .then((res) => {
        const s = { sessionId: res.sessionId, sessionSecret: res.sessionSecret };
        sessionStore.set(s);
        setSession(s);
        setTurns([{ role: 'assistant', content: res.message }]);
      })
      .catch((err: unknown) => setStartError(err));
  }, [session]);

  const summary = useQuery({
    queryKey: ['onboarding', 'summary', session?.sessionId],
    queryFn: ({ signal }) => onboardingApi.summary(session!, signal),
    enabled: session !== null,
  });

  const send = useMutation({
    mutationFn: (message: string) => onboardingApi.sendMessage(session!, message),
    onSuccess: async (res) => {
      setTurns((prev) => [...prev, { role: 'assistant', content: res.reply }]);
      // הסרגל מתרענן אחרי כל תור: המודל אולי רשם עוד פרט.
      await qc.invalidateQueries({ queryKey: ['onboarding', 'summary'] });
    },
    onError: (err: Error) => {
      // ההודעה של המשתמש נשארת על המסך גם בכישלון — מחיקתה הייתה
      // גורמת לו לחשוב שלא שלח.
      toast.error('השליחה נכשלה', err.message);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, send.isPending]);

  const submit = (): void => {
    const message = draft.trim();
    if (!message || send.isPending) return;
    setTurns((prev) => [...prev, { role: 'user', content: message }]);
    setDraft('');
    send.mutate(message);
    inputRef.current?.focus();
  };

  if (startError) {
    const tooMany = startError instanceof ApiError && startError.status === 429;
    return (
      <Shell>
        <ErrorState
          error={
            tooMany
              ? new ApiError(429, 'נפתחו יותר מדי שיחות מהכתובת הזו. נסה שוב בעוד דקה.')
              : startError
          }
          onRetry={
            tooMany
              ? undefined
              : () => {
                  started.current = false;
                  setStartError(null);
                }
          }
        />
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-24 text-fg-muted">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          <p className="text-sm">פותח שיחה…</p>
        </div>
      </Shell>
    );
  }

  const status = summary.data?.status;
  const budgetLeft = summary.data ? summary.data.llmCallsLimit - summary.data.llmCallsUsed : null;
  const finalized = status === 'FINALIZED';

  return (
    <Shell>
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-h-[32rem] flex-col rounded-(--radius-xl) border border-border bg-surface-raised">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
            {turns.map((turn, i) => (
              <Bubble key={i} role={turn.role} content={turn.content} />
            ))}
            {send.isPending ? <Thinking /> : null}
          </div>

          {finalized ? null : (
            <div className="border-t border-border p-3">
              {budgetLeft !== null && budgetLeft <= 5 ? (
                // תקרת קריאות היא מגבלה אמיתית, לא הפתעה שצריכה
                // להתגלות כשהשיחה נעצרת.
                <p
                  role="status"
                  className="mb-2 flex items-center gap-1.5 text-2xs text-warning"
                >
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                  נותרו {budgetLeft} הודעות בשיחה הזו.
                </p>
              ) : null}

              <div className="flex items-end gap-2">
                <UploadDocumentDialog session={session} onUploaded={() => void summary.refetch()} />

                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter שולח, Shift+Enter יורד שורה — התנהגות
                    // צ'אט מוכרת.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={1}
                  placeholder="כתוב כאן…"
                  aria-label="הודעה"
                  disabled={send.isPending}
                  className="max-h-40 min-h-11 flex-1 resize-none rounded-(--radius-md) border border-border bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle disabled:opacity-60"
                />

                <Button
                  size="icon"
                  onClick={submit}
                  disabled={draft.trim() === '' || send.isPending}
                  aria-label="שליחה"
                >
                  <ArrowUp aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <OnboardingSidebar summary={summary.data} isLoading={summary.isLoading} />
          {status === 'READY_TO_FINALIZE' || finalized ? (
            <FinalizeCard session={session} finalized={finalized} />
          ) : null}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
        <div className="flex items-center gap-2.5">
          <div className="grid size-7 place-items-center rounded-(--radius-sm) bg-accent text-fg-on-accent">
            <span className="text-xs font-bold">CM</span>
          </div>
          <span className="text-sm font-semibold text-fg">CraftMind AI</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-5xl p-4 lg:p-6">
        <div className="mb-5">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-fg">
            <Sparkles className="size-5 text-accent" aria-hidden />
            הקמת העסק שלך
          </h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            ספר לנו על העסק בשיחה, ואנחנו נגדיר את המערכת לפי מה שתאמר.
          </p>
        </div>
        {children}
      </main>
    </div>
  );
}

function Bubble({ role, content }: Turn) {
  const isUser = role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[80%] rounded-(--radius-lg) bg-accent px-3.5 py-2.5 text-sm text-fg-on-accent'
            : 'max-w-[85%] rounded-(--radius-lg) bg-surface-sunken px-3.5 py-2.5 text-sm text-fg'
        }
      >
        {/* whitespace-pre-wrap — תשובות המודל מכילות רשימות ושורות. */}
        <p className="whitespace-pre-wrap leading-(--leading-normal)">{content}</p>
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex justify-start" role="status" aria-label="מנסח תשובה">
      <div className="flex items-center gap-2 rounded-(--radius-lg) bg-surface-sunken px-3.5 py-2.5">
        <Loader2 className="size-3.5 animate-spin text-fg-subtle" aria-hidden />
        <span className="text-xs text-fg-muted">חושב…</span>
      </div>
    </div>
  );
}
