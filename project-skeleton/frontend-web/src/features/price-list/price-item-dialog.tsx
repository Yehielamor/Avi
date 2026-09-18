import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import {
  CODE_PATTERN,
  PRICE_LIST_QUERY_KEY,
  PRICE_PATTERN,
  createPriceListItem,
  updatePriceListItem,
  type PriceListItem,
} from './price-list-api';

/* ---------------------------------------------------------------------------
   יצירה ועריכה של פריט מחירון, בדיאלוג אחד.

   בעריכה הקוד מוצג אך לא ניתן לשינוי. צ'קליסטים ותבניות שומרים אותו
   כמחרוזת, ושינוי שם היה מנתק את כולם בלי שגיאה — החשבונית פשוט
   הייתה מדלגת על השורות. השרת דוחה את השדה גם אם יישלח.
   --------------------------------------------------------------------------- */

/**
 * מקלדת עברית ומשתמשים ישראלים מקלידים לעתים קרובות פסיק עשרוני.
 * "149,90" אינו שגיאה אלא 149.90 — מתקנים בשקט במקום להעניש.
 */
const normalizePrice = (raw: string) => raw.trim().replace(',', '.');

const schema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'קוד הוא שדה חובה')
    .max(64, 'קוד עד 64 תווים')
    .regex(CODE_PATTERN, 'קוד יכול להכיל אותיות, ספרות, נקודה, מקף וקו תחתון בלבד'),
  description: z.string().trim().min(1, 'תיאור הוא שדה חובה').max(200, 'תיאור עד 200 תווים'),
  price: z
    .string()
    .transform(normalizePrice)
    .refine((v) => v !== '', 'מחיר הוא שדה חובה')
    .refine((v) => PRICE_PATTERN.test(v), 'מחיר — מספר אי-שלילי, עד שתי ספרות אחרי הנקודה'),
  isActive: z.boolean(),
});

type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

/** "149.9" ו-"149.90" הם אותו מחיר. השוואה כמחרוזת הייתה שולחת עדכון ריק. */
const samePrice = (a: string, b: string) => {
  const norm = (s: string) => {
    const [int = '0', frac = ''] = s.split('.');
    return `${int.replace(/^0+(?=\d)/, '')}.${frac.padEnd(2, '0')}`;
  };
  return norm(a) === norm(b);
};

export function PriceItemDialog({ item, onClose }: { item: PriceListItem | null; onClose: () => void }) {
  const isEdit = item !== null;
  const toast = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: item?.code ?? '',
      description: item?.description ?? '',
      price: item?.price ?? '',
      isActive: item?.isActive ?? true,
    },
  });
  const { errors } = form.formState;
  const isActive = form.watch('isActive');
  const deactivatingUsedCode = isEdit && item.isActive && !isActive && item.usedByTemplates > 0;

  const mutation = useMutation({
    mutationFn: (values: FormOutput) => {
      if (!isEdit) {
        return createPriceListItem({ code: values.code, description: values.description, price: values.price });
      }
      // רק מה שהשתנה: כך יומן הביקורת מתעד שינוי אמיתי ולא "עדכון"
      // של שלושה שדות שאיש לא נגע בהם.
      return updatePriceListItem(item.id, {
        ...(values.description !== item.description && { description: values.description }),
        ...(!samePrice(values.price, item.price) && { price: values.price }),
        ...(values.isActive !== item.isActive && { isActive: values.isActive }),
      });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: [PRICE_LIST_QUERY_KEY] });
      toast.success(isEdit ? 'המחיר עודכן' : 'הפריט נוסף למחירון', `${saved.code} — ${saved.description}`);
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        form.setError('code', { type: 'server', message: 'הקוד הזה כבר קיים במחירון' });
        return;
      }
      toast.error('השמירה נכשלה', error instanceof ApiError ? error.message : 'נסו שוב בעוד רגע');
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (isEdit) {
      const unchanged =
        values.description === item.description &&
        samePrice(values.price, item.price) &&
        values.isActive === item.isActive;
      if (unchanged) {
        onClose();
        return;
      }
    }
    mutation.mutate(values);
  });

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby="price-item-desc">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'עריכת פריט מחירון' : 'פריט מחירון חדש'}</DialogTitle>
          <DialogDescription id="price-item-desc">
            {isEdit
              ? 'שינוי מחיר חל על חשבוניות עתידיות בלבד. חשבוניות שכבר הופקו שומרות את המחיר שבו חויבו.'
              : 'הקוד הוא מה שצ׳קליסטים ותבניות משתמשים בו כדי לתמחר עבודה.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <DialogBody>
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <Field
                label="קוד"
                htmlFor="price-code"
                required={!isEdit}
                error={errors.code?.message}
                hint={isEdit ? 'לא ניתן לשנות קוד קיים — צרו קוד חדש והשביתו את הישן.' : 'למשל AC-FIX'}
              >
                <Input
                  id="price-code"
                  autoFocus={!isEdit}
                  autoComplete="off"
                  spellCheck={false}
                  readOnly={isEdit}
                  // מזהה — LTR גם בטופס עברי.
                  className="ltr-inline text-start read-only:bg-surface-sunken read-only:text-fg-muted"
                  invalid={Boolean(errors.code)}
                  {...form.register('code')}
                />
              </Field>

              <Field label="מחיר (₪)" htmlFor="price-amount" required error={errors.price?.message}>
                <Input
                  id="price-amount"
                  autoFocus={isEdit}
                  // text ולא number: שדה number בדפדפן מקבל "1e3", מעגל
                  // בשקט ומסרב לפסיק עשרוני. כאן כל תו נשמר כפי שהוקלד.
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="ltr-inline tabular text-start"
                  invalid={Boolean(errors.price)}
                  {...form.register('price')}
                />
              </Field>
            </div>

            <Field label="תיאור" htmlFor="price-description" required error={errors.description?.message}>
              <Input
                id="price-description"
                autoComplete="off"
                invalid={Boolean(errors.description)}
                {...form.register('description')}
              />
            </Field>

            {isEdit ? (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
                <div>
                  <label htmlFor="price-active" className="text-sm font-medium text-fg">
                    פעיל
                  </label>
                  <p className="text-2xs text-fg-muted">פריט מושבת אינו מתומחר בחשבוניות חדשות.</p>
                </div>
                <Controller
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <Switch id="price-active" checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              </div>
            ) : null}

            {deactivatingUsedCode ? (
              <div
                role="alert"
                className="flex gap-3 rounded-lg border border-warning-border bg-warning-subtle px-4 py-3 text-sm text-warning"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  {item.usedByTemplates === 1
                    ? 'תבנית עבודה פעילה אחת'
                    : `${item.usedByTemplates} תבניות עבודה פעילות`}{' '}
                  משתמשות בקוד הזה. אחרי ההשבתה, עבודות מהתבניות האלה ייסגרו בלי חיוב על השורה הזו.
                </p>
              </div>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              ביטול
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'שמירה' : 'הוספה למחירון'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
