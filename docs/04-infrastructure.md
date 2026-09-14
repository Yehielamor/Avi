# תשתית ופריסה

## הרכב

```
Caddy   :80 :443      המאזין הציבורי היחיד. תעודת wildcard, כותרות אבטחה.
  └── app :3000       NestJS. ללא מיפוי פורט החוצה.
        ├── postgres  לא חשוף. שני תפקידים.
        └── redis     לא חשוף. AOF, תורי BullMQ.
      metabase        profile "bi" — כבוי כברירת מחדל.
```

**רק ל-Caddy יש `ports`.** לכל השאר יש רק את הרשת הפנימית. ה-overlay
`docker-compose.dev.yml` חושף את Postgres ל-`127.0.0.1:5433` לפיתוח — **לעולם
לא בפרודקשן.**

---

## סדר העלייה

```
postgres (healthy)  →  migrate (הושלם בהצלחה)  →  app (healthy)  →  caddy
redis    (healthy)  ↗
```

שני דברים שלא היו קודם וחשובים יותר ממה שנראה:

**`condition: service_healthy` ולא `depends_on` חשוף.** `depends_on` רגיל
ממתין לתחילת *קונטיינר*, לא למוכנות. באתחול מחדש של המארח, האפליקציה עלתה
לפני ש-Postgres קיבל חיבורים, `$connect()` זרק, Nest יצא, ו-`restart:
unless-stopped` ייצר crash-loop — השבתה של דקות בלי שום סיגנל, בזמן ש-Caddy
מחזיר 502.

**שירות `migrate` נפרד שרץ עד סיום.** קודם המיגרציות היו צעד ידני ב-README,
וה-RLS היה צעד ידני *שני*. פריסה נקייה אחת ששכחה אותם העלתה DB רב-דיירי
**ללא שום בידוד ובלי שגיאה בשום מקום.** עכשיו `prisma migrate deploy` הוא
תנאי לעליית האפליקציה, וה-RLS הוא מיגרציה גרסאית ולא קובץ `psql` נפרד.

---

## תמונת האפליקציה

`Dockerfile` רב-שלבי. מה שנשלח מכיל `dist/`, תלויות פרודקשן ו-Prisma Client — ותו לא.

| | קודם | עכשיו |
|---|---|---|
| שלבים | אחד | `deps` → `build` → `prod-deps` → `runtime` |
| משתמש | root | `node` (uid 1000) |
| התקנה | `npm install`, ללא lockfile | `npm ci --omit=dev` |
| גרסת בסיס | תג צף `node:20-alpine` | `node:22.20.0-alpine` |
| PID 1 | Node | `dumb-init` |
| בדיקת בריאות | אין | `/v1/health/live` |
| toolchain בתמונה | הכל | אין |

**למה זה משנה:** `pdf-parse` מריץ קוד מקורי על PDF שכל אדם יכול להעלות.
RCE שם היה נותן **root בתוך הקונטיינר, עם קומפיילר זמין לקפיצה הבאה**.
עכשיו זה משתמש לא מורשה בתמונה בלי כלים.

`npm ci` דורש lockfile תואם ונכשל אחרת. `npm install` פתר מחדש כל טווח `^`
בכל בנייה — שחרור patch של תלות בין שתי בניות העביר לפרודקשן עץ תלויות שונה
ממה שנבדק, בלי אימות integrity.

---

## Caddy

תעודת `*.craftmind-ai.com` דורשת **DNS-01** challenge — HTTP-01 לא יכול
לאמת בעלות על wildcard. לכן `Dockerfile.caddy` בונה עם `caddy-dns/cloudflare`.

**דרישה מוקדמת:** ה-nameservers של הדומיין מצביעים ל-Cloudflare **בפועל**.
רישום הדומיין שם אינו מספיק.

```
1. הוספת craftmind-ai.com ל-Cloudflare (חינם)
2. שינוי nameservers אצל הרשם ל-אלה של Cloudflare
3. A record: @  →  IP השרת
4. A record: *  →  IP השרת       ← זה מה שמאפשר תת-דומיין לכל טננט
5. API token עם הרשאת Zone:DNS:Edit  →  CLOUDFLARE_API_TOKEN
```

