import { requestCached, type Fresh } from '@/lib/api';
import { taskDetailSchema, taskListSchema, type Task, type TaskDetail } from '@/lib/schemas';

/* ---------------------------------------------------------------------------
   שליפת "המשימות שלי".

   הסינון והמיון נעשים בשרת (`assignedToMe` ו-`urgentFirst`), לא כאן.
   בגרסה קודמת נשלף עמוד אחד וסונן בקליינט — מה שהפך "אין לך משימות"
   ל-"אין לך משימות בעמוד הראשון", ומיון דחוף-קודם לנכון רק בתוך
   הפרוסה שנשלפה.

   `assignedToMe` הוא boolean ולא מזהה: הזהות נלקחת מהטוקן בשרת,
   ולכן טכנאי אינו יכול לבקש את התור של עמיתו.
   --------------------------------------------------------------------------- */
/** המקסימום ש-`ListTasksQueryDto.take` מתיר (`@Max(100)`). */
const PAGE = 100;

const OPEN: ReadonlySet<string> = new Set(['NEW', 'ASSIGNED', 'IN_PROGRESS']);

export interface MyJobs {
  open: Task[];
  closed: Task[];
  /**
   * העמוד שנשלף היה מלא — כלומר ייתכן שיש משימות נוספות של הטכנאי
   * מעבר לו, שלא נבדקו. ראו ה-TODO למעלה.
   */
  truncated: boolean;
}

export async function fetchMyJobs(_userId: string, signal?: AbortSignal): Promise<Fresh<MyJobs>> {
  // שתי קריאות ולא אחת: הפתוחות ממוינות דחוף-קודם והסגורות לפי
  // תאריך. מיון אחד לשתיהן היה קובר משימה דחופה חדשה מתחת לסגורות.
  const [openRes, closedRes] = await Promise.all([
    requestCached(`/tasks?assignedToMe=true&urgentFirst=true&take=${PAGE}`, {
      schema: taskListSchema,
      signal,
    }),
    requestCached(`/tasks?assignedToMe=true&status=CLOSED&take=20`, {
      schema: taskListSchema,
      signal,
    }),
  ]);

  const open = openRes.data.items.filter((t) => OPEN.has(t.status));
  const closed = closedRes.data.items;

  return {
    data: { open, closed, truncated: openRes.data.nextCursor != null },
    // מוצג כ"מהזיכרון" אם *אחת* מהקריאות הגיעה מהמטמון — אחרת חצי
    // מהמסך ישן והמשתמש לא יודע.
    fromCache: openRes.fromCache || closedRes.fromCache,
    cachedAt: openRes.cachedAt ?? closedRes.cachedAt,
  };
}


export function fetchJob(taskId: string, signal?: AbortSignal): Promise<Fresh<TaskDetail>> {
  return requestCached(`/tasks/${taskId}`, { schema: taskDetailSchema, signal });
}
