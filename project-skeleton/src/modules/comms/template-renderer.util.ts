// החלפת placeholders בסגנון {key} בתבנית מייל (ראו seed.ts:
// "שלום {customerName}, הטיפול בפנייתך הושלם..."). placeholder
// שלא סופק ערך עבורו נשאר כמו שהוא (לא נעלם בשקט) - כדי שחוסר
// בתבנית/בנתונים יבלוט בבדיקה, לא ישתתק.
export function renderTemplate(template: string, vars: Record<string, string>): string {
  // `vars[key]` הוא `string | undefined` תחת noUncheckedIndexedAccess
  // גם אחרי `key in vars` — ולכן ה-fallback מפורש ולא הצהרת טיפוס.
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}
