# פריסה

## מה הולך לאן

```
frontend-web/   →  Vercel        SPA סטטי. בנייה בכל push.
src/ (NestJS)   →  VPS / container host
postgres        →  לצד השרת
redis           →  לצד השרת
```

**Vercel לא יכול לארח את ה-backend.** הוא מונוליט stateful: pool חיבורים
קבוע ל-Postgres, עובדי BullMQ על Redis, ותהליכים ארוכי-חיים. Vercel הוא
serverless. ה-`docker-compose.yml` בנוי בדיוק בשביל VPS — Hostinger, Oracle
Cloud Always Free, Fly.io, Railway או Render.

---

## חזית — Vercel

### חיבור ראשוני

הפרויקט מחובר ל-`Yehielamor/Avi`. כיוון שהרפו **פרטי**, ה-GitHub App של
Vercel צריך הרשאה מפורשת אליו — אחרת הקישור נכשל בשקט.

1. https://github.com/settings/installations → **Vercel** → **Configure**
2. תחת *Repository access*, הוסף את `Avi` (או בחר *All repositories*)
3. ב-Vercel: **Add New → Project** → יבוא `Yehielamor/Avi`

### הגדרות הפרויקט

| שדה | ערך |
|---|---|
| Framework Preset | Vite |
| **Root Directory** | `project-skeleton/frontend-web` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

ה-Root Directory הוא הקריטי — בלעדיו Vercel בונה את שורש הרפו ונכשל.

### משתנה סביבה

| שם | ערך | הערה |
|---|---|---|
| `VITE_API_URL` | `https://api.craftmind-ai.com` | **בלעדיו ה-SPA יפנה לעצמו ויקבל 404 בכל קריאה.** |

הוא נקרא **בזמן בנייה**, לא בזמן ריצה — שינוי שלו דורש deploy מחדש.

`vercel.json` כבר מגדיר את ה-SPA rewrite (בלעדיו רענון ב-`/tasks` מחזיר 404),
כותרות אבטחה, ו-caching ל-assets עם hash.

### CORS

ה-API חייב להכיר את הדומיין של Vercel:

```
CORS_ORIGINS=https://craftmind-web.vercel.app,https://app.craftmind-ai.com
```

---

## שרת — VPS

```bash
git clone https://github.com/Yehielamor/Avi.git && cd Avi/project-skeleton
cp .env.example .env
```

מלא סודות אמיתיים (ראו [פיתוח מקומי](05-local-development.md)). האפליקציה
מסרבת לעלות עם placeholders.

```bash
docker compose up -d --build
```

הסדר נאכף: `postgres` בריא → `migrate` מסתיים → `app` בריא → `caddy`.
אם המיגרציה נכשלת, האפליקציה לא עולה — **בכוונה**. אפליקציה מול סכימה
ישנה גרועה יותר מהשבתה.

### לפני ה-deploy הראשון

- [ ] כל הסודות ב-`.env` אמיתיים וייחודיים
- [ ] `OAUTH_STATE_SECRET` **שונה** מ-`JWT_SECRET`
- [ ] `DATABASE_URL` משתמש ב-`craftmind_app`, **לא** ב-`craftmind_migrator`
- [ ] nameservers של הדומיין מצביעים ל-Cloudflare בפועל
- [ ] A record ל-`@` **ול-`*`** → IP השרת
- [ ] `CLOUDFLARE_API_TOKEN` עם `Zone:DNS:Edit`
- [ ] `GOOGLE_REDIRECT_URI` זהה אות-באות למה שרשום ב-Google Console
- [ ] `CORS_ORIGINS` כולל את דומיין ה-Vercel
- [ ] גיבוי ה-`.env` נשמר **בנפרד** — בלעדיו טוקני OAuth בגיבוי ה-DB אינם ניתנים לפענוח

### אימות אחרי deploy

```bash
curl -s https://craftmind-ai.com/v1/health/ready      # database: up
curl -s -o /dev/null -w '%{http_code}' https://tenant.craftmind-ai.com/v1/tasks   # 401
```

---

## מה עדיין חסר לפרודקשן אמיתי

- **אין עובד ל-outbox.** אירועים נכתבים ולא נצרכים; נשאר גשר זמני של
  `EventEmitter2`.
- **אין scheduler.** sync של Gmail לא רץ לבד — לולאת מייל→משימה אינה מאוטומטת.
- **אין מעקב שגיאות.** ראו [ניטור](04-infrastructure.md#ניטור) למה שצריך התראה.
- **הטוקן ב-`sessionStorage`.** הנכון הוא cookie מסוג `HttpOnly`.
- **אין בדיקות יחידה** — רק 47 בדיקות אינטגרציה ל-RLS.