כותרות האבטחה (`HSTS`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy`) לא היו קיימות כלל. תת-דומיין של טננט היה ניתן
להטמעה ב-iframe ל-clickjacking נגד זרימת חיבור ה-OAuth.

---

## סודות

### רוטציית `INTEGRATION_ENCRYPTION_KEY`

`TenantIntegration.encryptionKeyVersion` קיים בדיוק בשביל זה. בלעדיו,
רוטציה **הורסת כל טוקן שמור** בלי מסלול שחזור.

```
1. INTEGRATION_ENCRYPTION_KEY_V2=<hex חדש>, לצד הישן
2. INTEGRATION_ENCRYPTION_KEY_VERSION=2
3. פריסה — כתיבות חדשות בגרסה 2, קריאות עדיין מפענחות גרסה 1
4. הרצת סקריפט ההצפנה מחדש
5. ודא: SELECT count(*) FROM tenant_integrations WHERE "encryptionKeyVersion" = 1  →  0
6. רק אז — הסרת המפתח הישן
```

### רוטציית `JWT_SECRET`

מנתקת את כל המשתמשים. לבצע בחלון תחזוקה.
`OAUTH_STATE_SECRET` נפרד ומתגלגל בנפרד — טוקני state חיים 10 דקות,
אז רוטציה שלו כמעט בלתי מורגשת.

### מה לא מגיע ללוגים

`app.module.ts` מגדיר `redact` על `authorization`, `cookie`, `password`,
`sessionSecret` (גם ב-query), `code`, `state` ו-`set-cookie`.
`sessionSecret` נסע ב-query string ונחת בלוגים של Caddy, בהיסטוריית הדפדפן
ובכל `Referer`.

---

## גיבוי

```bash
docker compose exec -T postgres \
  pg_dump -U postgres -Fc craftmind > craftmind-$(date +%F).dump
```

**שחזור אינו מלא בלי הסודות.** `INTEGRATION_ENCRYPTION_KEY` אינו ב-DB —
גיבוי בלעדיו משחזר טוקני OAuth שאי אפשר לפענח. גבה את `.env` בנפרד, במקום
אחר, ובדוק את השחזור בפועל.

---

## ניטור

מה שקיים:

- `/v1/health/live` — התהליך חי. לא נוגע ב-DB. כשל ⇒ אתחל את הקונטיינר.
- `/v1/health/ready` — מוכן לתעבורה. בודק DB. כשל ⇒ הוצא מה-LB, **אל תאתחל**.
- לוגים מובנים ב-JSON (pino) עם `x-request-id` מקצה לקצה.
- רוטציית לוגים: 10MB × 5 לכל שירות.

מה שחסר ונדרש לפני פרודקשן אמיתי:

- מעקב שגיאות (Sentry/OTel)
- התראה על `OutboxEvent.status = 'DEAD'` — פעולה עסקית שנכשלה סופית
- התראה על `IntegrationStatus = 'EXPIRED'` — טננט ניתק את Google ולא יודע
- התראה על שגיאת RLS (`42501`) — **תמיד באג אצלנו**, לא אצל הלקוח

---

## פתרון תקלות

| תסמין | סיבה |
|---|---|
| האפליקציה לא עולה, `Invalid environment configuration` | משתנה חסר או placeholder. ההודעה מפרטת בדיוק מה. |
| `DATABASE_URL must use the craftmind_app role` | הודבק ה-migrator כזהות זמן ריצה. זה היה מבטל את ה-RLS לחלוטין — ולכן נחסם באתחול. |
| `tenant context is not set` | שאילתה מחוץ ל-`forTenant()`. מכוון. |
| `role "craftmind_app" does not exist` | ה-volume אותחל לפני שסקריפט התפקידים נוסף. `docker compose down -v` (**מוחק נתונים**). |
| Caddy לא מנפיק תעודה | ה-nameservers לא מצביעים ל-Cloudflare, או שלטוקן אין `Zone:DNS:Edit`. |
| `migrate` נכשל והאפליקציה לא עולה | זה תקין: `service_completed_successfully` חוסם בכוונה. אפליקציה מול סכימה ישנה גרועה יותר מהשבתה. |
