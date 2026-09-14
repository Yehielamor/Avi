import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useState } from 'react';

const schema = z.object({
  email: z.string().min(1, 'נא להזין אימייל').email('כתובת אימייל לא תקינה'),
  password: z.string().min(1, 'נא להזין סיסמה'),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { login } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values.email, values.password);
    } catch (err) {
      // השרת מחזיר הודעה אחידה לשם משתמש לא קיים ולסיסמה שגויה —
      // אין למסור כאן מידע שמאפשר לגלות אילו חשבונות קיימים.
      setServerError(err instanceof ApiError ? err.message : 'ההתחברות נכשלה');
    }
  });

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid size-11 place-items-center rounded-(--radius-lg) bg-accent text-fg-on-accent">
            <span className="text-sm font-bold">CM</span>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight text-fg">CraftMind AI</h1>
            <p className="mt-1 text-sm text-fg-muted">התחברות למערכת</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          noValidate
          className="space-y-4 rounded-(--radius-xl) border border-border bg-surface-raised p-6 shadow-sm"
        >
          {serverError ? (
            // role="alert" — קורא מסך מכריז על השגיאה מיד, בלי לחכות
            // שהמשתמש ינווט אליה.
            <div
              role="alert"
              className="flex items-start gap-2 rounded-(--radius-md) border border-danger-border bg-danger-subtle p-3 text-xs text-danger"
            >
              <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
              <span>{serverError}</span>
            </div>
          ) : null}

          <Field label="אימייל" error={errors.email?.message} htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              dir="ltr"
              invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
          </Field>

          <Field label="סיסמה" error={errors.password?.message} htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
          </Field>

          <Button type="submit" loading={isSubmitting} className="w-full" size="lg">
            התחברות
          </Button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  htmlFor,
  children,
}: {
  label: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-fg-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-2xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
