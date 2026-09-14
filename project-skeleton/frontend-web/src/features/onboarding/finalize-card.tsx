import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Rocket } from 'lucide-react';
import { useState } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useToast,
} from '@/components/ui';
import { onboardingApi, sessionStore, type FinalizeResult, type StoredSession } from './onboarding-api';

/**
 * השלב האחרון: יצירת הטננט בפועל.
 *
 * מאחורי אישור מפורש, כי זו הפעולה הבלתי הפיכה היחידה בזרימה — היא
 * יוצרת חברה, משתמשים, מחירון וסוגי עבודה. אין כאן "בטל".
 *
 * שליחת ההזמנות אינה מחוברת (אירוע `user.invited` נכתב ל-outbox ואין
 * לו צרכן). הטקסט כאן אומר זאת במפורש: בלי הזמנה אף אחד לא יכול
 * להיכנס לחשבון שזה עתה נוצר, וזה הדבר החשוב ביותר שהמשתמש צריך
 * לדעת ברגע הזה.
 */
export function FinalizeCard({
  session,
  finalized,
}: {
  session: StoredSession;
  finalized: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<FinalizeResult | null>(null);

  const finalize = useMutation({
    mutationFn: () => onboardingApi.finalize(session),
    onSuccess: (res) => {
      setResult(res);
      setOpen(false);
      // הסוד כבר לא נחוץ ואין סיבה שיישאר בדפדפן.
      sessionStore.clear();
    },
    onError: (err: Error) => toast.error('ההקמה נכשלה', err.message),
  });

  if (result || finalized) {
    return <Done result={result} />;
  }

  return (
    <Card className="border-accent-border bg-accent-subtle">
      <CardHeader className="border-accent-border">
        <CardTitle className="flex items-center gap-2 text-accent">
          <Rocket className="size-4" aria-hidden />
          הכל מוכן
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-fg-muted">
          אספנו את כל מה שצריך. אפשר להקים את המערכת, או להמשיך לדבר ולהוסיף פרטים.
        </p>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="w-full">
              הקם את המערכת
            </Button>
          </DialogTrigger>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>הקמת המערכת</DialogTitle>
              <DialogDescription>הפעולה הזו אינה הפיכה.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ul className="space-y-1.5 text-xs text-fg-muted">
                <li>• ייווצר חשבון לעסק עם כתובת ייעודית.</li>
                <li>• סוגי העבודה והמחירון שנאספו ייטענו למערכת.</li>
                <li>• ייווצרו משתמשים לכל חברי הצוות שנמסרו.</li>
              </ul>
              {/*
                שליחת ההזמנות אינה מחוברת. זו לא הערת שוליים — בלי
                הזמנה אף אחד לא יכול להיכנס לחשבון שנוצר, ולכן זה
                חייב להיאמר *לפני* הלחיצה ולא אחריה.
              */}
              <p className="rounded-(--radius-md) border border-warning-border bg-warning-subtle p-3 text-2xs text-warning">
                <strong>הזמנות במייל אינן פעילות עדיין.</strong> המשתמשים ייווצרו, אבל לא יישלח
                אליהם קישור להגדרת סיסמה — מנהל המערכת יצטרך להגדיר להם סיסמאות ידנית.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                חזור לשיחה
              </Button>
              <Button size="sm" loading={finalize.isPending} onClick={() => finalize.mutate()}>
                כן, הקם
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function Done({ result }: { result: FinalizeResult | null }) {
  return (
    <Card className="border-success-border bg-success-subtle">
      <CardHeader className="border-success-border">
        <CardTitle className="flex items-center gap-2 text-success">
          <CheckCircle2 className="size-4" aria-hidden />
          המערכת הוקמה
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {result ? (
          <>
            <p className="text-fg-muted">
              נוצרו {result.jobTypesCreated} סוגי עבודה ו-{result.priceCodesCreated} קודי מחיר.
            </p>
            <div>
              <p className="mb-1 font-medium text-fg">נוצרו משתמשים עבור:</p>
              <ul className="space-y-0.5">
                {result.users.map((u) => (
                  <li key={u.email} className="text-fg-muted">
                    <span className="ltr-inline">{u.email}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="rounded-(--radius-md) border border-border bg-surface p-3 text-fg-muted">
              הכתובת שלכם:{' '}
              <span className="ltr-inline font-medium text-fg">{result.subdomain}</span>
            </p>
            <p className="rounded-(--radius-md) border border-warning-border bg-warning-subtle p-3 text-warning">
              <strong>לא נשלחו הזמנות.</strong> כדי להיכנס לראשונה, יש להגדיר סיסמאות למשתמשים
              דרך מנהל המערכת.
            </p>
          </>
        ) : (
          <p className="text-fg-muted">
            השיחה הזו כבר הושלמה והמערכת הוקמה. פנה למי שביצע את ההקמה כדי לקבל גישה.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
