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

---

## הפריסה הפעילה (ספטמבר 2026)

| | |
|---|---|
| אתר + API | `https://craftmind-ai.com` — ה-SPA, ו-`/v1/*` מועבר לאפליקציה (מקור אחד) |
| API בלבד | `https://api.craftmind-ai.com` (אותה אפליקציה, לשימוש חיצוני) |
| שרת | DigitalOcean Droplet, FRA1, 1 vCPU / 1GB / 25GB, `164.90.161.15` |
| תיקייה | `/opt/craftmind` (`.env` בהרשאות 600, נוצר על השרת) |
| DNS | Cloudflare (חשבון amor5511): `A @`, `A www`, `A api` → IP, כולן **DNS only** |
| רשם | GoDaddy — נעילת העברה/מחיקה/עדכון פעילות, בתוקף עד 2029 |
| TLS | Caddy של המארח, Let's Encrypt, חידוש אוטומטי |
| ממשק | על השרת, `/var/www/craftmind` → symlink לגרסה ב-`/var/www/releases` |

### למה המבנה הזה

השרת מריץ כבר את `api.getdirekto.com` דרך **Caddy של המארח** על 80/443.
במקום לעצור אותו, ה-stack שלנו רץ בלי Caddy משלו (`docker-compose.host-proxy.yml`)
והאפליקציה מאזינה על `127.0.0.1:3000` בלבד. ל-Caddy של המארח נוסף בלוק אחד
(`deploy/host-caddy.snippet`).

### עדכון הממשק

```bash
project-skeleton/scripts/deploy-web.sh
```

בונה ב-`--mode selfhost` (`.env.selfhost`: `VITE_API_URL` ריק = אותו מקור), מעלה לתיקיית
גרסה חדשה ומחליף symlink. חזרה אחורה:

```bash
ssh root@164.90.161.15 'ls -1dt /var/www/releases/*'   # לבחור גרסה
ssh root@164.90.161.15 'ln -sfn /var/www/releases/<REL> /var/www/craftmind'
```

### עדכון גרסת השרת

בנייה על השרת **קורסת מחוסר זיכרון** (ליבה אחת, 1GB). בונים על מכונת פיתוח ושולחים:

```bash
cd project-skeleton
TAG=$(git rev-parse --short HEAD)
docker buildx build --platform linux/amd64 --target runtime -t craftmind-app:$TAG --load .
docker save craftmind-app:$TAG | gzip -1 | ssh root@164.90.161.15 'gunzip | docker load'
ssh root@164.90.161.15 "cd /opt/craftmind && sed -i 's/^APP_IMAGE_TAG=.*/APP_IMAGE_TAG=$TAG/' .env && \
  docker compose -f docker-compose.yml -f docker-compose.host-proxy.yml up -d"
```

המיגרציות רצות אוטומטית לפני שהאפליקציה עולה. מיגרציה שנכשלה משאירה את הגרסה הקודמת.

### קליטת מיילים (Cloudflare Email Routing)

כל עסק מקבל כתובת `<subdomain>-<אקראי>@in.craftmind-ai.com` ומגדיר אליה העברה ב-Gmail
(ADR 0001). הדואר מגיע ל-Cloudflare, ו-Worker שולח אותו חתום (HMAC) ל-`POST /v1/intake/inbound`.

הפעלה, פעם אחת:

1. **סוד משותף.** ב-`/opt/craftmind/.env`: `INBOUND_EMAIL_SECRET=$(openssl rand -hex 32)`, ואז
   `docker compose ... up -d` מחדש. בלי הסוד ה-endpoint מחזיר 503 והמסך מציג "לא הופעל".
2. **ה-Worker.**
   ```bash
   cd project-skeleton/deploy/email-worker
   npm install
   npx wrangler login
   npx wrangler secret put INBOUND_EMAIL_SECRET   # אותו ערך כמו בשרת
   npx wrangler deploy
   ```
3. **Email Routing** (דשבורד Cloudflare, הדומיין craftmind-ai.com): Email → Email Routing → הפעלה
   ל-subdomain `in` (Cloudflare מוסיף את רשומות ה-MX וה-SPF של `in.craftmind-ai.com` בעצמו) →
   Routing rules → **Catch-all** → Action: *Send to a Worker* → `craftmind-email-inbound`.
4. **בדיקה:** בהגדרות ← חיבורים מעתיקים את הכתובת, שולחים אליה מייל מכל תיבה, ובודקים שנוצרה
   משימה. `npx wrangler tail` מציג את ה-Worker בזמן אמת.

תקלות:

| מה רואים | למה |
|---|---|
| השולח מקבל "Unknown address" | הכתובת לא קיימת או הוחלפה (`rotate`) — השרת ענה 404 |
| השולח מקבל כשל זמני | השרת לא ענה 2xx (למשל למטה); Cloudflare יחזיר כשל והשרת השולח ינסה שוב |
| 401 ב-`wrangler tail` | הסוד ב-Worker שונה מזה שבשרת, או שעון השרת זז ביותר מ-5 דקות |

### גיבויים

`scripts/backup-db.sh` רץ ב-cron כל לילה ב-03:17, שומר 14 יום ב-`/opt/craftmind/backups`,
ומוודא שכל קובץ קריא (`pg_restore --list`) לפני שהוא נחשב גיבוי. יומן: `backups/backup.log`.

⚠️ **הגיבויים יושבים על אותו שרת.** אם ה-Droplet נמחק, הם נמחקים איתו. יש להפעיל
את Backups של DigitalOcean או להעתיק לאחסון חיצוני.

שחזור:

```bash
docker exec -i -e PGPASSWORD=... craftmind-postgres-1 pg_restore -U postgres -d craftmind --clean --if-exists < backups/craftmind-XXXX.dump
```
