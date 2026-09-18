import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Wrench } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton, useToast } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/utils';
import { MAINTENANCE_QUERY_KEY } from '@/features/maintenance/maintenance-page';

const equipmentSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  model: z.string().nullable(),
  location: z.string().nullable(),
  serviceIntervalMonths: z.number().int(),
  lastServicedAt: z.string().nullable(),
  isActive: z.boolean(),
});

/**
 * הציוד של הלקוח — הבסיס לתזכורות. בלי ציוד כאן, "מגיע לטיפול" ריק.
 */
export function EquipmentCard({ customerId }: { customerId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['equipment', customerId];
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ kind: 'מזגן', location: '', serviceIntervalMonths: '6', lastServicedOn: '' });

  const list = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => request(`/customers/${customerId}/equipment`, { schema: z.array(equipmentSchema), signal }),
    enabled: can('OWNER', 'MANAGER'),
  });

  const create = useMutation({
    mutationFn: () =>
      request(`/customers/${customerId}/equipment`, {
        method: 'POST',
        body: {
          kind: form.kind.trim(),
          ...(form.location.trim() && { location: form.location.trim() }),
          serviceIntervalMonths: Number(form.serviceIntervalMonths),
          ...(form.lastServicedOn && { lastServicedOn: form.lastServicedOn }),
        },
      }),
    onSuccess: async () => {
      toast.success('הציוד נוסף', 'הוא יופיע ב"מגיע לטיפול" כשיגיע זמנו.');
      setAdding(false);
      setForm({ kind: 'מזגן', location: '', serviceIntervalMonths: '6', lastServicedOn: '' });
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: [MAINTENANCE_QUERY_KEY] });
    },
    onError: (e) => toast.error('הוספת הציוד נכשלה', e instanceof ApiError ? e.message : undefined),
  });

  if (!can('OWNER', 'MANAGER')) return null;
  const interval = Number(form.serviceIntervalMonths);
  const valid = form.kind.trim() !== '' && Number.isInteger(interval) && interval >= 1 && interval <= 60;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>ציוד</CardTitle>
        {!adding ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            הוספה
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {list.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : list.data && list.data.length > 0 ? (
          <ul className="divide-y divide-border">
            {list.data.map((e) => (
              <li key={e.id} className={`flex items-center gap-3 py-2.5 ${e.isActive ? '' : 'opacity-50'}`}>
                <Wrench className="size-4 text-fg-subtle" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">
                    {e.kind}
                    {e.location ? ` · ${e.location}` : ''}
                  </p>
                  <p className="text-xs text-fg-muted">
                    טיפול כל {e.serviceIntervalMonths} חודשים ·{' '}
                    {e.lastServicedAt ? `אחרון ${formatDate(e.lastServicedAt)}` : 'טרם טופל'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : !adding ? (
          <p className="text-sm text-fg-muted">אין ציוד רשום. הוספת מזגן כאן תאפשר תזכורת אוטומטית לטיפול הבא.</p>
        ) : null}

        {adding ? (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) create.mutate();
            }}
          >
            <Field label="סוג" htmlFor="eq-kind" required>
              <Input id="eq-kind" value={form.kind} maxLength={100} onChange={(e) => setForm({ ...form, kind: e.target.value })} />
            </Field>
            <Field label="מיקום" htmlFor="eq-location" hint="למשל: סלון, חדר שינה">
              <Input id="eq-location" value={form.location} maxLength={100} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </Field>
            <Field label="טיפול כל (חודשים)" htmlFor="eq-interval" required>
              <Input
                id="eq-interval"
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                value={form.serviceIntervalMonths}
                onChange={(e) => setForm({ ...form, serviceIntervalMonths: e.target.value })}
              />
            </Field>
            <Field label="טיפול אחרון" htmlFor="eq-last" hint="אם ידוע — אחרת נספר מהיום">
              <Input
                id="eq-last"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={form.lastServicedOn}
                onChange={(e) => setForm({ ...form, lastServicedOn: e.target.value })}
              />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={!valid} loading={create.isPending}>
                שמירה
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setAdding(false)}>
                ביטול
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
