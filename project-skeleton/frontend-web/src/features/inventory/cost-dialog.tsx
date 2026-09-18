import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  useToast,
} from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import type { InventoryItem } from '@/lib/schemas';
import { INVENTORY_QUERY_KEY } from './inventory-api';

const PRICE = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * עלות קנייה של פריט — מה שהופך את דו"ח הרווחיות ממשוער לאמיתי.
 * מחרוזת עשרונית ולא number, כמו במחירון; פסיק עשרוני מתקבל.
 */
export function CostDialog({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState(item.unitCost ?? '');
  const normalized = value.trim().replace(',', '.');
  const valid = normalized === '' || PRICE.test(normalized);

  const save = useMutation({
    mutationFn: () =>
      request(`/inventory/${item.id}/cost`, { method: 'PATCH', body: { unitCost: normalized === '' ? null : normalized } }),
    onSuccess: async () => {
      toast.success('העלות נשמרה', item.name);
      await qc.invalidateQueries({ queryKey: [INVENTORY_QUERY_KEY] });
      onClose();
    },
    onError: (e) => toast.error('השמירה נכשלה', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby="cost-desc">
        <DialogHeader>
          <DialogTitle>עלות קנייה — {item.name}</DialogTitle>
          <DialogDescription id="cost-desc">
            כמה הפריט עולה לך מהספק. משמש לחישוב הרווח מכל עבודה שבה הוא נצרך.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <DialogBody>
            <Field label="עלות ליחידה (₪)" htmlFor="unit-cost" error={valid ? undefined : 'מספר עד שתי ספרות אחרי הנקודה'} hint="ריק = אין עלות">
              <Input
                id="unit-cost"
                autoFocus
                type="text"
                inputMode="decimal"
                className="ltr-inline tabular text-start"
                value={value}
                invalid={!valid}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              ביטול
            </Button>
            <Button type="submit" disabled={!valid} loading={save.isPending}>
              שמירה
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
