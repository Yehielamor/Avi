import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from '@/components/ui';
import { request } from '@/lib/api';
import { customerSchema } from '@/lib/schemas';
import { useEmailEnabled } from '@/lib/use-email-enabled';

/**
 * הסכימה משקפת את `CreateManualTaskDto` בשרת אחד לאחד.
 *
 * `jobTypeTemplateId` הוא **חובה** שם, לא אופציונלי — התבנית היא מה
 * שקובע את ה-checklist, את המחירון ואת הכישור הנדרש לשיוך. משימה
 * בלי תבנית היא משימה שאי אפשר לחייב עליה ואי אפשר לשייך.
 */
const schema = z.object({
  customerId: z.string().uuid('נא לבחור לקוח'),
  jobTypeTemplateId: z.string().uuid('נא לבחור סוג עבודה'),
  title: z.string().trim().min(1, 'נא להזין כותרת').max(200, 'עד 200 תווים'),
  description: z.string().trim().max(5000, 'עד 5000 תווים').optional(),
});
type FormValues = z.infer<typeof schema>;

const templateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  requiredSkill: z.string().nullish(),
});

const customerListSchema = z.object({ items: z.array(customerSchema) });

export function NewTaskDialog() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const email = useEmailEnabled();

  // נטענים רק כשהדיאלוג נפתח — אין טעם לשלוף לקוחות ותבניות
  // בכל טעינה של מסך הרשימה.
  const customers = useQuery({
    queryKey: ['customers', { forPicker: true }],
    queryFn: ({ signal }) => request('/customers?take=100', { schema: customerListSchema, signal }),
    enabled: open,
  });

  const templates = useQuery({
    queryKey: ['job-type-templates'],
    queryFn: ({ signal }) =>
      request('/job-type-templates', { schema: z.array(templateSchema), signal }),
    enabled: open,
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const customerId = watch('customerId');
  const templateId = watch('jobTypeTemplateId');

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      request<{ id: string }>('/tasks/manual', {
        method: 'POST',
        body: {
          ...values,
          description: values.description || undefined,
        },
        // יצירת משימה מפעילה שיוך טכנאי ומייל ללקוח. לחיצה כפולה
        // או ניסיון חוזר אחרי timeout לא אמורים לייצר שתי משימות.
        idempotencyKey: idempotencyKey,
      }),
    onSuccess: async () => {
      toast.success(
        'המשימה נוצרה',
        email.enabled ? 'השיוך לטכנאי והמייל ללקוח מטופלים ברקע' : 'השיוך לטכנאי מטופל ברקע',
      );
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: Error) => toast.error('יצירת המשימה נכשלה', err.message),
  });

  // מפתח אחד לכל פתיחה של הדיאלוג, לא לכל רינדור.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` is a deliberate trigger: a fresh key per dialog opening, not a value the callback reads
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [open]);

  const onSubmit = handleSubmit((values) => create.mutateAsync(values).catch(() => undefined));

  const loading = customers.isLoading || templates.isLoading;
  const noTemplates = templates.data?.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          משימה חדשה
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>משימה חדשה</DialogTitle>
          <DialogDescription>משימה שנוצרת ידנית, לא ממייל נכנס.</DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <DialogBody>
            {noTemplates ? (
              // מצב ריק אמיתי: אומר למה אי אפשר להמשיך ומה לעשות.
              <p
                role="alert"
                className="rounded-(--radius-md) border border-warning-border bg-warning-subtle p-3 text-xs text-warning"
              >
                אין עדיין סוגי עבודה מוגדרים. סוג עבודה קובע את רשימת העבודות ואת המחירון, ולכן הוא
                נדרש ליצירת משימה. אפשר להגדיר אותם בהגדרות.
              </p>
            ) : null}

            <Field label="לקוח" htmlFor="customerId" error={errors.customerId?.message} required>
              <Select
                value={customerId ?? ''}
                onValueChange={(v) => setValue('customerId', v, { shouldValidate: true })}
                disabled={loading}
              >
                <SelectTrigger id="customerId" aria-label="לקוח">
                  <SelectValue placeholder={loading ? 'טוען…' : 'בחר לקוח'} />
                </SelectTrigger>
                <SelectContent>
                  {customers.data?.items.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="סוג עבודה"
              htmlFor="jobTypeTemplateId"
              error={errors.jobTypeTemplateId?.message}
              hint="קובע את רשימת העבודות, המחירון והכישור הנדרש לשיוך"
              required
            >
              <Select
                value={templateId ?? ''}
                onValueChange={(v) => setValue('jobTypeTemplateId', v, { shouldValidate: true })}
                disabled={loading || noTemplates}
              >
                <SelectTrigger id="jobTypeTemplateId" aria-label="סוג עבודה">
                  <SelectValue placeholder={loading ? 'טוען…' : 'בחר סוג עבודה'} />
                </SelectTrigger>
                <SelectContent>
                  {templates.data?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="כותרת" htmlFor="title" error={errors.title?.message} required>
              <Input id="title" placeholder="למשל: טיפול שנתי - 3 יחידות" {...register('title')} />
            </Field>

            <Field label="תיאור" htmlFor="description" error={errors.description?.message}>
              <Textarea
                id="description"
                rows={3}
                placeholder="פרטים נוספים, אם יש"
                {...register('description')}
              />
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              ביטול
            </Button>
            <Button type="submit" size="sm" loading={isSubmitting} disabled={noTemplates}>
              צור משימה
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
