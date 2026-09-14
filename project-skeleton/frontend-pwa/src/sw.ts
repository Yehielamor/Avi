/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

/* ---------------------------------------------------------------------------
   Service worker.

   שתי מטרות, ושתיהן על אותו משתמש: טכנאי בשטח, על טלפון, עם קליטה
   גרועה או בלעדיה.

   1. **קליפת האפליקציה מהמטמון.** ה-precache נוצר בזמן הבנייה
      (self.__WB_MANIFEST) ומכיל את ה-HTML, ה-JS וה-CSS. האפליקציה
      נפתחת מיידית גם במרתף.

   2. **קריאה אופליין לנתוני העבודה.** GET אל /v1/tasks עובר
      network-first: כשיש רשת מקבלים טרי, וכשאין — נופלים למטמון.

   הנקודה החשובה כאן: תשובה שהוגשה מהמטמון מסומנת בכותרות
   `X-From-Cache` ו-`X-Cached-At`. בלעדיהן הממשק לא יכול להבחין בין
   נתון חי לנתון ישן, והיה מציג נתון בן שעתיים כאילו הוא עכשווי.
   זה ההבדל בין "מוצג מהזיכרון" לבין שקר שקט.

   **אין תור כתיבה אופליין.** סגירת משימה מפעילה ניכוי מלאי, שורות
   חיוב ומייל ללקוח; שידור חוזר של סגירה שנוצרה לפני שעה, על משימה
   שמנהל שינה בינתיים, דורש יישוב התנגשויות שאין לו כרגע חוזה בשרת.
   הכפתור ננעל אופליין ואומר זאת במפורש.
   --------------------------------------------------------------------------- */

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import type { WorkboxPlugin } from 'workbox-core/types';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const API_CACHE = 'craftmind-api-v1';
/** גיל מקסימלי לתשובה שמורה. מעבר לזה עדיף להודות שאין נתון. */
const API_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA: כל ניווט מקבל את index.html מה-precache. בלי זה, רענון על
// /jobs/<id> באופליין מחזיר שגיאת רשת במקום את האפליקציה.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/v1\//, /^\/api\//],
  }),
);

/**
 * מסמן תשובה שהגיעה מהמטמון, ושומר את זמן השמירה.
 *
 * הכותרות נוספות על עותק של התשובה — Response.headers של תשובה
 * שהגיעה מהרשת הוא immutable, ולכן בונים אחת חדשה סביב אותו גוף.
 */
const staleMarkerPlugin: WorkboxPlugin = {
  cacheWillUpdate: async ({ response }) => {
    if (!response || response.status !== 200) return null;
    const headers = new Headers(response.headers);
    headers.set('X-Cached-At', new Date().toISOString());
    return new Response(await response.clone().blob(), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
  cachedResponseWillBeUsed: async ({ cachedResponse }) => {
    if (!cachedResponse) return undefined;

    const cachedAt = cachedResponse.headers.get('X-Cached-At');
    // נתון ישן מדי גרוע מנתון חסר: הוא נראה תקין ומטעה בהחלטה.
    if (cachedAt && Date.now() - new Date(cachedAt).getTime() > API_MAX_AGE_MS) return null;

    const headers = new Headers(cachedResponse.headers);
    headers.set('X-From-Cache', '1');
    return new Response(await cachedResponse.clone().blob(), {
      status: cachedResponse.status,
      statusText: cachedResponse.statusText,
      headers,
    });
  },
};

// רשימת המשימות ומסך המשימה. GET בלבד — POST /tasks/:id/close
// לעולם אינו נוגע במטמון.
registerRoute(
  ({ url, request }) => request.method === 'GET' && /\/v1\/tasks(\/|\?|$)/.test(url.pathname + url.search),
  new NetworkFirst({
    cacheName: API_CACHE,
    // 8 שניות: מעבר לזה, בקליטה גרועה, עדיף להראות את הנתון השמור
    // מיד מאשר להשאיר את המסך ריק עד ל-timeout של הדפדפן.
    networkTimeoutSeconds: 8,
    plugins: [staleMarkerPlugin],
  }),
);

// גופנים — cache-first דרך NetworkFirst עם חלון קצר; הם כמעט ולא משתנים.
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new NetworkFirst({ cacheName: 'craftmind-fonts-v1', networkTimeoutSeconds: 3 }),
);

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null || !('type' in data)) return;
  const type = (data as { type: unknown }).type;

  // עדכון גרסה ללא המתנה לסגירת כל הטאבים.
  if (type === 'SKIP_WAITING') void self.skipWaiting();

  // התנתקות: הנתונים השמורים שייכים למשתמש שהתנתק. ה-Cache API
  // שורד סגירת טאב (בניגוד ל-sessionStorage שמחזיק את הטוקן), ולכן
  // בלי הניקוי הזה המשתמש הבא במכשיר היה רואה את המשימות הקודמות.
  if (type === 'CLEAR_API_CACHE') event.waitUntil(caches.delete(API_CACHE));
});

self.addEventListener('activate', () => void self.clients.claim());
