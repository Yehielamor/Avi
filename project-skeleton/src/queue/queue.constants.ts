/**
 * שמות תורים ועבודות.
 *
 * מרוכזים כאן כי מחרוזת שגויה בצד המפרסם או הצרכן לא נכשלת — היא
 * פשוט מייצרת עבודה שאף אחד לא צורך, והיא נצברת ב-Redis בשקט.
 */

export const QUEUE = {
  /** אירועים עסקיים שנקראו מה-outbox. */
  DOMAIN_EVENTS: 'domain-events',
  /** משיכת מיילים מספקים חיצוניים. */
  INTAKE: 'intake',
} as const;

/**
 * שמות אירועים. אלה הערכים שנכתבים ל-`OutboxEvent.eventName`, ולכן
 * שינוי שלהם שובר אירועים שכבר ממתינים ב-DB.
 */
export const EVENT = {
  TASK_CREATED: 'task.created',
  TASK_CLOSED: 'task.closed',
  TASK_ASSIGNED: 'task.assigned',
  USER_INVITED: 'user.invited',
  INVENTORY_LOW_STOCK: 'inventory.low_stock',
} as const;

export type DomainEventName = (typeof EVENT)[keyof typeof EVENT];

export const JOB = {
  /** עיבוד אירוע בודד מה-outbox. */
  HANDLE_EVENT: 'handle-event',
  /** סנכרון Gmail לטננט אחד. */
  SYNC_GMAIL: 'sync-gmail',
} as const;

/**
 * מדיניות ניסיונות חוזרים.
 *
 * backoff אקספוננציאלי מ-5 שניות: 5s, 10s, 20s, 40s, 80s. אחרי חמישה
 * ניסיונות העבודה נכשלת סופית והשורה ב-outbox מסומנת DEAD — מצב
 * שדורש התראה, כי משמעותו פעולה עסקית שלא התרחשה.
 */
export const RETRY_POLICY = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  // עבודות מוצלחות לא נשמרות לנצח; כישלונות כן, כדי שיהיה מה לחקור.
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
};

export interface DomainEventJob {
  outboxEventId: string;
  tenantId: string;
  eventName: string;
  payload: unknown;
}

export interface SyncGmailJob {
  tenantId: string;
}
