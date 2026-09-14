import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
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
import { useToast } from '@/components/ui/toast';
import { ApiError, request } from '@/lib/api';
import { inventoryItemSchema } from '@/lib/schemas';
import { formatNumber } from '@/lib/utils';
import { INVENTORY_QUERY_KEY } from './inventory-api';

/* ---------------------------------------------------------------------------
   יצירת פריט מלאי — מראה אחת לאחת את `CreateInventoryItemDto`.

   השדות המספריים מוחזקים כמחרוזות בטופס ומומרים בשליחה. `valueAsNumber`
   מחזיר NaN על שדה ריק, ושדה ריק כאן הוא *לא* שגיאה אלא "השאר את ברירת
   המחדל של השרת" — הפרדה שמחרוזת מבטאת ו-NaN מטשטש.
   --------------------------------------------------------------------------- */

const MAX_QTY = 1_000_000;

/** `@Matches` ב-DTO: אותיות, ספרות, נקודה, מקף וקו תחתון בלבד. */
const SKU_PATTERN = /^[A-Za-z0-9._-]+$/;

const optionalInt = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+$/.test(v), `${label} — מספר שלם אי-שלילי`)
    .refine((v) => v === '' || Number(v) <= MAX_QTY, `${label} — עד ${formatNumber(MAX_QTY)}`);

const newItemSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, 'מק"ט הוא שדה חובה')
    .max(64, 'מק"ט עד 64 תווים')
    .regex(SKU_PATTERN, 'מק"ט יכול להכיל אותיות, ספרות, נקודה, מקף וקו תחתון בלבד'),
  name: z.string().trim().min(1, 'שם הפריט הוא שדה חובה').max(200, 'שם עד 200 תווים'),
  quantity: optionalInt('כמות'),
  lowStockThreshold: optionalInt('סף התראה'),
  unitPrice: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v),
      'מחיר חייב להיות מספר אי-שלילי, עד שתי ספרות אחרי הנקודה',
    ),
  category: z.string().trim().max(100, 'קטגוריה עד 100 תווים'),
});

type NewItemForm = z.infer<typeof newItemSchema>;

const blank = (v: string): string | undefined => (v === '' ? undefined : v);

export function NewItemDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const form = useForm<NewItemForm>({
    resolver: zodResolver(newItemSchema),
    mode: 'onSubmit',
    defaultValues: {
      sku: '',
      name: '',
      quantity: '',
      lowStockThreshold: '',
      unitPrice: '',
      category: '',
    },
  });

  const { errors } = form.formState;

  const mutation = useMutation({
    mutationFn: (values: NewItemForm) => {
      const quantity = blank(values.quantity);
      const lowStockThreshold = blank(values.lowStockThreshold);
      const unitPrice = blank(values.unitPrice);
      return request('/inventory', {
        method: 'POST',
        body: {
          sku: values.sku.trim(),
          name: values.name.trim(),
          quantity: quantity === undefined ? undefined : Number(quantity),
          lowStockThreshold:
            lowStockThreshold === undefined ? undefined : Number(lowStockThreshold),
          // ה-DTO מצפה ל-number (IsNumber, maxDecimalPlaces: 2). השרת
          // עוטף אותו ב-Prisma.Decimal ומחזיר מחרוזת — הכיוון הזה הוא
          // היחיד שבו כסף עובר כמספר, וכבר אומת לשתי ספרות למעלה.
          unitPrice: unitPrice === undefined ? undefined : Number(unitPrice),
          category: blank(values.category.trim()),
        },
        schema: inventoryItemSchema,
      });
    },
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: [INVENTORY_QUERY_KEY] });
      toast.success('הפריט נוצר', `${item.name} — ${item.sku}`);
      onClose();
    },
    onError: (error: unknown) => {
      // 400 על מק"ט כפול מגיע מה-unique constraint בשרת; מצמידים אותו
      // לשדה הרלוונטי ולא רק ל-toast שנעלם.
      if (error instanceof ApiError && error.status === 400 && /sku/i.test(error.message)) {
        form.setError('sku', { type: 'server', message: 'מק"ט זה כבר קיים במערכת' });
      }
      toast.error(
        'יצירת הפריט נכשלה',
        error instanceof ApiError ? error.message : 'נסו שוב בעוד רגע',
      );
    },
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby="new-item-desc">
        <DialogHeader>
          <DialogTitle>פריט מלאי חדש</DialogTitle>
          <DialogDescription id="new-item-desc">
            מק"ט ושם הם שדות חובה. שאר השדות מקבלים ברירת מחדל מהשרת.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <DialogBody>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label='מק"ט'
                htmlFor="item-sku"
                required
                error={errors.sku?.message}
                hint="אותיות, ספרות, נקודה, מקף וקו תחתון."
              >
                <Input
                  id="item-sku"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  // מק"ט הוא מזהה — נשאר LTR גם בטופס עברי.
                  className="ltr-inline text-start"
                  invalid={Boolean(errors.sku)}
                  aria-describedby={errors.sku ? 'item-sku-error' : 'item-sku-hint'}
                  {...form.register('sku')}
                />
              </Field>

              <Field
                label="קטגוריה"
                htmlFor="item-category"
                error={errors.category?.message}
              >
                <Input
                  id="item-category"
                  autoComplete="off"
                  invalid={Boolean(errors.category)}
                  aria-describedby={errors.category ? 'item-category-error' : undefined}
                  {...form.register('category')}
                />
              </Field>
            </div>

            <Field
              label="שם הפריט"
              htmlFor="item-name"
              required
              error={errors.name?.message}
            >
              <Input
                id="item-name"
                autoComplete="off"
                invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'item-name-error' : undefined}
                {...form.register('name')}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="כמות פתיחה"
                htmlFor="item-quantity"
                error={errors.quantity?.message}
                hint="ברירת מחדל 0"
              >
                <Input
                  id="item-quantity"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  invalid={Boolean(errors.quantity)}
                  aria-describedby={
                    errors.quantity ? 'item-quantity-error' : 'item-quantity-hint'
                  }
                  {...form.register('quantity')}
                />
              </Field>

              <Field
                label="סף התראה"
                htmlFor="item-threshold"
                error={errors.lowStockThreshold?.message}
                hint="ברירת מחדל 5"
              >
                <Input
                  id="item-threshold"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  invalid={Boolean(errors.lowStockThreshold)}
                  aria-describedby={
                    errors.lowStockThreshold ? 'item-threshold-error' : 'item-threshold-hint'
                  }
                  {...form.register('lowStockThreshold')}
                />
              </Field>

              <Field
                label="מחיר ליחידה (₪)"
                htmlFor="item-price"
                error={errors.unitPrice?.message}
                hint="לא חובה"
              >
                <Input
                  id="item-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  invalid={Boolean(errors.unitPrice)}
                  aria-describedby={errors.unitPrice ? 'item-price-error' : 'item-price-hint'}
                  {...form.register('unitPrice')}
                />
              </Field>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              ביטול
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              יצירת פריט
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
