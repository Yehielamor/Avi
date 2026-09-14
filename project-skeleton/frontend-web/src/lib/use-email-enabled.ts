import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { request } from './api';

/**
 * האם שליחת מייל ללקוחות פעילה בפועל.
 *
 * למה זה קיים: הממשק הבטיח במספר מקומות ש"יישלח מייל ללקוח" וש"כל
 * חבר צוות יקבל הזמנה". בלי חשבון Gmail מחובר שום מייל לא נשלח —
 * המערכת מנסה, נכשלת, ורושמת לוג. הפעולה העסקית מדווחת כהצלחה.
 *
 * הבטחה שאינה מתקיימת גרועה מפיצ'ר חסר: המשתמש בונה עליה. הטקסטים
 * נגזרים עכשיו מהמצב האמיתי, ולכן הם יהפכו לנכונים מעצמם ברגע
 * שהחיבור יבוצע — בלי שאף אחד יזכור לעדכן מחרוזת.
 */
const integrationSchema = z.object({
  provider: z.enum(['GMAIL', 'DRIVE', 'OUTLOOK', 'GREEN_INVOICE']),
  status: z.enum(['CONNECTED', 'EXPIRED', 'ERROR', 'DISCONNECTED']),
});

export function useEmailEnabled(): { enabled: boolean; isLoading: boolean } {
  const q = useQuery({
    queryKey: ['integrations'],
    queryFn: ({ signal }) =>
      request('/integrations', { schema: z.array(integrationSchema), signal }),
    // המצב משתנה רק כשמישהו מחבר או מנתק — אין טעם לשאול שוב בכל מסך.
    staleTime: 5 * 60_000,
    // טכנאי שטח אינו מורשה לראות אינטגרציות ויקבל 403. אין טעם
    // לנסות שוב, וגם אין נזק: הוא לא רואה את הדיאלוגים האלה.
    retry: false,
  });

  return {
    enabled: q.data?.some((i) => i.provider === 'GMAIL' && i.status === 'CONNECTED') ?? false,
    isLoading: q.isLoading,
  };
}
