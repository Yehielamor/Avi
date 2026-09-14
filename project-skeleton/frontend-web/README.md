# CraftMind — חזית הניהול

React 19 + Vite + TypeScript + Tailwind v4. RTL-first.

מסמכים: [מערכת העיצוב](../../docs/30-design-system.md) · [פריסה](../../docs/06-deployment.md)

## הרצה

```bash
npm install
npm run dev     # http://localhost:5173, proxy ל-API על 3100
```

זיהוי הטננט הוא לפי subdomain, ולכן `localhost` לבדו לא ייתן טננט.
להרצה מלאה: `http://<subdomain>.craftmind-ai.localhost:5173`
(תת-דומיינים של `.localhost` נפתרים אוטומטית, בלי `/etc/hosts`).

## על `vercel.json`

**אין להוסיף מפתחות משלכם לאובייקטים שבפנים.** Vercel מאמת את הקובץ
מול סכימה ודוחה כל מפתח לא מוכר — מפתח `"comment"` בתוך `rewrites`
הפיל כל בנייה, עם שגיאה שמצביעה לתיעוד הכללי ולא לשורה.

לאימות לפני push:

```bash
curl -s https://openapi.vercel.sh/vercel.json -o /tmp/s.json
# ואז להשוות מפתחות מול /tmp/s.json
```

הקובץ בשורש הרפו הוא הקובץ הפעיל כשה-Root Directory של הפרויקט הוא
שורש הרפו. הקובץ כאן משמש כשה-Root Directory מוגדר לתיקייה הזו.
שניהם חייבים להישאר מסונכרנים.
