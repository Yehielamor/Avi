import { haversineDistanceKm } from '../../common/geo.util';

export interface Stop {
  taskId: string;
  scheduledStart: Date | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
}

type Point = { lat: number; lng: number };
const hasPoint = <T extends Stop>(s: T): s is T & Point => s.lat !== null && s.lng !== null;

/**
 * סדר היום של טכנאי.
 *
 * עבודות עם מועד — לפי המועד, והן לא זזות: הלקוח אישר שעה. עבודות בלי מועד
 * מסודרות אחריהן לפי השכן הקרוב ביותר מהנקודה האחרונה הידועה. זה לא פתרון
 * אופטימלי לבעיית הסוכן הנוסע, אבל הוא חוסך את רוב הנסיעה המיותרת בלי API
 * של ניווט — ושום אלגוריתם לא יודע על פקק ב-Waze.
 *
 * עבודה בלי קואורדינטות לא ניתנת למיקום, ולכן היא בסוף, בסדר המקורי.
 */
export function orderStops<T extends Stop>(stops: T[], start: Point | null): T[] {
  const scheduled = stops
    .filter((s) => s.scheduledStart !== null)
    .sort((a, b) => a.scheduledStart!.getTime() - b.scheduledStart!.getTime());
  const floating = stops.filter((s) => s.scheduledStart === null);

  const located = floating.filter(hasPoint);
  const unlocated = floating.filter((s) => !hasPoint(s));

  const lastKnown = [...scheduled].reverse().find((s) => hasPoint(s));
  let here: Point | null = lastKnown && hasPoint(lastKnown) ? { lat: lastKnown.lat, lng: lastKnown.lng } : start;

  const ordered: T[] = [];
  const pool = [...located];
  while (pool.length > 0) {
    let best = 0;
    if (here) {
      let bestKm = Infinity;
      pool.forEach((s, i) => {
        const km = haversineDistanceKm(here!.lat, here!.lng, s.lat, s.lng);
        if (km < bestKm) {
          bestKm = km;
          best = i;
        }
      });
    }
    const [next] = pool.splice(best, 1);
    ordered.push(next!);
    here = { lat: next!.lat, lng: next!.lng };
  }

  return [...scheduled, ...ordered, ...unlocated];
}

/**
 * קישור ניווט ב-Waze. חינם, בלי API: פותח את האפליקציה בטלפון.
 * קואורדינטות עדיפות — כתובת חופשית בעברית מתפרשת לפעמים למקום אחר.
 */
export function wazeUrl(stop: Pick<Stop, 'lat' | 'lng' | 'address'>): string | null {
  if (stop.lat !== null && stop.lng !== null) {
    return `https://waze.com/ul?ll=${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}&navigate=yes`;
  }
  const address = stop.address?.trim();
  return address ? `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes` : null;
}
