import { haversineDistanceKm } from './geo.util';

/**
 * מרחקים.
 *
 * הפונקציה הזו מזינה את ניקוד השיבוץ. באג כאן לא מפיל כלום —
 * הוא פשוט שולח טכנאי לקצה השני של הארץ, ואף אחד לא יבחין
 * עד שהלקוח מתקשר. לכן הבדיקות כאן נשענות על מרחקים אמיתיים
 * ועל תכונות מתמטיות, ולא על ערך שהעתקתי מהפלט של עצמי.
 */
describe('haversineDistanceKm', () => {
  const telAviv = { lat: 32.0853, lng: 34.7818 };
  const jerusalem = { lat: 31.7683, lng: 35.2137 };
  const eilat = { lat: 29.5577, lng: 34.9519 };

  it('returns zero for the same point', () => {
    expect(haversineDistanceKm(telAviv.lat, telAviv.lng, telAviv.lat, telAviv.lng)).toBe(0);
  });

  it('matches the real Tel Aviv–Jerusalem distance', () => {
    // קו אווירי אמיתי: ~54 ק"מ. סטייה גדולה מכאן פירושה
    // רדיוס שגוי או ערבוב בין lat ל-lng.
    const d = haversineDistanceKm(telAviv.lat, telAviv.lng, jerusalem.lat, jerusalem.lng);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(58);
  });

  it('matches the real Tel Aviv–Eilat distance', () => {
    // ~281 ק"מ. מרחק ארוך חושף טעויות שמרחק קצר מסתיר.
    const d = haversineDistanceKm(telAviv.lat, telAviv.lng, eilat.lat, eilat.lng);
    expect(d).toBeGreaterThan(270);
    expect(d).toBeLessThan(295);
  });

  it('is symmetric', () => {
    const there = haversineDistanceKm(telAviv.lat, telAviv.lng, eilat.lat, eilat.lng);
    const back = haversineDistanceKm(eilat.lat, eilat.lng, telAviv.lat, telAviv.lng);
    expect(back).toBeCloseTo(there, 9);
  });

  it('orders nearby above faraway', () => {
    // התכונה היחידה שהשיבוץ באמת צורך.
    const toJerusalem = haversineDistanceKm(telAviv.lat, telAviv.lng, jerusalem.lat, jerusalem.lng);
    const toEilat = haversineDistanceKm(telAviv.lat, telAviv.lng, eilat.lat, eilat.lng);
    expect(toJerusalem).toBeLessThan(toEilat);
  });

  it('handles a sign change across the equator and the prime meridian', () => {
    // קואורדינטות שליליות אינן רלוונטיות לישראל, אבל טכנאי
    // שהוזן עם lat/lng הפוכים ייפול לכאן, ואסור שנחזיר NaN.
    const d = haversineDistanceKm(-33.87, 151.21, 51.51, -0.13);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(16_000);
    expect(d).toBeLessThan(17_500);
  });

  it('stays finite at antipodal points', () => {
    // הנקודה שבה Math.sqrt(1 - a) יכול לצאת שלילי בגלל שגיאת
    // ציפה ולהחזיר NaN. atan2 שומר על זה סופי — נוודא שכך נשאר.
    const d = haversineDistanceKm(0, 0, 0, 180);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(Math.PI * 6371, 3);
  });

  it('never returns a negative distance', () => {
    const pairs: Array<[number, number, number, number]> = [
      [32.0853, 34.7818, 31.7683, 35.2137],
      [0, 0, 0, 0],
      [90, 0, -90, 0],
      [31.5, 34.75, 31.5, 34.76],
    ];
    for (const [a, b, c, d] of pairs) {
      expect(haversineDistanceKm(a, b, c, d)).toBeGreaterThanOrEqual(0);
    }
  });
});
