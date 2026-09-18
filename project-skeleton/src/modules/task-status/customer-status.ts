import { TaskStatus } from '@prisma/client';

export type CustomerStatus = 'received' | 'scheduled' | 'on_the_way' | 'done' | 'cancelled';

/**
 * מה הלקוח רואה. נגזר, לא נשמר: אין עמודה שיכולה לצאת מסנכרון עם
 * המשימה עצמה.
 */
export function deriveCustomerStatus(task: {
  status: TaskStatus;
  scheduledStart: Date | null;
  onTheWayAt: Date | null;
}): CustomerStatus {
  if (task.status === TaskStatus.CLOSED) return 'done';
  if (task.status === TaskStatus.CANCELLED) return 'cancelled';
  if (task.onTheWayAt) return 'on_the_way';
  if (task.scheduledStart) return 'scheduled';
  return 'received';
}

/** שם פרטי בלבד. הלקוח צריך לדעת מי מגיע, לא את השם המלא (תיקון 13). */
export const firstName = (full: string | null | undefined): string | null =>
  full?.trim().split(/\s+/)[0] ?? null;

/** זמן בעברית לפי שעון ישראל, להודעת WhatsApp. */
export function formatVisit(start: Date, end: Date | null): string {
  const day = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }).format(d);
  return end ? `${day}, ${time(start)}–${time(end)}` : `${day}, ${time(start)}`;
}
