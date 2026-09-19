import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDrive, Mail, Plug, Unplug } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ApiError, request } from '@/lib/api';
import { formatRelative } from '@/lib/utils';

/* ---------------------------------------------------------------------------
   `GET /v1/integrations` מחזיר שורה לכל ספק *שחובר אי פעם*. ספק שאין
   לו שורה כלל אינו "שגיאה" — הוא פשוט לא חובר, ולכן ברירת המחדל
   בתצוגה היא DISCONNECTED.
   --------------------------------------------------------------------------- */

const integrationStatusSchema = z.enum(['CONNECTED', 'EXPIRED', 'ERROR', 'DISCONNECTED']);
type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

const integrationSchema = z.object({
  provider: z.enum(['GMAIL', 'DRIVE', 'OUTLOOK', 'GREEN_INVOICE']),
  status: integrationStatusSchema,
  lastError: z.string().nullish(),
  lastErrorAt: z.string().nullish(),
  lastSyncedAt: z.string().nullish(),
  updatedAt: z.string(),
});
const integrationListSchema = z.array(integrationSchema);

const connectResponseSchema = z.object({ authUrl: z.string().url() });
const disconnectResponseSchema = z.object({ disconnected: z.number().int() });

type GoogleProvider = 'GMAIL' | 'DRIVE';

const PROVIDERS: Array<{
  provider: GoogleProvider;
  title: string;
  description: string;
  icon: typeof Mail;
}> = [
  // Gmail כבר לא כאן: קליטת מיילים עברה להעברה אוטומטית (EmailForwardingCard,
  // ADR 0001) — בלי OAuth ובלי גישה לכל התיבה.
  {
    provider: 'DRIVE',
    title: 'Google Drive',
    description: 'שמירת קובצי ה-PDF של החשבוניות',
    icon: HardDrive,
  },
];

const STATUS: Record<
  IntegrationStatus,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  CONNECTED: { label: 'מחובר', tone: 'success' },
  EXPIRED: { label: 'ההרשאה פגה', tone: 'warning' },
  ERROR: { label: 'שגיאה', tone: 'danger' },
  DISCONNECTED: { label: 'מנותק', tone: 'neutral' },
};

export function IntegrationsPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pendingDisconnect, setPendingDisconnect] = useState<GoogleProvider | null>(null);

  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: ({ signal }) => request('/integrations', { schema: integrationListSchema, signal }),
  });

  const connect = useMutation({
    mutationFn: () => request('/integrations/google/connect', { schema: connectResponseSchema }),
    onSuccess: ({ authUrl }) => {
      // אי אפשר פשוט לנווט ל-`/v1/integrations/google/connect`:
      // הנתיב דורש Bearer ומחזיר JSON. מביאים ממנו את כתובת ההסכמה
      // (שמגדירה גם את ה-state ואת ה-cookie) ורק אז יוצאים ל-Google.
      window.location.assign(authUrl);
    },
    onError: (err: unknown) => {
      toast.error('פתיחת החיבור נכשלה', err instanceof ApiError ? err.message : 'משהו השתבש');
    },
  });

  const disconnect = useMutation({
    mutationFn: (provider: GoogleProvider) =>
      request(`/integrations/${provider}`, {
        method: 'DELETE',
        schema: disconnectResponseSchema,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrations'] });
      setPendingDisconnect(null);
      toast.success('החיבור נותק');
    },
    onError: (err: unknown) => {
      toast.error('הניתוק נכשל', err instanceof ApiError ? err.message : 'משהו השתבש');
    },
  });

  const byProvider = new Map(integrations.data?.map((i) => [i.provider, i]));
  const pendingMeta = PROVIDERS.find((p) => p.provider === pendingDisconnect);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google</CardTitle>
        <CardDescription>
          חשבון Google אחד מספק את שני החיבורים: קליטת המיילים ושמירת החשבוניות.
        </CardDescription>
      </CardHeader>

      <CardContent className="p-0">
        {integrations.isLoading ? (
          <div className="divide-y divide-border">
            {PROVIDERS.map((p) => (
              <div key={p.provider} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="size-9 rounded-(--radius-md)" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : integrations.isError ? (
          <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />
        ) : (
          <ul className="divide-y divide-border">
            {PROVIDERS.map(({ provider, title, description, icon: Icon }) => {
              const row = byProvider.get(provider);
              const status: IntegrationStatus = row?.status ?? 'DISCONNECTED';
              const meta = STATUS[status];
              const connected = status === 'CONNECTED' || status === 'EXPIRED' || status === 'ERROR';

              return (
                <li key={provider} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="grid size-9 shrink-0 place-items-center rounded-(--radius-md) bg-surface-sunken text-fg-muted">
                    <Icon className="size-4" aria-hidden />
                  </div>

                  <div className="min-w-40 flex-1">
                    <p className="text-sm font-medium text-fg">{title}</p>
                    <p className="mt-0.5 text-xs text-fg-muted">{description}</p>
                    {row?.lastSyncedAt ? (
                      <p className="mt-1 text-2xs text-fg-subtle">
                        סונכרן לאחרונה {formatRelative(row.lastSyncedAt)}
                      </p>
                    ) : null}
                    {status === 'ERROR' && row?.lastError ? (
                      <p className="mt-1 text-2xs text-danger">{row.lastError}</p>
                    ) : null}
                  </div>

                  <Badge tone={meta.tone}>{meta.label}</Badge>

                  {connected ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPendingDisconnect(provider)}
                    >
                      <Unplug aria-hidden />
                      ניתוק
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      loading={connect.isPending}
                      disabled={connect.isPending}
                      onClick={() => connect.mutate()}
                    >
                      <Plug aria-hidden />
                      חיבור
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {/* ניתוק שובר את קליטת המיילים של כל הטננט — לכן אישור מפורש
          ולא לחיצה אחת. */}
      <Dialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => !open && setPendingDisconnect(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ניתוק {pendingMeta?.title ?? 'החיבור'}</DialogTitle>
            <DialogDescription>הפעולה משפיעה על כל המשתמשים בעסק</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-fg">
              {pendingDisconnect === 'GMAIL'
                ? 'מיילים נכנסים יפסיקו להפוך למשימות אוטומטית. משימות קיימות לא ייפגעו.'
                : 'קובצי PDF של חשבוניות חדשות לא יישמרו ל-Drive, והפקת חשבונית תיעצר בשלב הטיוטה.'}
            </p>
            <p className="text-xs text-fg-muted">
              כדי לחדש את החיבור יהיה צורך לעבור שוב את אישור ההרשאות של Google.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setPendingDisconnect(null)}
              disabled={disconnect.isPending}
            >
              ביטול
            </Button>
            <Button
              variant="danger"
              loading={disconnect.isPending}
              disabled={disconnect.isPending}
              onClick={() => pendingDisconnect && disconnect.mutate(pendingDisconnect)}
            >
              ניתוק
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
