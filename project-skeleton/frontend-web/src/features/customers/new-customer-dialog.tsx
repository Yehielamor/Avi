import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError, request } from '@/lib/api';
import { customerSchema } from '@/lib/schemas';

/**
 * מראה את CreateCustomerDto בשרת: name חובה (1–200), והשאר אופציונלי —
 * email (פורמט, עד 320), phone (עד 40), address (עד 500).
 * שדה ריק בטופס הוא "לא נשלח", ולכן `''` מותר כאן ומושמט ב-submit.
 */
const schema = z.object({
  name: z.string().trim().min(1, 'נא להזין שם לקוח').max(200, 'שם ארוך מדי — עד 200 תווים'),
  email: z
    .string()
    .trim()
    .max(320, 'אימייל ארוך מדי — עד 320 תווים')
    .email('כתובת אימייל לא תקינה')
    .or(z.literal('')),
  phone: z.string().trim().max(40, 'מספר טלפון ארוך מדי — עד 40 תווים'),
  address: z.string().trim().max(500, 'כתובת ארוכה מדי — עד 500 תווים'),
});
type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = { name: '', email: '', phone: '', address: '' };

export function NewCustomerDialog() {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      request('/customers', {
        method: 'POST',
        // השרת מנרמל אימייל ל-lowercase לצורך ההתאמה מול Gmail sync;
        // נורמול גם כאן מונע יצירת כפילות מהמסך.
        body: {
          name: values.name.trim(),
          ...(values.email ? { email: values.email.trim().toLowerCase() } : {}),
          ...(values.phone ? { phone: values.phone.trim() } : {}),
          ...(values.address ? { address: values.address.trim() } : {}),
        },
        schema: customerSchema,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (customer) => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('הלקוח נוצר', customer.name);
      reset(EMPTY);
      setOpen(false);
    },
    onError: (err: unknown) => {
      toast.error(
        'יצירת הלקוח נכשלה',
        err instanceof ApiError ? err.message : 'שגיאה לא צפויה. נסה שוב.',
      );
    },
  });

  const onSubmit = handleSubmit((values) => create.mutateAsync(values).catch(() => undefined));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset(EMPTY);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          לקוח חדש
        </Button>
      </DialogTrigger>

      <DialogContent aria-describedby="new-customer-desc">
        <DialogHeader>
          <DialogTitle>לקוח חדש</DialogTitle>
          <DialogDescription id="new-customer-desc">
            שם הלקוח הוא השדה היחיד שחובה למלא. אימייל מאפשר שיוך אוטומטי של מיילים נכנסים ללקוח.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate>
          <DialogBody>
            <Field label="שם" htmlFor="customer-name" error={errors.name?.message} required>
              <Input
                id="customer-name"
                autoComplete="off"
                invalid={!!errors.name}
                aria-describedby={errors.name ? 'customer-name-error' : undefined}
                {...register('name')}
              />
            </Field>

            <Field
              label="אימייל"
              htmlFor="customer-email"
              error={errors.email?.message}
              hint="ישמש לזיהוי אוטומטי של מיילים נכנסים מהלקוח."
            >
              <Input
                id="customer-email"
                type="email"
                autoComplete="off"
                invalid={!!errors.email}
                aria-describedby={
                  errors.email ? 'customer-email-error' : 'customer-email-hint'
                }
                {...register('email')}
              />
            </Field>

            <Field label="טלפון" htmlFor="customer-phone" error={errors.phone?.message}>
              <Input
                id="customer-phone"
                type="tel"
                autoComplete="off"
                invalid={!!errors.phone}
                aria-describedby={errors.phone ? 'customer-phone-error' : undefined}
                {...register('phone')}
              />
            </Field>

            <Field label="כתובת" htmlFor="customer-address" error={errors.address?.message}>
              <Input
                id="customer-address"
                autoComplete="off"
                invalid={!!errors.address}
                aria-describedby={errors.address ? 'customer-address-error' : undefined}
                {...register('address')}
              />
            </Field>
          </DialogBody>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                ביטול
              </Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending}>
              צור לקוח
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
