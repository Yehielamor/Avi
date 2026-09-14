import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ApiError, request } from '@/lib/api';
import { customerListSchema, invoiceSchema } from '@/lib/schemas';
import { invoicesQueryKey } from './invoices-api';

/**
 * `GenerateInvoiceDto` בשרת: `customerId` (UUID), `periodStart`,
 * `periodEnd` — שניהם `@Type(() => Date) @IsDate()`, כלומר מחרוזת
 * ISO 8601. `whitelist + forbidNonWhitelisted` פעילים: כל שדה נוסף
 * מחזיר 400, ולכן נשלחים בדיוק שלושת אלה.
 */
interface GeneratePayload {
  customerId: string;
  periodStart: string;
  periodEnd: string;
}

/** ברירת מחדל: החודש הקודם — מחזור החיוב הטבעי של העסק. */
function lastMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return { start: toInputDate(start), end: toInputDate(end) };
}

function toInputDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * `<input type="date">` מחזיר `YYYY-MM-DD` בלבד. השרת משווה מול
 * `closedAt` שהוא Timestamptz, ולכן הגבולות נמתחים ליום שלם בשעון
 * המקומי: בלי זה משימה שנסגרה ב-17:00 ביום האחרון של התקופה נופלת
 * מחוץ לחשבונית.
 */
function dayStartIso(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}
function dayEndIso(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

export function GenerateInvoiceDialog() {
  const [open, setOpen] = useState(false);
  // מפתח אידמפוטנטיות אחד לכל *פתיחה* של החלונית, לא לכל רינדור:
  // ההפקה יקרה (רינדור PDF + העלאה ל-Drive) ומקצה מספר חשבונית רץ.
  // שליחה כפולה של אותה כוונה חייבת להיבלע בשרת, לא ליצור חשבונית שנייה.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  function onOpenChange(next: boolean) {
    if (next) setIdempotencyKey(crypto.randomUUID());
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          הפקת חשבונית
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>הפקת חשבונית</DialogTitle>
          <DialogDescription>
            החשבונית תכלול את כל המשימות שנסגרו ללקוח בתקופה ושטרם חויבו.
          </DialogDescription>
        </DialogHeader>
        {/* key — טופס נקי בכל פתיחה, יחד עם מפתח אידמפוטנטיות חדש. */}
        <GenerateInvoiceForm
          key={idempotencyKey}
          idempotencyKey={idempotencyKey}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function GenerateInvoiceForm({
  idempotencyKey,
  onDone,
}: {
  idempotencyKey: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const defaults = lastMonthRange();

  const [customerId, setCustomerId] = useState('');
  const [periodStart, setPeriodStart] = useState(defaults.start);
  const [periodEnd, setPeriodEnd] = useState(defaults.end);
  const [error, setError] = useState<string | null>(null);

  const customers = useQuery({
    queryKey: ['customers', { take: 100 }],
    queryFn: ({ signal }) =>
      request('/customers?take=100', { schema: customerListSchema, signal }),
  });

  const generate = useMutation({
    mutationFn: (payload: GeneratePayload) =>
      request('/invoices/generate', {
        method: 'POST',
        body: payload,
        schema: invoiceSchema,
        idempotencyKey,
      }),
    onSuccess: (invoice) => {
      void queryClient.invalidateQueries({ queryKey: invoicesQueryKey });
      toast.success('החשבונית הופקה', `מספר חשבונית ${invoice.invoiceNumber}`);
      onDone();
    },
    onError: (err: unknown) => {
      // הודעת השרת היא המדויקת: "אין משימות סגורות שטרם חויבו",
      // 409 על חיוב מקביל, וכו'. אין טעם להחליף אותה בטקסט כללי.
      toast.error('הפקת החשבונית נכשלה', err instanceof ApiError ? err.message : 'משהו השתבש');
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (generate.isPending) return;

    if (!customerId) return setError('נא לבחור לקוח');
    if (!periodStart || !periodEnd) return setError('נא להזין תקופה מלאה');
    if (periodStart > periodEnd) return setError('תאריך הסיום מוקדם מתאריך ההתחלה');
    setError(null);

    generate.mutate({
      customerId,
      periodStart: dayStartIso(periodStart),
      periodEnd: dayEndIso(periodEnd),
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogBody>
        {error ? (
          <p role="alert" className="text-2xs text-danger">
            {error}
          </p>
        ) : null}

        <Field label="לקוח" htmlFor="invoice-customer" required>
          <Select value={customerId} onValueChange={setCustomerId} disabled={customers.isLoading}>
            <SelectTrigger id="invoice-customer" aria-label="לקוח">
              <SelectValue
                placeholder={customers.isLoading ? 'טוען לקוחות…' : 'בחירת לקוח'}
              />
            </SelectTrigger>
            <SelectContent>
              {(customers.data?.items ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {customers.isError ? (
          <p role="alert" className="text-2xs text-danger">
            טעינת רשימת הלקוחות נכשלה. סגור את החלונית ונסה שוב.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="תחילת תקופה" htmlFor="invoice-period-start" required>
            <Input
              id="invoice-period-start"
              type="date"
              value={periodStart}
              max={periodEnd || undefined}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="text-start [direction:ltr]"
            />
          </Field>
          <Field label="סוף תקופה" htmlFor="invoice-period-end" required>
            <Input
              id="invoice-period-end"
              type="date"
              value={periodEnd}
              min={periodStart || undefined}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="text-start [direction:ltr]"
            />
          </Field>
        </div>

        <p className="flex items-start gap-2 text-2xs text-fg-subtle">
          <FileText className="mt-px size-3.5 shrink-0" aria-hidden />
          ההפקה כוללת רינדור PDF והעלאה ל-Google Drive ועשויה להימשך מספר שניות.
        </p>
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={generate.isPending}>
          ביטול
        </Button>
        {/* חסימת הכפתור בזמן הבקשה היא ההגנה הראשונה; מפתח
            האידמפוטנטיות הוא זה שמחזיק גם מול רענון או חיבור שנופל. */}
        <Button type="submit" loading={generate.isPending} disabled={generate.isPending}>
          הפקה
        </Button>
      </DialogFooter>
    </form>
  );
}
