import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, KeyRound, Mail, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ApiError, request } from '@/lib/api';
import { formatRelative } from '@/lib/utils';

/* ---------------------------------------------------------------------------
   קליטת מיילים בהעברה אוטומטית (ADR 0001).

   במקום לתת לנו גישה לכל תיבת הדואר, בעל העסק מעביר אלינו רק את מה
   שהוא בוחר. ההגדרה ב-Gmail היא שלושה צעדים, והצעד היחיד שמבלבל —
   קוד האימות ש-Gmail שולח — מגיע אלינו ומוצג כאן, במקום להיעלם.
   --------------------------------------------------------------------------- */

export const mailboxSchema = z.object({
  enabled: z.boolean(),
  address: z.string(),
  verificationCode: z.string().nullable(),
  verificationUrl: z.string().nullable(),
  verificationReceivedAt: z.string().nullable(),
  lastReceivedAt: z.string().nullable(),
  receivedCount: z.number().int(),
});
export type Mailbox = z.infer<typeof mailboxSchema>;

const MAILBOX_KEY = ['intake', 'mailbox'];

export function EmailForwardingCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const [confirmRotate, setConfirmRotate] = useState(false);

  const mailbox = useQuery({
    queryKey: MAILBOX_KEY,
    queryFn: ({ signal }) => request('/intake/mailbox', { schema: mailboxSchema, signal }),
    // עד שמגיע המייל הראשון בעל העסק נמצא באמצע ההגדרה ב-Gmail, ומחכה לקוד.
    // רענון תכוף רק אז; אחרי שהקליטה עובדת — אין סיבה.
    refetchInterval: (q) => (q.state.data && q.state.data.receivedCount === 0 ? 10_000 : false),
  });

  const rotate = useMutation({
    mutationFn: () => request('/intake/mailbox/rotate', { method: 'POST', schema: mailboxSchema }),
    onSuccess: (m) => {
      qc.setQueryData(MAILBOX_KEY, m);
      setConfirmRotate(false);
      toast.success('נוצרה כתובת חדשה', 'יש לעדכן את ההעברה ב-Gmail לכתובת החדשה.');
    },
    onError: (e) => toast.error('יצירת כתובת חדשה נכשלה', e instanceof ApiError ? e.message : undefined),
  });

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} הועתק`);
    } catch {
      toast.error('ההעתקה נחסמה בדפדפן');
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-(--radius-md) bg-accent-subtle text-accent">
            <Mail className="size-4" aria-hidden />
          </div>
          <div>
            <CardTitle>קליטת מיילים</CardTitle>
            <CardDescription>פניות שמגיעות במייל הופכות למשימות — בלי לתת גישה לתיבת הדואר</CardDescription>
          </div>
        </div>
        {mailbox.data ? <Status m={mailbox.data} /> : null}
      </CardHeader>

      <CardContent className="space-y-5">
        {mailbox.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : mailbox.isError ? (
          <ErrorState error={mailbox.error} onRetry={() => void mailbox.refetch()} />
        ) : mailbox.data ? (
          <>
            {!mailbox.data.enabled ? (
              <p className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-sm text-warning">
                הקליטה עדיין לא הופעלה בשרת. אפשר כבר להכין את ההעברה — המיילים ייקלטו מרגע ההפעלה.
              </p>
            ) : null}

            <div>
              <p className="mb-1.5 text-xs font-medium text-fg-muted">הכתובת שלכם להעברה</p>
              <div className="flex items-center gap-2">
                <code
                  dir="ltr"
                  className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-sunken px-3 py-2.5 text-start font-mono text-sm text-fg"
                >
                  {mailbox.data.address}
                </code>
                <Button variant="secondary" onClick={() => void copy(mailbox.data.address, 'הכתובת')}>
                  <Copy aria-hidden />
                  העתקה
                </Button>
              </div>
            </div>

            {mailbox.data.verificationCode ? (
              <div className="rounded-xl border border-accent-border bg-accent-subtle p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-fg">
                  <KeyRound className="size-4 text-accent" aria-hidden />
                  קוד האימות מ-Gmail
                  {mailbox.data.verificationReceivedAt ? (
                    <span className="text-xs font-normal text-fg-muted">· {formatRelative(mailbox.data.verificationReceivedAt)}</span>
                  ) : null}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <span dir="ltr" className="tabular font-mono text-2xl font-semibold tracking-widest text-fg">
                    {mailbox.data.verificationCode}
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => void copy(mailbox.data.verificationCode!, 'הקוד')}>
                    <Copy aria-hidden />
                    העתקה
                  </Button>
                </div>
                <p className="mt-2 text-xs text-fg-muted">מדביקים אותו ב-Gmail, במקום שבו ביקשו "קוד אימות", ולוחצים "אימות".</p>
              </div>
            ) : null}

            <Steps m={mailbox.data} />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <p className="text-xs text-fg-subtle">
                מגיע ספאם לכתובת? כתובת חדשה מבטלת את הישנה מיד.
              </p>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRotate(true)}>
                <RefreshCw aria-hidden />
                כתובת חדשה
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>

      <Dialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <DialogContent aria-describedby="rotate-desc">
          <DialogHeader>
            <DialogTitle>ליצור כתובת חדשה?</DialogTitle>
            <DialogDescription id="rotate-desc">
              הכתובת הנוכחית תפסיק לקבל מיילים מיד. עד שתעדכנו את ההעברה ב-Gmail לכתובת החדשה, פניות לא ייקלטו.
            </DialogDescription>
          </DialogHeader>
          <DialogBody />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmRotate(false)}>
              ביטול
            </Button>
            <Button variant="danger" loading={rotate.isPending} onClick={() => rotate.mutate()}>
              כתובת חדשה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Status({ m }: { m: Mailbox }) {
  if (m.lastReceivedAt) {
    return (
      <Badge tone="success">
        פעיל · מייל אחרון {formatRelative(m.lastReceivedAt)}
      </Badge>
    );
  }
  if (m.verificationCode) return <Badge tone="info">ממתין לאימות ב-Gmail</Badge>;
  return <Badge tone="neutral">טרם הוגדר</Badge>;
}

/** שלושת הצעדים ב-Gmail. צעד שהושלם מסומן — כך רואים איפה עומדים. */
function Steps({ m }: { m: Mailbox }) {
  const steps = [
    {
      done: m.verificationCode !== null || m.receivedCount > 0,
      title: 'מוסיפים את הכתובת ב-Gmail',
      body: 'ב-Gmail: ⚙ ← "הצגת כל ההגדרות" ← "העברה ו-POP/IMAP" ← "הוספת כתובת להעברה" ← מדביקים את הכתובת למעלה.',
    },
    {
      done: m.receivedCount > 0,
      title: 'מאשרים את הקוד',
      body: 'Gmail שולח קוד אימות. הוא יופיע כאן תוך דקה — מעתיקים ומדביקים ב-Gmail.',
    },
    {
      done: m.receivedCount > 0,
      title: 'בוחרים מה להעביר',
      body: 'מומלץ: מסנן (Filter) שמעביר רק פניות — למשל מיילים שנשלחו לכתובת של העסק. אפשר גם "העברת עותק של כל הדואר הנכנס".',
    },
  ];

  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          {s.done ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          ) : (
            <span className="tabular grid size-5 shrink-0 place-items-center rounded-full border border-border text-2xs text-fg-muted">
              {i + 1}
            </span>
          )}
          <div>
            <p className={s.done ? 'text-sm font-medium text-fg-muted' : 'text-sm font-medium text-fg'}>{s.title}</p>
            <p className="mt-0.5 text-xs text-fg-muted">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
