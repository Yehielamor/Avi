# CraftMind AI — תיעוד

פלטפורמת ניהול עבודה רב-דיירית לבעלי מקצוע וקמעונאות.
מונוליט מודולרי: NestJS + TypeScript + PostgreSQL + Redis.

## מאיפה להתחיל

| אם אתה... | קרא |
|---|---|
| מצטרף לפרויקט | [00 — סקירה](00-overview.md) → [01 — ארכיטקטורה](01-architecture.md) → [05 — פיתוח מקומי](05-local-development.md) |
| כותב קוד שרת | [20 — קונבנציות שרת](20-backend-conventions.md) — **מחייב** |
| כותב קוד UI | [30 — מערכת העיצוב](30-design-system.md) — **מחייב** |
| נוגע בנתוני טננט | [03 — אבטחה ובידוד](03-security-and-multitenancy.md) — **קרא לפני שתכתוב שאילתה** |
| פורס לפרודקשן | [04 — תשתית](04-infrastructure.md) |
| רוצה להבין למה משהו בנוי כך | [90 — ADRs](adr/) |

## מצב הפרויקט

זהו שלד שעבר ביקורת מקיפה ונמצא בתהליך תיקון.
[דוח הביקורת](10-audit-findings.md) מפרט 27 ממצאים קריטיים, 47 חשובים ו-28 קלים.

**מה תוקן:**

- בידוד טננטים ברמת ה-DB — מודל שני תפקידים, `FORCE ROW LEVEL SECURITY`, קונטקסט טרנזקציוני. מאומת ב-47 בדיקות אינטגרציה מול Postgres אמיתי.
- מיגרציות אמיתיות, כולל ה-RLS עצמו. אין יותר שלב `psql` ידני.
- אימות משתני סביבה בזמן עלייה. אין ברירות מחדל לסודות.
- הקשחת נקודת הכניסה: helmet, CORS מפורש, ValidationPipe, תקרות body, graceful shutdown, health checks.
- Dockerfile רב-שלבי שרץ כמשתמש לא-root עם lockfile.
- סכימת DB: `Timestamptz`, `Decimal`, אינדקסים לצורות השאילתה בפועל, אילוצי ייחודיות שהופכים race conditions לבלתי אפשריים.

**מה עדיין פתוח:** ראו [סדר התיקון](10-audit-findings.md#סדר-התיקון).

## מפת המסמכים

```
00-overview.md                 מה המוצר עושה, לאיזה עסקים
01-architecture.md             מונוליט מודולרי, אירועים, outbox
02-data-model.md               ישויות ויחסים
03-security-and-multitenancy.md בידוד טננטים — המסמך הקריטי
04-infrastructure.md           Docker, Caddy, פריסה, רוטציית מפתחות
05-local-development.md        מדריך הרצה
06-deployment.md               פריסה: Vercel לחזית, VPS לשרת
10-audit-findings.md           דוח ביקורת מלא
20-backend-conventions.md      כללי כתיבת קוד שרת
30-design-system.md            טוקנים, RTL, נגישות, רכיבים
adr/                           החלטות ארכיטקטוניות + נימוק
```
