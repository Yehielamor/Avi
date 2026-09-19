import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BellRing, CalendarCheck2, Wrench } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { ShareDialog, shareResultSchema, type ShareResult } from '@/components/share-dialog';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, useToast } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/utils';

/* ---------------------------------------------------------------------------
   מגיע לטיפול.

   הפיצ'ר היחיד שמכניס כסף ולא רק חוסך זמן: כל שורה כאן היא לקוח שכנראה
   צריך טיפול ועוד לא יודע. לחיצה אחת פותחת WhatsApp עם הודעה וקישור
   לקביעת מועד, והלקוח שבוחר מועד הופך למשימה חדשה.
   --------------------------------------------------------------------------- */

const dueRowSchema = z.object({
  equipmentId: z.string().uuid(),
  kind: z.string(),
  location: z.string().nullable(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  hasPhone: z.boolean(),
  lastServicedAt: z.string().nullable(),
  dueAt: z.string(),
  daysOverdue: z.number().int(),
  lastReminderAt: z.string().nullable(),
  remindedRecently: z.boolean(),
});
type DueRow = z.infer<typeof dueRowSchema>;

export const MAINTENANCE_QUERY_KEY = 'maintenance-due';

export function MaintenancePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [shared, setShared] = useState<ShareResult | null>(null);

  const due = useQuery({
    queryKey: [MAINTENANCE_QUERY_KEY],
    queryFn: ({ signal }) => request('/maintenance/due?withinDays=14', { schema: z.array(dueRowSchema), signal }),
  });

  const remind = useMutation({
    mutationFn: (equipmentId: string) =>
      request(`/equipment/${equipmentId}/remind`, { method: 'POST', schema: shareResultSchema }),
    onSuccess: (result) => {
      setShared(result);
      void qc.invalidateQueries({ queryKey: [MAINTENANCE_QUERY_KEY] });
    },
    onError: (e) => toast.error('יצירת התזכורת נכשלה', e instanceof ApiError ? e.message : undefined),
  });

  const rows = due.data ?? [];
  const overdue = rows.filter((r) => r.daysOverdue > 0).length;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="מגיע לטיפול"
        description={
          rows.length > 0
            ? `${formatNumber(rows.length)} יחידות — ${formatNumber(overdue)} באיחור. כל תזכורת היא עבודה פוטנציאלית.`
            : 'ציוד של לקוחות שהגיע זמנו לטיפול תקופתי, בשבועיים הקרובים'
        }
      />

      <Card className="overflow-hidden">
        {due.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-9 w-32" />
              </div>
            ))}
          </div>
        ) : due.isError ? (
          <ErrorState error={due.error} onRetry={() => void due.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CalendarCheck2}
            title="אין ציוד שמגיע לטיפול"
            description="כשמוסיפים ללקוח ציוד (מזגן, מחזור טיפול), הוא יופיע כאן כשיגיע זמנו. מוסיפים ציוד בדף הלקוח."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <DueItem
                key={row.equipmentId}
                row={row}
                busy={remind.isPending && remind.variables === row.equipmentId}
                onRemind={() => remind.mutate(row.equipmentId)}
              />
            ))}
          </ul>
        )}
      </Card>

      {shared ? (
        <ShareDialog
          result={shared}
          title="תזכורת לטיפול"
          description="ההודעה תיפתח ב-WhatsApp שלך. הלקוח יבחור מועד נוח, והבקשה תופיע אצלך כמשימה חדשה."
          onClose={() => setShared(null)}
        />
      ) : null}
    </div>
  );
}

function DueItem({ row, busy, onRemind }: { row: DueRow; busy: boolean; onRemind: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
      <Wrench className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      <div className="min-w-0 flex-1">
        <Link
          to="/customers/$customerId"
          params={{ customerId: row.customerId }}
          className="font-medium text-fg hover:underline"
        >
          {row.customerName}
        </Link>
        <p className="text-sm text-fg-muted">
          {row.kind}
          {row.location ? ` · ${row.location}` : ''} ·{' '}
          {row.lastServicedAt ? `טיפול אחרון ${formatDate(row.lastServicedAt)}` : 'לא טופל אצלנו'}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {row.daysOverdue > 0 ? (
          <Badge tone="danger">באיחור {formatNumber(row.daysOverdue)} ימים</Badge>
        ) : (
          <Badge tone="warning">בקרוב</Badge>
        )}
        {row.remindedRecently ? (
          <Badge tone="neutral" dot={false}>
            נשלחה תזכורת
          </Badge>
        ) : null}
      </div>

      <Button
        size="sm"
        variant={row.remindedRecently ? 'secondary' : 'primary'}
        onClick={onRemind}
        loading={busy}
        // בלי טלפון תקין אין WhatsApp — אבל עדיין אפשר ליצור קישור ולהעתיק.
        title={row.hasPhone ? undefined : 'אין מספר טלפון ישראלי תקין — אפשר להעתיק את ההודעה'}
      >
        <BellRing aria-hidden />
        {row.remindedRecently ? 'לשלוח שוב' : 'שליחת תזכורת'}
      </Button>
    </li>
  );
}
