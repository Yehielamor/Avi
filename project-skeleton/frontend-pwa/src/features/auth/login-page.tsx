import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { AlertCircle, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/online';

const schema = z.object({
  email: z.string().min(1, 'נא להזין אימייל').email('כתובת אימייל לא תקינה'),
  password: z.string().min(1, 'נא להזין סיסמה'),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const online = useOnline();
  // ה-guard של המסלול שומר לאן המשתמש ניסה להגיע לפני שהופנה לכאן,
  // כדי שהתחברות תחזיר אותו לשם ולא למסך הבית.
  const search = useSearch({ strict: false }) as { redirect?: string };
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values.email, values.password);
      // הניווט חייב לקרות כאן במפורש: עדכון ה-state לבדו לא מזיז את
      // ה-router, והמשתמש היה נשאר תקוע במסך ההתחברות.
      await navigate({ to: search.redirect ?? '/', replace: true });
    } catch (err) {
      // השרת מחזיר הודעה אחידה לשם משתמש לא קיים ולסיסמה שגויה —
      // אין למסור כאן מידע שמאפשר לגלות אילו חשבונות קיימים.
      setServerError(err instanceof ApiError ? err.message : 'ההתחברות נכשלה');
    }
  });

  return (
    <div
      className="flex min-h-dvh flex-col justify-center bg-canvas px-5"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 1rem)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)',
      }}
    >
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid size-14 place-items-center rounded-(--radius-xl) bg-accent text-fg-on-accent">
            <span className="text-base font-bold">CM</span>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight text-fg">עבודות שטח</h1>
            <p className="mt-1 text-sm text-fg-muted">התחברות למערכת</p>
          </div>
        </div>

        {/* התחברות היא הפעולה היחידה שאין לה מסלול אופליין: היא
            דורשת את השרת. אומרים זאת לפני שהמשתמש מקליד סיסמה. */}
        {!online ? (
          <div
            role="status"
            className="mb-4 flex items-start gap-2 rounded-(--radius-md) border border-warning-border bg-warning-subtle p-3 text-sm text-fg"
          >
            <WifiOff className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>אין חיבור לרשת. התחברות מחייבת חיבור.</span>
          </div>
        ) : null}

        <form
          onSubmit={onSubmit}
          noValidate
          className="space-y-5 rounded-(--radius-xl) border border-border bg-surface-raised p-5 shadow-sm"
        >
          {serverError ? (
            // role="alert" — קורא מסך מכריז על השגיאה מיד.
            <div
              role="alert"
              className="flex items-start gap-2 rounded-(--radius-md) border border-danger-border bg-danger-subtle p-3 text-sm text-danger"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{serverError}</span>
            </div>
          ) : null}

          <Field label="אימייל" error={errors.email?.message} htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              invalid={!!errors.email}
              {...register('email')}
            />
          </Field>

          <Field label="סיסמה" error={errors.password?.message} htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              invalid={!!errors.password}
              {...register('password')}
            />
          </Field>

          <Button type="submit" loading={isSubmitting} disabled={!online} className="w-full" size="lg">
            התחברות
          </Button>
        </form>
      </div>
    </div>
  );
}
