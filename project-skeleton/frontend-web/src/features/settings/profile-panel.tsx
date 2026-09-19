import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError, request, tokenStore } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { userRoleSchema, type UserRole } from '@/lib/schemas';

const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: 'בעלים',
  MANAGER: 'מנהל',
  FIELD: 'טכנאי שטח',
};

/**
 * מראה את `ChangePasswordDto` בשרת אות באות:
 * `PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{12,128}$/`.
 * האורך הוא ההגנה האמיתית; דרישת האות והספרה רק חוסמת
 * "123456789012". כלל מחמיר יותר בקליינט היה דוחה סיסמאות שהשרת
 * מקבל — ופחות מחמיר היה מייצר 400 אחרי לחיצה.
 */
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{12,128}$/;

const schema = z
  .object({
    currentPassword: z.string().min(1, 'נא להזין את הסיסמה הנוכחית').max(128),
    newPassword: z
      .string()
      .regex(PASSWORD_RULE, 'הסיסמה חייבת להכיל 12–128 תווים, לפחות אות אחת וספרה אחת'),
    confirmPassword: z.string().min(1, 'נא לאשר את הסיסמה החדשה'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'הסיסמאות אינן זהות',
  });

type FormValues = z.infer<typeof schema>;

/** תשובת `POST /v1/auth/change-password` — `AuthResponse` בשרת. */
const authResponseSchema = z.object({
  accessToken: z.string(),
  mustChangePassword: z.boolean(),
  user: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string(),
    role: userRoleSchema,
  }),
});

export function ProfilePanel() {
  const { session } = useAuth();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const changePassword = useMutation({
    mutationFn: (values: FormValues) =>
      request('/auth/change-password', {
        method: 'POST',
        // בדיוק שני השדות של ה-DTO: ה-ValidationPipe הגלובלי מוגדר
        // forbidNonWhitelisted, ו-confirmPassword היה מחזיר 400.
        body: { currentPassword: values.currentPassword, newPassword: values.newPassword },
        schema: authResponseSchema,
      }),
    onSuccess: (res) => {
      // השרת מנפיק טוקן חדש בשינוי סיסמה. בלי לשמור אותו, הסשן
      // ממשיך עם טוקן שנחתם לפני השינוי.
      tokenStore.set(res.accessToken);
      reset();
      toast.success('הסיסמה עודכנה');
    },
    onError: (err: unknown) => {
      toast.error('עדכון הסיסמה נכשל', err instanceof ApiError ? err.message : 'משהו השתבש');
    },
  });

  const onSubmit = handleSubmit((values) => changePassword.mutateAsync(values).catch(() => {}));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>פרטי המשתמש</CardTitle>
          <CardDescription>הפרטים מנוהלים על ידי בעלי החשבון</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="שם">{session?.user.name ?? '—'}</Row>
          <Row label="אימייל">
            <span className="ltr-inline">{session?.user.email ?? '—'}</span>
          </Row>
          <Row label="תפקיד">
            {session ? <Badge tone="accent">{ROLE_LABEL[session.user.role]}</Badge> : '—'}
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>שינוי סיסמה</CardTitle>
          <CardDescription>השרת מנפיק טוקן חדש בסיום, ולכן אין צורך להתחבר מחדש</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} noValidate className="max-w-sm space-y-4">
            <Field
              label="סיסמה נוכחית"
              htmlFor="current-password"
              required
              error={errors.currentPassword?.message}
            >
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                invalid={Boolean(errors.currentPassword)}
                {...register('currentPassword')}
              />
            </Field>

            <Field
              label="סיסמה חדשה"
              htmlFor="new-password"
              required
              hint="12–128 תווים, לפחות אות אחת וספרה אחת"
              error={errors.newPassword?.message}
            >
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                invalid={Boolean(errors.newPassword)}
                {...register('newPassword')}
              />
            </Field>

            <Field
              label="אישור סיסמה חדשה"
              htmlFor="confirm-password"
              required
              error={errors.confirmPassword?.message}
            >
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                invalid={Boolean(errors.confirmPassword)}
                {...register('confirmPassword')}
              />
            </Field>

            <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
              עדכון סיסמה
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-fg">{children}</span>
    </div>
  );
}
