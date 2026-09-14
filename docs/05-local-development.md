# פיתוח מקומי

## דרישות

- Node.js ≥ 22.12 (`pdf-parse` דורש ≥22.3)
- Docker Desktop

## הרצה ראשונה

```bash
cd project-skeleton
cp .env.example .env
```

צור סודות אמיתיים — **אל תשאיר placeholders.** האפליקציה תסרב לעלות:

```bash
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('OAUTH_STATE_SECRET='+require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('INTEGRATION_ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('CRAFTMIND_APP_PASSWORD='+require('crypto').randomBytes(18).toString('base64url'))"
node -e "console.log('CRAFTMIND_MIGRATOR_PASSWORD='+require('crypto').randomBytes(18).toString('base64url'))"
node -e "console.log('POSTGRES_SUPER_PASSWORD='+require('crypto').randomBytes(18).toString('base64url'))"
```

`OAUTH_STATE_SECRET` חייב להיות **שונה** מ-`JWT_SECRET` — אימות הסביבה בודק זאת.

```bash
npm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
npm run prisma:deploy
npm run db:seed
npm run start:dev
```

- API: http://localhost:3000/v1
- OpenAPI: http://localhost:3000/docs

## בדיקות

```bash
npm run test        # יחידה
npm run test:int    # אינטגרציה — דורש Postgres רץ
npm run ci          # format + lint + typecheck + unit
```

`npm run test:int` הוא השער האמיתי: הוא מוכיח שבידוד הטננטים עובד מול DB אמיתי.

## הערות

**הפורט 5432 עשוי להיות תפוס.** ה-overlay של הפיתוח ממפה ל-**5433** כדי לא
להתנגש עם פרויקטים אחרים. בדוק עם `lsof -nP -iTCP:5433 -sTCP:LISTEN`.

**זיהוי טננט בפיתוח.** `localhost` אינו תת-דומיין, ולכן אין טננט. לבדיקת
זרימות רב-דייריות מקומית, הוסף ל-`/etc/hosts`:

```
127.0.0.1 tenant-a.craftmind-ai.localhost tenant-b.craftmind-ai.localhost
```

וקבע `BASE_DOMAIN=craftmind-ai.localhost` ב-`.env`.

## מיגרציות

```bash
npm run prisma:migrate -- --name תיאור_קצר   # יצירה + החלה (dev)
npm run prisma:deploy                        # החלה בלבד (prod)
npm run prisma:reset                         # מחיקה והרצה מחדש (מוחק נתונים!)
```

**מוסיף טבלה עם `tenantId`?** ה-RLS אינו אוטומטי. עקוב אחרי
[רשימת הבדיקה](03-security-and-multitenancy.md#רשימת-בדיקה).

## פתרון תקלות

| תסמין | סיבה |
|---|---|
| `tenant context is not set` | שאילתה מחוץ ל-`forTenant()`. זו התנהגות מכוונת — ראו [§1 בקונבנציות](20-backend-conventions.md). |
| `new row violates row-level security policy` | ה-`tenantId` בנתונים שונה מהקונטקסט. |
| `Invalid environment configuration` | משתנה חסר או placeholder. ההודעה מפרטת בדיוק מה. |
| `role "craftmind_app" does not exist` | ה-volume אותחל לפני שסקריפט התפקידים נוסף. `docker compose down -v` ואז למעלה שוב (**מוחק נתונים**). |
| `migrate dev` נכשל על shadow DB | `craftmind_shadow` לא קיים. ראו `docker/postgres/initdb/01-shadow-db.sh`. |
