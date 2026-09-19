import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { shareResultSchema, type ShareResult } from '@/lib/schemas';

/**
 * שתי הפעולות מול הלקוח שהטכנאי עושה מהטלפון: "בדרך" ושליחת קישור מעקב.
 * שתיהן מחזירות הודעה מוכנה לוואטסאפ, שמוצגת ב-ShareDialog.
 */
export function useFieldActions(taskId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const [shared, setShared] = useState<{ result: ShareResult; title: string } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['my-day'] });
    void qc.invalidateQueries({ queryKey: ['job', taskId] });
  };
  const onError = (title: string) => (e: Error) =>
    toast.error(title, e instanceof ApiError && e.status === 409 ? 'העבודה כבר הסתיימה.' : e.message);

  const onTheWay = useMutation({
    mutationFn: () => request(`/tasks/${taskId}/on-the-way`, { method: 'POST', schema: shareResultSchema }),
    onSuccess: (result) => {
      setShared({ result, title: 'להודיע ללקוח שאתה בדרך' });
      refresh();
    },
    onError: onError('לא הצלחנו לסמן "בדרך"'),
  });

  const share = useMutation({
    mutationFn: () => request(`/tasks/${taskId}/share-link`, { method: 'POST', schema: shareResultSchema }),
    onSuccess: (result) => setShared({ result, title: 'שליחת קישור מעקב ללקוח' }),
    onError: onError('יצירת הקישור נכשלה'),
  });

  return { onTheWay, share, shared, closeShare: () => setShared(null) };
}

/**
 * לימוד מיקום הלקוח אחרי סגירת עבודה. שקט לגמרי: בלי הרשאה, בלי GPS או
 * בלי רשת — פשוט לא נשמר. זה אף פעם לא סיבה להציק לטכנאי.
 */
export function reportSiteLocation(taskId: string): void {
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      void request(`/tasks/${taskId}/site-location`, {
        method: 'POST',
        body: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy },
      }).catch(() => undefined);
    },
    () => undefined,
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
  );
}
