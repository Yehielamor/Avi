import { useSyncExternalStore } from 'react';

/* ---------------------------------------------------------------------------
   מצב החיבור.

   `navigator.onLine` אומר "יש ממשק רשת", לא "השרת עונה" — מחובר
   לוויפיי של לקוח בלי אינטרנט הוא עדיין `true`. לכן הוא מספיק
   לכיוון אחד בלבד: **false הוא ודאי**. אין רשת, נקודה.

   מכאן שהוא משמש רק לנעילה מוקדמת של פעולות כתיבה ולתצוגת המצב.
   הכיוון השני — "יש רשת אבל השרת לא עונה" — נתפס בכישלון הבקשה
   עצמה (ApiError עם status 0), ושם מטופל.
   --------------------------------------------------------------------------- */

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // SSR/pre-render: מניחים מחובר. הנחה הפוכה הייתה מציגה הודעת
    // אופליין להרף עין בכל טעינה.
    () => true,
  );
}
