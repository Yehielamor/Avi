import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useMemo } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ApiError, request } from '@/lib/api';
import type { InventoryItem } from '@/lib/schemas';
import { cn, formatNumber } from '@/lib/utils';
import { INVENTORY_QUERY_KEY, stockRowSchema } from './inventory-api';

/* ---------------------------------------------------------------------------
   עדכון כמות לפריט בודד.

   `AdjustQuantityDto` מקבל `delta` (שלם, ≠ 0) ו-`note` אופציונלית בלבד.
   סוג התנועה — RESTOCK מול MANUAL_ADJUSTMENT — *נגזר בשרת מסימן ה-delta*
   ואינו שדה בגוף הבקשה. לכן הטופס שואל "כיוון + כמות" ולא שולח reason:
   בחירת הכיוון היא בחירת הסיבה, וכך אי אפשר לשלוח צירוף שהשרת יסתור.
   --------------------------------------------------------------------------- */

const MAX_DELTA = 1_000_000;

function buildSchema(currentQuantity: number) {
  return z
    .object({
      direction: z.enum(['add', 'remove']),
      amount: z
        .string()
        .trim()
        .min(1, 'יש להזין כמות')
        .regex(/^\d+$/, 'יש להזין מספר שלם, ללא סימנים')
        .refine((v) => Number(v) > 0, 'הכמות חייבת להיות גדולה מאפס')
        .refine((v) => Number(v) <= MAX_DELTA, `הכמות המרבית לעדכון היא ${formatNumber(MAX_DELTA)}`),
      note: z.string().trim().max(500, 'הערה עד 500 תווים').optional(),
    })
    .superRefine((values, ctx) => {
      const amount = Number(values.amount);
      if (!Number.isFinite(amount)) return;
      // חסימה בצד הלקוח כדי לא לשלוח בקשה שנדחית ממילא; השרת חוסם
      // את אותו מקרה ב-409, וגם בו מטופל — ראו onError.
      if (values.direction === 'remove' && amount > currentQuantity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['amount'],
          message: `הפחתה של ${formatNumber(amount)} תוריד את המלאי מתחת לאפס. במלאי כעת ${formatNumber(currentQuantity)}.`,
        });
      }
    });
}

type AdjustForm = z.infer<ReturnType<typeof buildSchema>>;

export function AdjustQuantityDialog({
  item,
  onClose,
}: {
  item: InventoryItem;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const schema = useMemo(() => buildSchema(item.quantity), [item.quantity]);

  const form = useForm<AdjustForm>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    defaultValues: { direction: 'add', amount: '', note: '' },
  });

  const direction = form.watch('direction');
  const amountRaw = form.watch('amount');

  const parsedAmount = /^\d+$/.test(amountRaw.trim()) ? Number(amountRaw.trim()) : null;
  const delta = parsedAmount === null ? null : direction === 'add' ? parsedAmount : -parsedAmount;
  const preview = delta === null ? null : item.quantity + delta;
  const previewInvalid = preview !== null && preview < 0;

  const mutation = useMutation({
    mutationFn: (values: AdjustForm) => {
      const amount = Number(values.amount);
      const note = values.note?.trim();
      return request(`/inventory/${item.id}/adjust`, {
        method: 'PATCH',
        body: {
          delta: values.direction === 'add' ? amount : -amount,
          // מחרוזת ריקה נדחית בשרת (Length 1..500) — לא שולחים שדה ריק.
          note: note && note.length > 0 ? note : undefined,
        },
        schema: stockRowSchema,
      });
    },
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: [INVENTORY_QUERY_KEY] });
      toast.success(
        'הכמות עודכנה',
        `${row.name} — ${formatNumber(row.quantity)} יחידות במלאי`,
      );
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        // הכמות בשרת השתנתה מאז שהמסך נטען. הודעת השרת היא האמת,
        // והרענון מחזיר את השדה לתצוגת המצב האמיתי.
        void queryClient.invalidateQueries({ queryKey: [INVENTORY_QUERY_KEY] });
        form.setError('amount', {
          type: 'server',
          message: 'הכמות במלאי השתנתה בינתיים. רעננו ונסו שוב עם כמות מעודכנת.',
        });
        toast.error('העדכון נדחה', error.message);
        return;
      }
      toast.error(
        'העדכון נכשל',
        error instanceof ApiError ? error.message : 'נסו שוב בעוד רגע',
      );
    },
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby="adjust-desc">
        <DialogHeader>
          <DialogTitle>עדכון כמות במלאי</DialogTitle>
          <DialogDescription id="adjust-desc">
            {item.name} · <span className="ltr-inline">{item.sku}</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <DialogBody>
            <div className="flex flex-wrap items-center gap-3 rounded-(--radius-md) border border-border bg-surface-sunken px-4 py-3">
              <div>
                <p className="text-2xs text-fg-subtle">כמות נוכחית</p>
                <p className="tabular text-sm font-semibold text-fg">
                  {formatNumber(item.quantity)}
                </p>
              </div>
              <div
                className="ms-auto text-end"
                aria-live="polite"
                // התצוגה מתעדכנת תוך כדי הקלדה; polite כדי שקורא מסך
                // יכריז על התוצאה בלי לקטוע את ההקלדה.
              >
                <p className="text-2xs text-fg-subtle">לאחר העדכון</p>
                <p
                  className={cn(
                    'tabular text-sm font-semibold',
                    preview === null
                      ? 'text-fg-subtle'
                      : previewInvalid
                        ? 'text-danger'
                        : 'text-fg',
                  )}
                >
                  {preview === null ? '—' : formatNumber(preview)}
                </p>
              </div>
            </div>

            <Field label="סוג העדכון" htmlFor="adjust-direction" required>
              <Controller
                control={form.control}
                name="direction"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => field.onChange(v)}
                  >
                    <SelectTrigger id="adjust-direction" aria-label="סוג העדכון">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="add">קליטת סחורה (הוספה למלאי)</SelectItem>
                      <SelectItem value="remove">תיקון ידני (הפחתה מהמלאי)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field
              label="כמות"
              htmlFor="adjust-amount"
              required
              error={form.formState.errors.amount?.message}
              hint={
                direction === 'add'
                  ? 'הכמות תתועד כקליטת סחורה.'
                  : 'ההפחתה תתועד כתיקון ידני, למשל אחרי ספירת מלאי.'
              }
            >
              <div className="relative">
                {direction === 'add' ? (
                  <ArrowUpRight
                    className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-success"
                    aria-hidden
                  />
                ) : (
                  <ArrowDownRight
                    className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-danger"
                    aria-hidden
                  />
                )}
                <Input
                  id="adjust-amount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  autoFocus
                  className="ps-9"
                  invalid={Boolean(form.formState.errors.amount)}
                  aria-describedby={
                    form.formState.errors.amount ? 'adjust-amount-error' : 'adjust-amount-hint'
                  }
                  {...form.register('amount')}
                />
              </div>
            </Field>

            <Field
              label="הערה"
              htmlFor="adjust-note"
              error={form.formState.errors.note?.message}
              hint="נשמרת בהיסטוריית התנועות — למשל מספר תעודת משלוח."
            >
              <Textarea
                id="adjust-note"
                rows={3}
                maxLength={500}
                invalid={Boolean(form.formState.errors.note)}
                aria-describedby={
                  form.formState.errors.note ? 'adjust-note-error' : 'adjust-note-hint'
                }
                {...form.register('note')}
              />
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              ביטול
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={previewInvalid}>
              עדכון כמות
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
