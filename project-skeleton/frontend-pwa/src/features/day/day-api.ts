import { requestCached, type Fresh } from '@/lib/api';
import { myDaySchema, type MyDay } from '@/lib/schemas';

/** דרך המטמון: טכנאי במרתף בלי קליטה עדיין רואה את סדר היום שנטען בבוקר. */
export function fetchMyDay(signal?: AbortSignal): Promise<Fresh<MyDay>> {
  return requestCached('/field/my-day', { schema: myDaySchema, signal });
}
