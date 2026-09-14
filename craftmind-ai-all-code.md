# CraftMind AI — כל הקוד שנכתב (קובץ מרוכז)

סה"כ 69 קבצים. לשימוש לקריאה/סקירה בלבד — להרצה בפועל להשתמש ב-`project-skeleton.zip` עם מבנה התיקיות המקורי.

---

## `.dockerignore`

```
node_modules
dist
.env
.git

```

## `.env.example`

```bash
# --- Database ---
DATABASE_URL="postgresql://app:app_password@localhost:5432/workmgmt?schema=public"

# --- App ---
PORT=3000
BASE_DOMAIN=craftmind-ai.com   # ל-tenant resolution מ-subdomain: {tenant}.craftmind-ai.com
JWT_SECRET=replace_with_long_random_string

# --- Encryption (עבור טוקני אינטגרציות ב-TenantIntegration) ---
# חובה 64 תווי hex בדיוק (32 בתים). ליצור עם:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
INTEGRATION_ENCRYPTION_KEY=replace_with_64_char_hex_string

# --- Google OAuth (Gmail + Drive connectors) ---
# ליצור ב-Google Cloud Console -> APIs & Services -> Credentials
# חשוב: GOOGLE_REDIRECT_URI חייב להיות זהה, אות-באות, למה שרשום שם.
# זה גם *חייב* להיות דומיין הבסיס הקבוע (לא tenant1.craftmind-ai.com) -
# Google לא תומך ב-wildcard redirect URIs. ראו הערה ב-google-oauth.service.ts.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://craftmind-ai.com/integrations/google/callback

# --- Cloudflare (DNS-01 challenge ל-wildcard SSL ב-Caddy, ראו Caddyfile) ---
# יוצרים ב-Cloudflare: My Profile -> API Tokens -> Create Token ->
# תבנית "Edit zone DNS", מוגבל ל-zone של craftmind-ai.com בלבד
# (לא Global API Key - זה מיותר ומסוכן יותר)
CLOUDFLARE_API_TOKEN=

# --- Web Push (VAPID) ---
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=

# --- Anthropic API (Intake Agent - LLM extraction, סעיף 6.1) ---
ANTHROPIC_API_KEY=
# ברירת מחדל: מודל זול/מהיר, מתאים ל"חילוץ קל" - לא Sonnet/Opus
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
# מודל נפרד וחזק יותר לשיחת Onboarding - חד-פעמית לכל טננט, איכות
# השיחה חשובה יותר מעלות כאן (בניגוד ל-Intake שרץ על כל מייל)
ONBOARDING_MODEL=claude-sonnet-5

```

## `Caddyfile`

```caddyfile
# ============================================================
# CraftMind AI - production Caddyfile
#
# wildcard subdomain per-tenant (tenant1.craftmind-ai.com,
# tenant2.craftmind-ai.com...) דורש DNS-01 challenge, לא HTTP-01
# הרגיל - Google/Let's Encrypt לא יכולים לאמת בעלות על *.domain
# בדרך הרגילה. לכן ה-image של caddy כאן נבנה עם תוסף
# caddy-dns/cloudflare (ראו Dockerfile.caddy), ו-CLOUDFLARE_API_TOKEN
# מגיע מ-.env.
#
# דרישה מוקדמת: הדומיין craftmind-ai.com חייב להיות עם ה-nameservers
# מצביעים ל-Cloudflare (חינמי) - לא מספיק שהוא רשום שם, ה-DNS בפועל
# צריך לעבור דרך Cloudflare כדי שהטוקן הזה יעבוד. ראו README לרצף
# המדויק (רישום ב-Cloudflare, שינוי nameservers אצל הרשם, יצירת
# A record ל-@ ו-A record ל-* שניהם מצביעים ל-IP של השרת).
# ============================================================

*.craftmind-ai.com, craftmind-ai.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }

    reverse_proxy app:3000
}

# מסך BI פנימי (Metabase) - לא per-tenant, גישה למנהל המערכת בלבד.
# כבוי כברירת מחדל (docker-compose profile "bi") - אם לא הפעלת אותו
# (ראו docker-compose.yml), הבלוק הזה פשוט לא ימצא backend ויחזיר שגיאה.
bi.craftmind-ai.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }

    reverse_proxy metabase:3000
}

```

## `Dockerfile`

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/main"]

```

## `Dockerfile.caddy`

```dockerfile
# ============================================================
# Caddy עם caddy-dns/cloudflare - נדרש כי SSL ל-wildcard
# (*.craftmind-ai.com) לא יכול להתאמת דרך HTTP-01 הרגיל, רק דרך
# DNS-01 (ראו הערה ב-Caddyfile ובמסמך הארכיטקטורה, סעיף 8).
# image רגיל של caddy:2-alpine לא כולל את התוסף הזה - בונים
# מותאם עם xcaddy.
# ============================================================

FROM caddy:2-builder-alpine AS builder

RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy

```

## `README.md`

```markdown
# CraftMind AI — שלד פרויקט (craftmind-ai.com)

מונוליט מודולרי (NestJS + TypeScript + Postgres) לפי מסמך הארכיטקטורה. שלד זה כולל את הבסיס בלבד — Tenants, Auth (חלקי), Customers, JobTypeTemplates, Tasks — כדי שתוכל להריץ, לראות שהמבנה עובד, ולהמשיך לבנות ממנו.

## מה יש כאן

```
prisma/
  schema.prisma       ← סכימת ה-DB המלאה (כל הטבלאות מסעיף db-schema.md)
  rls-policies.sql    ← RLS להרצה חד-פעמית אחרי המיגרציה הראשונה
src/
  main.ts             ← נקודת כניסה
  app.module.ts        ← ה-root module - כאן נרשמים כל מודולי ה"אג'נטים"
  common/
    tenant-context.middleware.ts  ← מזהה טננט מ-subdomain, מגדיר RLS context
  modules/
    prisma/            ← PrismaService גלובלי
    tenants/           ← ניהול טננטים
    auth/               ← login/register + JwtAuthGuard (בודק גם tenant consistency)
    customers/          ← CRUD + autocomplete ללקוחות
    job-type-templates/ ← ניהול תבניות "סוג עבודה" (סעיף 4.3 במסמך הארכיטקטורה)
    tasks/              ← ליבת ה-Task lifecycle: יצירה (ידני/מייל), סגירה, אירועים
    scheduling/         ← שיוך אוטומטי לטכנאי (skill+distance+load), ללא LLM
    integrations/       ← Connector Framework: OAuth מול Google, GmailConnector, DriveConnector
    intake/             ← "המוח": LLM extraction (Claude API) - מבין טקסט חופשי לפי JobTypeTemplate של הטננט
    invoicing/          ← מיפוי checklist→מחירון, הפקת חשבונית PDF ושמירה ב-Drive
    comms/              ← מייל אוטומטי ללקוח (קבלת פנייה/סגירה) לפי TenantConfig.emailTemplates
    inventory/          ← ניכוי מלאי אוטומטי בסגירת checklist item + התראת מלאי נמוך
    onboarding/         ← צ'אט Onboarding לעסק חדש: איסוף פרטים דרך LLM tool-use + למידה ממסמכים + יצירת טננט
docker-compose.yml     ← app + postgres + redis + metabase + caddy
Caddyfile              ← reverse proxy + wildcard SSL (tenant1.craftmind-ai.com...)
Dockerfile
.env.example
```

## איך זה מתחבר למסמך הארכיטקטורה

- **"אג'נט = מודול"** (סעיף 2): כל תיקייה תחת `src/modules/` היא אג'נט. השלד כולל כרגע Tenants/Auth/Customers/JobTypeTemplates/Tasks/**Scheduling**; **Inventory, Invoicing, Comms, Planning, Integrations** עדיין לא נבנו — ראו "השלבים הבאים" למטה.
- **תקשורת בין מודולים** דרך `EventEmitter2` (ראו `tasks.service.ts` — `this.events.emit('task.created', ...)`), לא קריאה ישירה בין services. `scheduling.service.ts` מדגים את זה בפועל: מאזין ל-`task.created` עם `@OnEvent`, ופולט בעצמו `task.assigned` בסיום — כל מודול עתידי (למשל Comms) יכול להאזין לאירועים האלה בלי לגעת בקוד הקיים.
- **Multi-tenancy**: `TenantContextMiddleware` הוא המקום היחיד שיודע על subdomains. מרגע זה, כל controller/service עובד מול `req.tenantId` בלבד.
- **RLS**: רשת ביטחון שנייה ב-DB עצמו, לא תחליף לסינון `tenantId` בקוד (שכל ה-services כאן כבר עושים במפורש).
- **שני מסלולי Intake** (סעיף 6.1): `tasks.service.ts` כולל `createManual()` ו-`createFromEmail()` — שתיהן יוצרות אותה ישות `Task`, ההבדל היחיד הוא מקור המילוי.
- **Scheduling ללא LLM** (סעיף 6.2): `scheduling.service.ts` הוא אלגוריתם ניקוד טהור (skill/distance/load), עם `requiredSkill` כ-hard filter על `JobTypeTemplate`. לא מופעל כלל אצל טננט שה-`enabledModules` שלו לא כולל `"scheduling"` (למשל קמעונאות עתידית).
- **Connector Framework** (סעיף 3): `connector.interface.ts` הוא ה-interface הגנרי; `gmail.connector.ts`/`drive.connector.ts` הם המימושים. שאר האפליקציה קוראת ל-`IntegrationsService.getConnector(tenantId, 'GMAIL')` ולא יודעת כלום על OAuth/googleapis - בדיוק כמו שתוכנן. הוספת ספק עתידי (Outlook, חשבונית ירוקה) אומרת: מימוש `Connector` חדש + שורת קוד ב-`getConnector()`, לא שינוי בשום agent אחר.
- **טוקנים מוצפנים at-rest** (סעיף 3.3): `crypto.util.ts` מצפין עם AES-256-GCM לפני כתיבה ל-`TenantIntegration`, ומפענח רק ברגע השימוש בפועל.
- **"המוח" - LLM extraction** (סעיף 6.1): `intake-extraction.service.ts` הוא הנקודה **היחידה** באפליקציה שקוראת ל-LLM (Claude Haiku - זול/מהיר, לא Sonnet/Opus). מקבל טקסט חופשי + רשימת `JobTypeTemplate` של הטננט (דינמי - לא הרדקוד לורטיקל ספציפי), ומחזיר JSON מאומת עם Zod. אם הביטחון נמוך (`shouldAutoAssignTemplate`), המשימה נוצרת בלי `jobTypeTemplateId` - "גולמית" לבדיקה ידנית, לא ניחוש. זו הממשות של העיקרון "LLM רק היכן שיש ערך אמיתי, לא בשאר ה-pipeline".
- **Invoicing - שני תפקידים נפרדים** (סעיף 6.4 + טבלה 5.1 שורות 6ג/7): `validateClosedTask` מאזין ל-`task.closed` ורק **מתריע** אם checklist item מפנה ל-priceCode שלא קיים במחירון (לא חוסם את הסגירה, רק לוג אזהרה). `generateInvoice()` היא פעולה **יזומה של מנהל** (לא אוטומטית) שמפלטרת משימות סגורות לפי לקוח+טווח תאריכים, מונעת כפל-חיוב (משימה שכבר חויבה בחשבונית קודמת לא תיכלל שוב), ומייצרת PDF בפועל דרך `DriveConnector` שכבר בנינו - ההוכחה שה-Connector Framework עובד end-to-end, לא רק ל-Gmail.
- **Comms** (סעיף 6.5 + טבלה 5.1 שורה 6א): מאזין לשני אירועים - `task.created` (רק אם `source=EMAIL`, כי פתיחה ידנית כבר כרוכה במגע ישיר עם הלקוח) ו-`task.closed` (תמיד). התבניות (`{customerName}`, `{checklistSummary}` וכו') מגיעות מ-`TenantConfig.emailTemplates` - כל טננט מגדיר את הניסוח שלו, לא קבוע בקוד. כשל שליחה (Gmail לא מחובר וכו') מתועד ומוחזר כתוצאה שלילית, לא זורק שגיאה שתפיל את שאר ה-listeners על אותו אירוע (Invoicing רץ באותו רגע בדיוק).
- **Inventory - שני מצבי עבודה על אותה טבלה** (סעיף 6.3): `handleTaskClosed` מאזין ל-`task.closed` ומנכה אוטומטית מהמלאי לפי `sku`/`qty` על checklist items שסומנו `done` (שדות נפרדים מ-`priceCode` בכוונה - לא כל שורת מחירון צורכת חלק פיזי, למשל "בדיקת גז" בסיד). `checkAvailability()` מוכן לשימוש עתידי ע"י ורטיקל הקמעונאות (matching מול הזמנה נכנסת) אבל לא מחובר בפועל עדיין - אין עדיין לקוח בורטיקל הזה (בכוונה אחרון ב-Roadmap).
- **Onboarding - הכי שונה מכל שאר המודולים**: זו הפעם היחידה שיש טבלאות (`OnboardingSession`, `OnboardingDocument`) **בלי `tenant_id` בכלל** - onboarding קורה לפני שהטננט קיים, אז אין למה לקשר. רץ על דומיין הבסיס (לא subdomain), עם `sessionSecret` במקום JWT לזיהוי (`OnboardingService.validateSession`, השוואה עם `crypto.timingSafeEqual`). השיחה עצמה (`onboarding.service.ts`) משתמשת ב-Claude עם **tool use בלבד** (`onboarding-tools.ts`) - ה-LLM אף פעם לא כותב ל-DB, רק "מסמן" עובדה מובנית (`record_company_info`, `add_team_member` וכו'), וקוד דטרמיניסטי מעדכן את ה-session. יצירת הטננט בפועל (`onboarding-finalize.service.ts`) קורית **רק** דרך endpoint נפרד שדורש אישור אנושי מפורש - גם אם ה-LLM כבר קרא ל-`ready_to_finalize`. מודל: `ONBOARDING_MODEL` נפרד (Sonnet, לא Haiku) - שיחה חד-פעמית איכותית מצדיקה מודל חזק יותר, בניגוד ל-Intake התדיר. הלמידה מהמסמכים (`document-learning.service.ts`) מחלצת שורות פריטים+מחירים מ-PDF (עם `pdf-parse`) ומחשבת הערכת markup **גסה** (יחס ממוצעים, לא התאמת פריט-מול-פריט) - נקודת פתיחה למנהל לעיין בה, לא מספר סופי.

## הרצה מקומית

```bash
cp .env.example .env
# ערוך את .env - לפחות DATABASE_URL, BASE_DOMAIN, JWT_SECRET

npm install
npx prisma generate
npx prisma migrate dev --name init
psql "$DATABASE_URL" -f prisma/rls-policies.sql   # חד-פעמי
npx prisma db seed                                 # יוצר טננט לדוגמה + משתמשים

npm run start:dev
```

לאחר ה-seed, יש לך טננט `ac-maintenance` עם:
- משתמש OWNER: `owner@ac-maintenance.example` / `changeme123`
- משתמש FIELD (טכנאי): `tech1@ac-maintenance.example` / `changeme123`
- תבנית עבודה "התקנת מזגן" עם מחירון מלא ומלאי מקושר (יחידות פנימיות/חיצוניות, פילטרים)

**בדיקה מהירה** (מקומית, בלי DNS אמיתי — ראו "בדיקה מקומית" למטה):
```bash
curl -X POST http://ac-maintenance.localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@ac-maintenance.example","password":"changeme123"}'
# מחזיר accessToken - השתמש בו בבקשות הבאות:
curl http://ac-maintenance.localhost:3000/job-type-templates \
  -H "Authorization: Bearer <ACCESS_TOKEN>"

# יצירת משימה ידנית ("אני רוצה התקנת מזגן") - מפעילה אוטומטית Scheduling
curl -X POST http://ac-maintenance.localhost:3000/tasks/manual \
  -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" \
  -d '{"customerId":"<CUSTOMER_ID>","jobTypeTemplateId":"seed-ac-install-template","title":"התקנת מזגן - יוסי כהן"}'
# בדוק: GET /tasks - אמור להופיע עם status=ASSIGNED ו-assignedToUserId מוגדר
# (הטכנאי היחיד מה-seed, tech1, כי יש לו את הסקיל "מזגנים")
```

## הגדרת Google OAuth (Gmail + Drive) ובדיקה מקומית

לפני שאפשר לחבר Gmail/Drive, צריך פרויקט ב-Google Cloud Console:

1. היכנס ל-[console.cloud.google.com](https://console.cloud.google.com), צור פרויקט חדש
2. הפעל שתי APIs: **Gmail API** ו-**Google Drive API** (תחת "APIs & Services" → "Library")
3. הגדר "OAuth consent screen" — סוג External, ובזמן שהאפליקציה במצב Testing, הוסף את חשבון הג'ימייל שלך תחת "Test users" (אחרת Google יחסום את ההתחברות)
4. תחת "Credentials" → "Create Credentials" → "OAuth client ID", סוג **Web application**
5. **חשוב**: תחת "Authorized redirect URIs" הוסף **שתי** כתובות:
   - `https://craftmind-ai.com/integrations/google/callback` (לפרודקשן, לפי הדומיין האמיתי שלך)
   - `http://localhost:3000/integrations/google/callback` (Google מאפשר `http://localhost` כחריג לבדיקות מקומיות)
6. העתק את ה-Client ID וה-Client Secret ל-`.env` שלך (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)

**לבדיקה מקומית**, הגדר ב-`.env`:
```
BASE_DOMAIN=localhost:3000
GOOGLE_REDIRECT_URI=http://localhost:3000/integrations/google/callback
```

ואז בטרמינל (אחרי login כמו קודם, עם ACCESS_TOKEN):
```bash
# שלב 1: קבלת קישור החיבור
curl http://ac-maintenance.localhost:3000/integrations/google/connect \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
# מחזיר { "authUrl": "https://accounts.google.com/o/oauth2/..." }
# פתח את ה-authUrl בדפדפן, אשר גישה עם חשבון הבדיקה שהגדרת בשלב 3 למעלה

# שלב 2: אחרי אישור, Google יפנה אוטומטית ל-callback שלנו וישמור טוקנים
# בדוק שזה עבד:
curl http://ac-maintenance.localhost:3000/integrations \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
# אמור להראות GMAIL ו-DRIVE עם status: "CONNECTED"

# שלב 3: הלולאה המלאה - שלח לעצמך מייל לא נקרא שמזכיר "התקנת מזגן"
# ומפרט כתובת/סוג מזגן, ואז:
curl -X POST http://ac-maintenance.localhost:3000/integrations/gmail/sync \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
# מחזיר למשל:
# { "created": [{ "taskId": "...", "matchedTemplate": true, "confidence": 0.82 }], ... }
# matchedTemplate=true אומר שה-LLM זיהה את "התקנת מזגן" בביטחון מספיק
# וקישר את ה-Task לתבנית + מילא customFields. בדוק עם GET /tasks -
# ה-Task אמור להיות גם עם status=ASSIGNED (Scheduling רץ אוטומטית!)

# שלב 4: סגירת המשימה (מדמה טכנאי שסיים) - מפעיל validateClosedTask (Invoicing)
# וגם את ניכוי המלאי (Inventory) - sku מגיע מ-defaultChecklist של התבנית ב-seed
curl -X POST http://ac-maintenance.localhost:3000/tasks/<TASK_ID>/close \
  -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" \
  -d '{"checklist":[{"label":"התקנת יחידה פנימית","done":true,"priceCode":"AC-INSTALL-INDOOR","sku":"AC-INDOOR-UNIT","qty":1},{"label":"התקנת יחידה חיצונית","done":true,"priceCode":"AC-INSTALL-OUTDOOR","sku":"AC-OUTDOOR-UNIT","qty":1},{"label":"בדיקת גז ותפקוד","done":true,"priceCode":"AC-GAS-CHECK"}]}'

# שלב 5: הפקת חשבונית חודשית (פעולה יזומה של מנהל)
curl -X POST http://ac-maintenance.localhost:3000/invoices/generate \
  -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" \
  -d '{"customerId":"<CUSTOMER_ID>","periodStart":"2026-01-01","periodEnd":"2026-12-31"}'
# מחזיר Invoice עם status="FINALIZED" ו-pdfDriveFileId - קובץ PDF אמיתי
# יושב עכשיו ב-Drive של הטננט. total אמור להיות 350+450+120=920
```

**בדיקת Comms**: אחרי שלב 4 (סגירת המשימה) למעלה, אם ל-Gmail יש חיבור פעיל, אמור להישלח אוטומטית מייל ללקוח עם תוכן מה-`taskClosed` template מה-seed. אם רוצים לשלוח שוב ידנית (למשל כדי לבדוק בלי לסגור משימה חדשה):
```bash
curl -X POST http://ac-maintenance.localhost:3000/comms/tasks/<TASK_ID>/resend-closed-email \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

**בדיקת Inventory**: אחרי סגירת המשימה בשלב 4 למעלה (עם checklist שכולל את שני הפריטים עם sku מה-seed), המלאי אמור לרדת אוטומטית:
```bash
curl http://ac-maintenance.localhost:3000/inventory \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
# AC-INDOOR-UNIT ו-AC-OUTDOOR-UNIT אמורים לרדת מ-8 ל-7 (qty=1 כל אחד)

# בדיקת restock ידני + התראת מלאי נמוך:
curl -X PATCH http://ac-maintenance.localhost:3000/inventory/<ITEM_ID>/adjust \
  -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" \
  -d '{"delta": -6}'
curl http://ac-maintenance.localhost:3000/inventory/low-stock \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
# אמור להראות את הפריט (threshold=2, אחרי הורדה של 6 מתוך 8 נשארו 2)
```

**בדיקת Onboarding** (רץ על דומיין הבסיס, לא tenant subdomain - אין subdomain עדיין בשלב הזה):
```bash
# שלב 1: התחלת שיחה - אין צורך ב-Authorization בכלל, זה לפני שיש טננט/משתמש
curl -X POST http://localhost:3000/onboarding/start
# מחזיר { "sessionId": "...", "sessionSecret": "...", "message": "שלום! אני כאן..." }
# שמור את שני הערכים - הם משמשים בכל קריאה הבאה

# שלב 2: המשך שיחה - חוזרים על זה כמה פעמים, עונים בהדרגה
curl -X POST http://localhost:3000/onboarding/<SESSION_ID>/message \
  -H "Content-Type: application/json" \
  -d '{"sessionSecret":"<SESSION_SECRET>","message":"נגריית עץ טוב בע\"מ, ח.פ 123456789, נגרייה"}'
# ה-LLM אמור לקרוא ל-record_company_info מאחורי הקלעים ולשאול על אנשי הצוות

# שלב 3: מעקב אחרי מה שנאסף עד כה (בלי לחכות לסיום הצ'אט)
curl "http://localhost:3000/onboarding/<SESSION_ID>/summary?sessionSecret=<SESSION_SECRET>"

# שלב 4: העלאת מסמך לדוגמה (PDF של הצעת מחיר ישנה)
curl -X POST "http://localhost:3000/onboarding/<SESSION_ID>/documents?sessionSecret=<SESSION_SECRET>&docType=QUOTE" \
  -F "file=@/path/to/quote.pdf"

# שלב 5: אחרי שהשיחה הבשילה (status="READY_TO_FINALIZE" בתשובת /message או /summary) - יצירת הטננט בפועל
curl -X POST http://localhost:3000/onboarding/<SESSION_ID>/finalize \
  -H "Content-Type: application/json" \
  -d '{"sessionSecret":"<SESSION_SECRET>"}'
# מחזיר { "subdomain": "...", "users": [{ "email", "temporaryPassword" }], "learningInsights": {...} }
# ה-subdomain החדש הוא tenant אמיתי עכשיו - אפשר להתחבר אליו כמו tenant1.localhost:3000
```

## סטטוס אימות (מה שכבר נבדק בפועל, לא רק נכתב)

- ✅ `npm install` רץ נקי (כולל `googleapis`, `pdfkit`)
- ✅ `npx tsc --noEmit` עובר ללא שגיאות
- ✅ `npx nest build` מצליח וללא אזהרות
- ⚠️ `npx prisma generate` נכשל **בסביבת הפיתוח שבה זה נכתב** (חסימת רשת לדומיין `binaries.prisma.sh`) — בסביבה שלך, עם גישת אינטרנט רגילה, זה אמור לעבוד ללא בעיה. אם זה כן נכשל אצלך, זה פתרון ידוע: `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 npx prisma generate`
- ⚠️ **ה-OAuth flow מול Google, וכן שליחת המייל בפועל דרך Gmail (Comms module), לא נבדקו חי** בסביבה שבה זה נכתב (אין גישת רשת ל-`accounts.google.com`/`googleapis.com` שם) — הקוד עבר בדיקת קומפילציה מלאה (כולל תפיסת קונפליקט טיפוסים אמיתי בין `googleapis` ל-`google-auth-library`, שתוקן), אבל הריצה בפועל מול Google לא אומתה על ידי. **תבדוק את זה בעצמך** לפי ההוראות למעלה לפני שאתה סומך על זה בפרודקשן.
- ⚠️ **קריאות ה-LLM (`intake-extraction.service.ts`, `document-learning.service.ts`, `onboarding.service.ts`) גם הן לא נבדקו חי** מאותה סיבה (אין גישת רשת ל-`api.anthropic.com` בסביבה שבה זה נכתב). מבנה ה-JSON, ה-validation עם Zod, וה-fallback לכשל API - כל אלה נכתבו בקפידה, אבל **תריץ בעצמך** בדיקה עם `ANTHROPIC_API_KEY` אמיתי לפני production. שיחת ה-tool-use ב-Onboarding (הלוגיקה המורכבת ביותר בכל הפרויקט) **חייבת** בדיקה ידנית קפדנית - זה השטח הכי "חדש" מבחינת תבנית קוד לעומת שאר המודולים.
- ✅ **יצירת ה-PDF עצמה (`pdfkit`) לא תלויה ברשת** - זו ספריה מקומית טהורה, אז זה החלק שהכי בטוח שיעבוד אצלך "כמו שנכתב". מה שכן תלוי ברשת (ולא נבדק כאן) הוא ה-upload בפועל ל-Drive באמצעות ה-connector.
- ⚠️ **חילוץ טקסט מ-PDF (`pdf-text.util.ts`, Onboarding) נבדק רק ברמת קומפילציה** - `pdf-parse` עבר שינוי API מלא בין גרסה 1 ל-2 (מ-function בודד ל-class), ותפסתי את זה כי הקוד הראשוני שכתבתי לא התקמפל בכלל מול הגרסה שהתקינה בפועל (`npm install` תמיד מביא latest). **תבדוק עם PDF אמיתי** לפני שסומכים על זה - יכול להיות שיש עוד ניואנסים ב-API שלא נתקלתי בהם (למשל PDF סרוק בלי שכבת טקסט מחזיר מחרוזת ריקה, לא שגיאה - זה מכוון, אבל כדאי לוודא שההתנהגות הזו מספיקה לך).

## הרצה עם Docker (מדמה פרודקשן)

```bash
docker compose up --build
# להפעיל גם BI (Metabase) - לא ARM64, ראו הערה למטה:
docker compose --profile bi up --build
```

הערה: שירות ה-`caddy` נבנה עכשיו מ-`Dockerfile.caddy` (לא image מוכן) כי הוא כולל את תוסף ה-DNS של Cloudflare - הבנייה הראשונה תיקח קצת יותר זמן, זה תקין.

## הגדרת DNS אמיתי — craftmind-ai.com + Cloudflare

עכשיו שיש דומיין אמיתי, הרצף המלא להפעלת wildcard SSL (`*.craftmind-ai.com`):

1. **פתח חשבון Cloudflare** (חינמי) ב-[dash.cloudflare.com](https://dash.cloudflare.com), הוסף אתר → `craftmind-ai.com`. Cloudflare יסרוק רשומות DNS קיימות (אם יש) ויציג שני nameservers.
2. **שנה nameservers אצל הרשם** שבו קנית את הדומיין (איפה שזה נרשם) - יש שם הגדרה בשם "Nameservers"/"DNS Servers", צריך להחליף לשני הכתובות שCloudflare נתן. זה **לא** מעביר את הבעלות על הדומיין, רק את ניהול ה-DNS. לוקח בין כמה דקות לכמה שעות להתעדכן (DNS propagation).
3. **ב-Cloudflare, הוסף שתי רשומות A**:
   - `@` → כתובת ה-IP הציבורית של השרת (Oracle/Hetzner)
   - `*` → אותה כתובת IP בדיוק (זה ה-wildcard שנותן ל-`tenant1.craftmind-ai.com`, `bi.craftmind-ai.com` וכו' לעבוד בלי רשומה נפרדת לכל אחד)
   - חשוב: כבה את ה-"Proxy" הכתום (ה-cloud icon) לשתי הרשומות, השאר "DNS only" - Cloudflare Proxy מפריע ל-DNS-01 challenge של Caddy מול Let's Encrypt.
4. **צור API Token** (לא Global API Key): Cloudflare → My Profile → API Tokens → Create Token → תבנית "Edit zone DNS", הגבל ל-zone של `craftmind-ai.com` בלבד. הדבק ל-`CLOUDFLARE_API_TOKEN` ב-`.env`.
5. **עדכן את Google Cloud Console** (אם כבר הגדרת OAuth client לבדיקה מקומית) - הוסף redirect URI חדש: `https://craftmind-ai.com/integrations/google/callback`, ועדכן את `GOOGLE_REDIRECT_URI` ב-`.env` בהתאם.
6. **`docker compose up --build`** - בהרצה הראשונה Caddy ינסה לאמת בעלות על הדומיין מול Let's Encrypt דרך ה-DNS-01 challenge; זה יכול לקחת דקה-שתיים. `docker compose logs -f caddy` מראה את ההתקדמות.

## פריסה על Oracle Cloud Always Free (ARM)

ראו את ההשוואה/המלצת האחסון שסיכמנו בנפרד. הערות ספציפיות לפריסה בפועל על מכונת Oracle ARM (VM.Standard.A1.Flex):

1. **חומת אש כפולה שקל לפספס**: ל-Oracle יש **שתי** שכבות חסימה נפרדות - (א) Security List ברמת ה-VCN/Subnet בקונסולת Oracle, ו-(ב) חוקי `iptables`/`netfilter` שמותקנים מראש בתוך ה-Ubuntu image עצמו. פתיחת פורטים 80/443 חייבת לקרות **בשתיים** - פתיחה רק בקונסולה לא מספיקה, ה-VM עדיין יחסום מבפנים. זו התקלה הכי נפוצה שגורמת ל"זה לא עובד ואני לא מבין למה" בפריסות ראשונות על Oracle.
   ```bash
   # בתוך ה-VM, אחרי SSH:
   sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save   # לשמור אחרי reboot
   ```
2. **Metabase לא ARM64** (ראו הערה ב-`docker-compose.yml`) - כבוי כברירת מחדל דרך Docker Compose profile. תריץ `docker compose up` רגיל (בלי `--profile bi`) ותדלג על זה בשלב הזה.
3. **בניית ה-image של האפליקציה עצמה**: `docker build` שרץ *על* מכונת ARM בונה אוטומטית image בארכיטקטורת ARM - אין צורך ב-`buildx`/פקודות מיוחדות, כי `node:20-alpine` (ה-base image שלנו) הוא multi-arch רגיל.
4. **זמינות מכונות**: אזורים כמו Frankfurt/Singapore נוטים "לתפוס" מכונת A1.Flex מהר יותר מאשר US East, לפי דיווחים עדכניים - אם ההקמה נתקעת על "Out of host capacity", כדאי לנסות אזור אחר לפני שמוותרים.
5. **המעבר ל-Hetzner בעתיד**: אותם קבצי Compose בדיוק עובדים (x86 רגיל, אין הגבלת ARM) - וגם Metabase חוזר לעבוד כרגיל בלי שינוי קוד, רק מסירים את ה-`profiles: ["bi"]` אם רוצים אותו כברירת מחדל.

## השלבים הבאים (לפי ה-Roadmap במסמך הארכיטקטורה, סעיף 9)

1. **Push אמיתי ל-Gmail** (אופציונלי): כרגע הסנכרון הוא polling ידני/יזום. Push אמיתי (`gmail.connector.ts` → `subscribe()`) דורש הקמת Google Cloud Pub/Sub topic - לא חובה ל-MVP, polling כל כמה דקות (cron) מספיק
2. **PWA לצוות שטח**: אפליקציית React נפרדת (תחת `frontend-pwa/`, כרגע ריקה) שצורכת את `/tasks` API, `/scheduling` API, ו-`/invoices` API
3. **customerAddressHint מ-extraction**: כרגע `IntakeExtractionService` מחלץ גם רמז לכתובת לקוח אבל שום דבר לא עושה בו שימוש עדיין - TODO: לעדכן את `Customer.address` אם ריק, או להציג למנהל להשוואה
4. **התראת מנהל על invoice שנתקע ב-DRAFT**: אם ה-Drive upload נכשל (`generateInvoice` תופס את זה ולא מפיל את הבקשה), החשבונית נשארת DRAFT בלי PDF - כרגע רק מתועד ב-log, כדאי גם endpoint "retry PDF generation" למשימות כאלה
5. **מייל/Push לטכנאי בשיוך** (`task.assigned`): כרגע Comms מאזין רק ל-`task.created`/`task.closed` (מול הלקוח). `task.assigned` שכבר נפלט מ-Scheduling לא מטופל עדיין - TODO: Web Push (VAPID) לטכנאי שקיבל משימה חדשה, לא מייל (ה-PWA שלו)
6. **`inventory.low_stock` לא מחובר ל-Comms**: `InventoryService` כבר פולט את האירוע הזה (ראו קוד), אבל שום דבר לא מאזין לו עדיין - TODO: להוסיף `emailTemplates.lowStock` ו-listener ב-Comms שמתריע למנהל
7. **Onboarding: אין ניקוי sessions ישנים** - `OnboardingSession` שנזנחו (משתמש שהתחיל ולא סיים) נשארים ב-DB לצמיתות. לא קריטי בהיקף MVP, אבל כדאי cron שמוחק sessions ב-`IN_PROGRESS` ישנים מ-X ימים
8. **Onboarding: אין מסך/API לעדכן learningInsights אחרי finalize** - הערכת ה-markup מוצגת פעם אחת בתשובת ה-finalize ולא נשמרת במקום קבוע שהמנהל יכול לחזור אליו - TODO: לשקול לשמור ב-TenantConfig או טבלה ייעודית
9. **Onboarding: אין דרך ל"תקן" tool call שגוי** - אם ה-LLM קרא ל-`add_price_code` עם קוד שגוי, אין endpoint לערוך/למחוק ערך שכבר נשמר ב-session לפני finalize - כרגע רק אפשר להמשיך את השיחה ולקוות שה-LLM יתקן, או לגשת ל-DB ידנית

כל מודול חדש: להוסיף תיקייה תחת `src/modules/`, ליצור `*.module.ts` + `*.service.ts` (+ `controller.ts` אם צריך API), ולרשום ב-`app.module.ts`. אין צורך לגעת במודולים קיימים כדי להוסיף חדש — זה בדיוק היתרון של המבנה הזה.

```

## `docker-compose.yml`

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    depends_on:
      - postgres
      - redis
    networks:
      - internal
    # אין ports ישיר החוצה - caddy הוא ה-reverse proxy היחיד שחשוף

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app_password
      POSTGRES_DB: workmgmt
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - internal
    # פורט 5432 נחשף רק לפיתוח מקומי - להסיר/לחסום בפרודקשן
    ports:
      - "127.0.0.1:5432:5432"

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    networks:
      - internal

  # ============================================================
  # הערה קריטית ל-ARM64 (Oracle Cloud Always Free וכו'): ה-image
  # הרשמי metabase/metabase *אינו* תומך ב-ARM64 - זו הסיבה שקיים
  # אקוסיסטם שלם של builds קהילתיים חלופיים (trevorr/metabase-arm64,
  # jungsoft/metabase ועוד). Metabase מסומן כ-profile נפרד ("bi") כך
  # שהוא *לא* עולה כברירת מחדל - `docker compose up` רגיל ידלג עליו
  # לגמרי. על מכונת ARM: השאר אותו כבוי בשלב זה (זה רק BI/דשבורדים,
  # לא ליבת המערכת), או להחליף ידנית ל-image קהילתי בסיכון שלך -
  # להפעיל את ה-BI במפורש: `docker compose --profile bi up`
  # ============================================================
  metabase:
    image: metabase/metabase:latest
    profiles: ["bi"]
    restart: unless-stopped
    depends_on:
      - postgres
    networks:
      - internal
    volumes:
      - metabase_data:/metabase-data
    environment:
      MB_DB_FILE: /metabase-data/metabase.db

  caddy:
    build:
      context: .
      dockerfile: Dockerfile.caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    environment:
      CLOUDFLARE_API_TOKEN: ${CLOUDFLARE_API_TOKEN}
    networks:
      - internal
    depends_on:
      - app

networks:
  internal:

volumes:
  postgres_data:
  metabase_data:
  caddy_data:
  caddy_config:

```

## `nest-cli.json`

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src"
}

```

## `package.json`

```json
{
  "name": "craftmind-ai",
  "version": "0.1.0",
  "description": "CraftMind AI - Multi-tenant work management platform for trades & retail (Modular Monolith, NestJS)",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio"
  },
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.124.0",
    "@nestjs/common": "^10.4.0",
    "@nestjs/config": "^3.2.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/event-emitter": "^2.0.4",
    "@nestjs/jwt": "^11.0.2",
    "@nestjs/platform-express": "^10.4.0",
    "@prisma/client": "^5.19.0",
    "bcrypt": "^6.0.0",
    "googleapis": "^178.0.0",
    "pdf-parse": "^2.4.5",
    "pdfkit": "^0.20.2",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.0",
    "@types/bcrypt": "^6.0.0",
    "@types/express": "^5.0.6",
    "@types/multer": "^2.2.0",
    "@types/node": "^22.5.0",
    "@types/pdf-parse": "^1.1.5",
    "@types/pdfkit": "^0.17.6",
    "prisma": "^5.19.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.5.4"
  }
}

```

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": false
  }
}

```

## `prisma/rls-policies.sql`

```sql
-- ============================================================
-- Row-Level Security (RLS) — בידוד טננטים ב-Postgres יחיד
-- ============================================================
-- הרעיון: כל query שהאפליקציה מריצה קודם מגדיר איזה tenant_id
-- הוא "רואה" דרך SET LOCAL, ו-Postgres עצמו חוסם כל שורה ששייכת
-- לטננט אחר - גם אם יש באג בקוד האפליקציה ששכח סינון tenant_id.
-- זו רשת ביטחון נוספת מעבר לפילטור ברמת ה-ORM, לא תחליף לו.
--
-- הרצה: psql -f rls-policies.sql (אחרי prisma migrate)
-- ============================================================

-- שלב 1: הפעלת RLS על כל טבלה שיש בה tenant_id
ALTER TABLE tenants               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_configs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_type_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_list_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items    ENABLE ROW LEVEL SECURITY; -- דרך invoice_id, ראו הערה בסוף
ALTER TABLE tenant_integrations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            ENABLE ROW LEVEL SECURITY;

-- שלב 2: policy גנרית לכל טבלה עם עמודת tenant_id ישירה
-- (invoice_line_items יטופל בנפרד כי אין לו tenant_id ישיר)

CREATE POLICY tenant_isolation ON tenants
  USING (id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation ON tenant_configs
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation ON job_type_templates
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation ON users
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation ON customers
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation ON tasks
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation ON inventory_items
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation ON price_list_items
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation ON tenant_integrations
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation ON audit_logs
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

-- invoice_line_items: אין tenant_id ישיר, הבידוד דרך ה-invoice המקושר
CREATE POLICY tenant_isolation ON invoice_line_items
  USING (
    invoice_id IN (
      SELECT id FROM invoices
      WHERE tenant_id::text = current_setting('app.current_tenant_id', true)
    )
  );

-- ============================================================
-- שימוש באפליקציה (NestJS): לפני כל query, בתוך אותה טרנזקציה/
-- connection, יש להריץ:
--
--   SET LOCAL app.current_tenant_id = '<uuid-של-הטננט-מהסאב-דומיין>';
--
-- ב-Prisma זה נעשה עם $executeRawUnsafe בתחילת כל request (middleware),
-- או דרך Prisma Client Extension שעוטף כל קריאה. מומלץ לממש כ-
-- middleware גלובלי אחד (TenantContextMiddleware) כדי לא לשכוח אותו
-- באף endpoint - ראו README בשלד הפרויקט.
--
-- טסט קריטי לכתוב ב-CI (ראו מסמך הארכיטקטורה, סעיף 8):
-- "משתמש עם current_tenant_id=A לא יכול לקרוא רשומה של tenant_id=B"
-- גם אם ה-query בקוד "שכח" WHERE tenant_id = ... - RLS חוסם ברמת ה-DB.
-- ============================================================

-- ============================================================
-- הערה מכוונת: onboarding_sessions ו-onboarding_documents *אינן*
-- מקבלות RLS - אין להן tenant_id בכלל (ראו schema.prisma, סעיף
-- Onboarding). זה תקין: onboarding קורה לפני שהטננט קיים. הבידוד
-- שם הוא ברמת האפליקציה בלבד (sessionSecret), לא ברמת ה-DB. אל
-- תוסיף RLS לטבלאות האלה בטעות מתוך הרגל - זה ישבור את ה-flow.
-- ============================================================

```

## `prisma/schema.prisma`

```prisma
// ============================================================
// Prisma Schema — מערכת ניהול עבודה Multi-Tenant
// ראו db-schema.md להסבר מלא על כל טבלה והחלטות עיצוב
// ============================================================

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ------------------------------------------------------------
// Enums
// ------------------------------------------------------------

enum Vertical {
  MAINTENANCE // חברת אחזקה (למשל: אחזקת מזגנים)
  CARPENTRY   // נגרייה
  RETAIL      // חנות קמעונאית
}

enum UserRole {
  OWNER    // בעל העסק
  MANAGER  // מנהל/פקיד משרד
  FIELD    // איש צוות שטח (טכנאי)
}

enum TaskStatus {
  NEW
  ASSIGNED
  IN_PROGRESS
  CLOSED
  CANCELLED
}

enum TaskSource {
  EMAIL  // נוצר אוטומטית ממייל נכנס (Gmail)
  MANUAL // נוצר בטופס ידני פנימי
}

enum IntegrationProvider {
  GMAIL
  DRIVE
  OUTLOOK       // מוכן לעתיד, לא בשימוש ב-MVP
  GREEN_INVOICE // מוכן לעתיד, לא בשימוש ב-MVP
}

enum IntegrationStatus {
  CONNECTED
  EXPIRED
  ERROR
  DISCONNECTED
}

enum InvoiceStatus {
  DRAFT
  FINALIZED
}

enum OnboardingStatus {
  IN_PROGRESS
  READY_TO_FINALIZE // הצ'אט הסתיים מבחינת הבוט, ממתין לאישור אנושי
  FINALIZED         // הטננט נוצר בפועל
}

enum OnboardingDocumentType {
  QUOTE           // הצעת מחיר/עבודה שהעסק נתן ללקוח בעבר
  MATERIAL_ORDER  // הזמנת חומרים/ציוד מספק
}

// ------------------------------------------------------------
// Tenant + Config
// ------------------------------------------------------------

model Tenant {
  id        String   @id @default(uuid())
  name      String
  vertical  Vertical
  subdomain String   @unique // "tenant1" -> tenant1.yourapp.com
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  config              TenantConfig?
  users               User[]
  customers           Customer[]
  jobTypeTemplates    JobTypeTemplate[]
  tasks               Task[]
  inventoryItems      InventoryItem[]
  priceListItems      PriceListItem[]
  invoices            Invoice[]
  integrations        TenantIntegration[]
  auditLogs           AuditLog[]

  @@map("tenants")
}

// אילו מודולים ("אג'נטים") פעילים לטננט הזה, עיצוב, וכללי ניתוב.
// שדה אחד JSONB במקום טבלאות נפרדות לכל הגדרה — גמיש, ולא דורש migration
// בכל פעם שרוצים להוסיף אפשרות קונפיגורציה חדשה.
model TenantConfig {
  id       String @id @default(uuid())
  tenantId String @unique
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  enabledModules Json // לדוגמה: ["intake","scheduling","inventory","invoicing","comms"]
  theme          Json // { "primaryColor": "#...", "logoUrl": "..." }
  schedulingWeights Json? // { "skillWeight":0.5, "distanceWeight":0.3, "loadWeight":0.2 } - null אם Scheduling לא מופעל
  emailTemplates Json // { "taskClosed": "...", "taskCreated": "..." }

  updatedAt DateTime @updatedAt

  @@map("tenant_configs")
}

// ------------------------------------------------------------
// JobTypeTemplate — הבסיס לטופס הידני ("אני רוצה ארון")
// ------------------------------------------------------------

model JobTypeTemplate {
  id       String @id @default(uuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  name             String // "ארון הזמנה", "התקנת מזגן"
  requiredSkill    String? // חייב להתאים ל-User.skills[] כדי שה-Scheduling Agent ישקול את המועמד בכלל (hard filter, לא soft score)
  fields           Json   // [{ key, label, type, required, options? }, ...]
  defaultPriority  Int    @default(2) // 1=דחוף, 2=רגיל, 3=נמוך
  defaultChecklist Json   // [{ label, priceCode? }, ...] - זהה למה שיוצג בסגירת המשימה
  isActive         Boolean @default(true)
  createdAt        DateTime @default(now())

  tasks Task[]

  @@index([tenantId])
  @@map("job_type_templates")
}

// ------------------------------------------------------------
// Users
// ------------------------------------------------------------

model User {
  id       String   @id @default(uuid())
  tenantId String
  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  email        String
  passwordHash String
  name         String
  role         UserRole
  isActive     Boolean  @default(true)

  // רלוונטי בעיקר ל-FIELD (טכנאי שטח) - לצורך Scheduling
  skills       String[] // ["מזגנים", "חשמל"]
  homeLat      Float?
  homeLng      Float?

  createdAt DateTime @default(now())

  assignedTasks Task[]        @relation("AssignedTasks")
  auditLogs     AuditLog[]
  connectedIntegrations TenantIntegration[]

  @@unique([tenantId, email]) // אימייל ייחודי בתוך טננט, לא גלובלית
  @@index([tenantId])
  @@map("users")
}

// ------------------------------------------------------------
// Customers
// ------------------------------------------------------------

model Customer {
  id       String @id @default(uuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  name        String
  email       String?
  phone       String?
  address     String?
  lat         Float?
  lng         Float?
  customFields Json? // שדות נוספים לפי ורטיקל (למשל "מספר דירה")

  createdAt DateTime @default(now())

  tasks    Task[]
  invoices Invoice[]

  @@index([tenantId])
  @@index([tenantId, email])
  @@map("customers")
}

// ------------------------------------------------------------
// Task — הישות המרכזית (משימת שירות / הזמנת נגרות / הזמנת קמעונאות)
// ------------------------------------------------------------

model Task {
  id       String @id @default(uuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])

  jobTypeTemplateId String?
  jobTypeTemplate   JobTypeTemplate? @relation(fields: [jobTypeTemplateId], references: [id])

  title       String
  description String?
  status      TaskStatus @default(NEW)
  priority    Int        @default(2)
  source      TaskSource

  customFields Json? // שדות דינמיים לפי JobTypeTemplate.fields או חילוץ LLM ממייל

  // מיקום העבודה (לא כתובת הלקוח בהכרח - יכול להיות שונה)
  locationLat Float?
  locationLng Float?

  assignedToUserId String?
  assignedTo       User?   @relation("AssignedTasks", fields: [assignedToUserId], references: [id])

  checklist Json? // [{ label, done: bool, priceCode?: string }, ...] - מתחיל מ-defaultChecklist של התבנית

  sourceEmailId String? // מזהה מייל Gmail המקורי, אם source=EMAIL (למעקב/דיבוג)

  createdAt DateTime  @default(now())
  closedAt  DateTime?

  invoiceLineItems InvoiceLineItem[]

  @@index([tenantId, status])
  @@index([tenantId, assignedToUserId])
  @@index([tenantId, closedAt])
  @@map("tasks")
}

// ------------------------------------------------------------
// Inventory — משמש גם בשירות שטח (תוסף) וגם בקמעונאות (ליבה)
// ------------------------------------------------------------

model InventoryItem {
  id       String @id @default(uuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  sku               String
  name              String
  quantity          Int    @default(0)
  lowStockThreshold Int    @default(5)
  unitPrice         Decimal? @db.Decimal(10, 2)
  category          String?

  updatedAt DateTime @updatedAt

  @@unique([tenantId, sku])
  @@index([tenantId])
  @@map("inventory_items")
}

// ------------------------------------------------------------
// Price List — מיפוי checklist item -> קוד מחיר (Invoicing Agent)
// ------------------------------------------------------------

model PriceListItem {
  id       String @id @default(uuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  code        String // "AC-FILTER-REPLACE"
  description String
  price       Decimal @db.Decimal(10, 2)
  isActive    Boolean @default(true)

  @@unique([tenantId, code])
  @@index([tenantId])
  @@map("price_list_items")
}

// ------------------------------------------------------------
// Invoicing — MVP: PDF פנימי, לא Green Invoice
// ------------------------------------------------------------

model Invoice {
  id       String @id @default(uuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])

  periodStart DateTime
  periodEnd   DateTime
  totalAmount Decimal  @db.Decimal(10, 2)
  status      InvoiceStatus @default(DRAFT)

  pdfDriveFileId String? // מזהה הקובץ ב-Google Drive של הטננט (סעיף 3.2 במסמך הארכיטקטורה)

  createdAt DateTime @default(now())

  lineItems InvoiceLineItem[]

  @@index([tenantId, customerId])
  @@map("invoices")
}

model InvoiceLineItem {
  id        String  @id @default(uuid())
  invoiceId String
  invoice   Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  taskId String?
  task   Task?   @relation(fields: [taskId], references: [id])

  priceCode   String
  description String
  amount      Decimal @db.Decimal(10, 2)

  @@map("invoice_line_items")
}

// ------------------------------------------------------------
// Integrations (Connector Framework - סעיף 3 במסמך הארכיטקטורה)
// ------------------------------------------------------------

model TenantIntegration {
  id       String @id @default(uuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  provider IntegrationProvider
  status   IntegrationStatus   @default(CONNECTED)

  // מוצפנים at-rest ברמת האפליקציה לפני כתיבה ל-DB (ראו db-schema.md)
  accessTokenEncrypted  String?
  refreshTokenEncrypted String?
  scopes                String[]

  connectedByUserId String?
  connectedBy       User?   @relation(fields: [connectedByUserId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([tenantId, provider])
  @@index([tenantId])
  @@map("tenant_integrations")
}

// ------------------------------------------------------------
// Audit Log
// ------------------------------------------------------------

model AuditLog {
  id       String @id @default(uuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  userId String?
  user   User?   @relation(fields: [userId], references: [id])

  action     String // "task.created", "task.closed", "integration.connected" ...
  entityType String // "Task", "Invoice" ...
  entityId   String
  metadata   Json?

  createdAt DateTime @default(now())

  @@index([tenantId, createdAt])
  @@index([tenantId, entityType, entityId])
  @@map("audit_logs")
}

// ------------------------------------------------------------
// Onboarding - הטבלאות היחידות במערכת בלי tenant_id בכלל.
// זו בכוונה: onboarding קורה *לפני* שהטננט קיים, אז אין למה לקשר.
// אבטחה: לא JWT רגיל (אין עדיין User/Tenant) - sessionSecret אקראי
// שמונפק ב-start ונדרש בכל קריאה עוקבת לאותו session (ראו
// onboarding.controller.ts). אין RLS על הטבלאות האלה - הבידוד היחיד
// הוא ידיעת ה-sessionSecret הנכון.
// ------------------------------------------------------------

model OnboardingSession {
  id            String           @id @default(uuid())
  sessionSecret String           @unique // לא JWT - טוקן פשוט שמזהה את מי שממשיך את השיחה הזו
  status        OnboardingStatus @default(IN_PROGRESS)

  // נאסף בהדרגה במהלך הצ'אט, דרך tool calls של ה-LLM (לא פרסור טקסט חופשי)
  companyInfo Json? // { legalName, businessId(ח.פ), vertical, contactEmail }
  teamMembers Json? // [{ name, email, role }]
  priceCodes  Json? // [{ code, description, defaultPrice }] - "קודי סגירה" שנדונו בצ'אט
  jobTypes    Json? // [{ name, requiredSkill?, fields, defaultChecklist }] - נגזר מהשיחה

  conversationHistory Json @default("[]") // [{ role: "user"|"assistant", content }, ...] - כל ההיסטוריה, כדי ש-Claude יקבל הקשר מלא בכל תור

  resultTenantId String? // מתמלא רק אחרי finalize בפועל

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  finalizedAt DateTime?

  documents OnboardingDocument[]

  @@map("onboarding_sessions")
}

model OnboardingDocument {
  id        String            @id @default(uuid())
  sessionId String
  session   OnboardingSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  docType      OnboardingDocumentType
  originalName String
  extractedText String? @db.Text // טקסט גולמי שחולץ מה-PDF, לפני עיבוד LLM
  extractedLineItems Json? // [{ description, amount }, ...] - תוצאת LLM extraction (ראו document-learning.service.ts)
  totalAmount Json? // מספר (מאוחסן כ-Json כדי לתמוך גם ב-null בקלות) - סכום כולל של המסמך, אם זוהה

  createdAt DateTime @default(now())

  @@index([sessionId, docType])
  @@map("onboarding_documents")
}

```

## `prisma/seed.ts`

```typescript
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ============================================================
// Seed ראשוני: טננט אחד לדוגמה - חברת אחזקת מזגנים (הלקוח האמיתי
// הראשון לפי ה-Roadmap, מסמך הארכיטקטורה סעיף 9).
//
// הרצה: npx prisma db seed  (אחרי migrate dev)
// ============================================================

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { subdomain: 'ac-maintenance' },
    update: {},
    create: {
      name: 'חברת אחזקת מזגנים לדוגמה',
      vertical: 'MAINTENANCE',
      subdomain: 'ac-maintenance',
      config: {
        create: {
          enabledModules: ['intake', 'scheduling', 'inventory', 'invoicing', 'comms'],
          theme: { primaryColor: '#2563eb', logoUrl: null },
          schedulingWeights: { skillWeight: 0.5, distanceWeight: 0.3, loadWeight: 0.2 },
          emailTemplates: {
            taskClosed: 'שלום {customerName}, הטיפול בפנייתך הושלם. פירוט: {checklistSummary}',
            taskCreated: 'שלום {customerName}, קיבלנו את פנייתך ונחזור אליך בהקדם.',
          },
        },
      },
    },
  });

  const passwordHash = await bcrypt.hash('changeme123', 12);

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'owner@ac-maintenance.example' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'owner@ac-maintenance.example',
      passwordHash,
      name: 'בעל העסק (דוגמה)',
      role: 'OWNER',
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'tech1@ac-maintenance.example' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'tech1@ac-maintenance.example',
      passwordHash,
      name: 'טכנאי לדוגמה',
      role: 'FIELD',
      skills: ['מזגנים', 'חשמל'],
      homeLat: 32.0853,
      homeLng: 34.7818,
    },
  });

  await prisma.jobTypeTemplate.upsert({
    where: { id: 'seed-ac-install-template' }, // מזהה קבוע לצורך idempotency ב-seed
    update: {},
    create: {
      id: 'seed-ac-install-template',
      tenantId: tenant.id,
      name: 'התקנת מזגן',
      requiredSkill: 'מזגנים',
      fields: [
        { key: 'address', label: 'כתובת התקנה', type: 'text', required: true },
        { key: 'ac_type', label: 'סוג מזגן', type: 'select', options: ['עילי', 'מיני מרכזי', 'מרכזי'], required: true },
        { key: 'floor', label: 'קומה', type: 'text', required: false },
      ],
      defaultPriority: 2,
      defaultChecklist: [
        { label: 'התקנת יחידה פנימית', priceCode: 'AC-INSTALL-INDOOR', sku: 'AC-INDOOR-UNIT', qty: 1 },
        { label: 'התקנת יחידה חיצונית', priceCode: 'AC-INSTALL-OUTDOOR', sku: 'AC-OUTDOOR-UNIT', qty: 1 },
        { label: 'בדיקת גז ותפקוד', priceCode: 'AC-GAS-CHECK' }, // אין sku - לא צורך חלק פיזי מהמלאי
      ],
    },
  });

  await prisma.priceListItem.createMany({
    data: [
      { tenantId: tenant.id, code: 'AC-INSTALL-INDOOR', description: 'התקנת יחידה פנימית', price: 350 },
      { tenantId: tenant.id, code: 'AC-INSTALL-OUTDOOR', description: 'התקנת יחידה חיצונית', price: 450 },
      { tenantId: tenant.id, code: 'AC-GAS-CHECK', description: 'בדיקת גז ותפקוד', price: 120 },
      { tenantId: tenant.id, code: 'AC-FILTER-REPLACE', description: 'החלפת פילטר', price: 80 },
    ],
    skipDuplicates: true,
  });

  // מלאי התחלתי - מקושר ל-sku-ים שהוגדרו ב-checklist למעלה. threshold
  // נמוך בכוונה (2) כדי שקל לבדוק את ה-low_stock alert עם כמות התקנות קטנה
  await prisma.inventoryItem.createMany({
    data: [
      { tenantId: tenant.id, sku: 'AC-INDOOR-UNIT', name: 'יחידה פנימית - מזגן עילי', quantity: 8, lowStockThreshold: 2, unitPrice: 1200 },
      { tenantId: tenant.id, sku: 'AC-OUTDOOR-UNIT', name: 'יחידה חיצונית - מזגן עילי', quantity: 8, lowStockThreshold: 2, unitPrice: 1400 },
      { tenantId: tenant.id, sku: 'AC-FILTER', name: 'פילטר החלפה סטנדרטי', quantity: 20, lowStockThreshold: 5, unitPrice: 45 },
    ],
    skipDuplicates: true,
  });

  console.log('Seed complete. Tenant subdomain:', tenant.subdomain);
  console.log('Login: owner@ac-maintenance.example / changeme123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

```

## `src/app.module.ts`

```typescript
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { PrismaModule } from './modules/prisma/prisma.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { JobTypeTemplatesModule } from './modules/job-type-templates/job-type-templates.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { IntakeModule } from './modules/intake/intake.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { CommsModule } from './modules/comms/comms.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';

import { TenantContextMiddleware } from './common/tenant-context.middleware';

// ============================================================
// זהו ה-root module של המונוליט המודולרי.
// כל "אג'נט" מהמסמך הארכיטקטוני (Intake, Scheduling, Inventory,
// Invoicing, Comms, Planning) הוא מודול NestJS עצמאי תחת src/modules/.
// מודולים מתקשרים דרך EventEmitterModule (in-process events),
// לא דרך קריאה ישירה זה לזה - ראו מסמך הארכיטקטורה, סעיף 2.
//
// שלד זה כולל את הבסיס + Scheduling. Inventory, Invoicing, Comms,
// Planning, Integrations - עדיין לא נבנו, נבנים בהמשך באותה תבנית
// בדיוק (ראו README.md).
// ============================================================

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    TenantsModule,
    AuthModule,
    CustomersModule,
    TasksModule,
    JobTypeTemplatesModule,
    SchedulingModule,
    IntegrationsModule,
    IntakeModule,
    InvoicingModule,
    CommsModule,
    InventoryModule,
    OnboardingModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // רץ על כל בקשה נכנסת: מזהה את הטננט מה-subdomain,
    // ומגדיר את app.current_tenant_id ל-RLS (ראו tenant-context.middleware.ts)
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}

```

## `src/common/crypto.util.ts`

```typescript
import * as crypto from 'crypto';

// ============================================================
// הצפנת טוקנים at-rest לפני כתיבה ל-TenantIntegration
// (מסמך הארכיטקטורה, סעיף 3.3: "טוקנים מוצפנים at-rest").
//
// AES-256-GCM: authenticated encryption - גם מצפין וגם מזהה
// שיבוש/זיוף של הנתון המוצפן (auth tag).
//
// INTEGRATION_ENCRYPTION_KEY חייב להיות מחרוזת hex של 32 בתים
// (64 תווי hex) - לייצר עם: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// ============================================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // מומלץ ל-GCM

function getKey(): Buffer {
  const keyHex = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(keyHex, 'hex');
}

// פורמט האחסון: iv:authTag:ciphertext (הכל hex, מופרד בנקודתיים)
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(stored: string): string {
  const [ivHex, authTagHex, dataHex] = stored.split(':');
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error('Invalid encrypted secret format');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

```

## `src/common/geo.util.ts`

```typescript
// חישוב מרחק בין שתי נקודות lat/lng בק"מ (נוסחת Haversine).
// מספיק מדויק לצורך ניקוד Scheduling - לא לניווט בפועל (זה תפקיד Waze).
export function haversineDistanceKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371; // רדיוס כדור הארץ בק"מ
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

```

## `src/common/tenant-context.middleware.ts`

```typescript
import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../modules/prisma/prisma.service';

// ============================================================
// המקום היחיד באפליקציה שבו "תת-דומיין -> טננט" מתורגם.
// כל שאר הקוד עובד מול request.tenantId ולא צריך לדעת כלום
// על subdomains.
//
// זרימה:
// 1. חילוץ subdomain מה-Host header (tenant1.yourapp.com -> "tenant1")
// 2. שליפת ה-Tenant המתאים מה-DB לפי subdomain
// 3. הצמדת tenant.id ל-request, לשימוש בכל controller/service בהמשך
// 4. הגדרת app.current_tenant_id ברמת ה-DB session (ל-RLS, ראו
//    prisma/rls-policies.sql) - זו רשת הביטחון השנייה, לא הראשונה
// ============================================================

declare module 'express-serve-static-core' {
  interface Request {
    tenantId?: string;
  }
}

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const host = req.headers.host || '';
    const baseDomain = process.env.BASE_DOMAIN || 'craftmind-ai.com';

    // "bi.yourapp.com" (Metabase) ומסך ניהול-על ללא טננט - לדלג
    if (host === baseDomain || host.startsWith('www.') || host.startsWith('bi.')) {
      return next();
    }

    const subdomain = host.split('.')[0];

    const tenant = await this.prisma.tenant.findUnique({
      where: { subdomain },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException(`No tenant found for subdomain "${subdomain}"`);
    }

    req.tenantId = tenant.id;

    // הגדרת קונטקסט ה-DB לבקשה הזו, ל-RLS
    // הערה לפרודקשן: עם connection pooling (PgBouncer וכו') SET רגיל
    // עלול "לדלוף" בין בקשות שחולקות connection. הפתרון הנכון לפרודקשן
    // הוא לעטוף כל controller ב-$transaction ולהשתמש ב-SET LOCAL בתוכה
    // (תקף לטרנזקציה בלבד). ב-MVP עם עומס נמוך וללא pooler חיצוני, SET
    // הרגיל מספיק - יש לשדרג לפני שמוסיפים PgBouncer.
    await this.prisma.$executeRawUnsafe(
      `SET app.current_tenant_id = '${tenant.id}'`,
    );

    next();
  }
}

```

## `src/main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server running on port ${port}`);
}
bootstrap();

```

## `src/modules/auth/auth.controller.ts`

```typescript
import { Controller, Post, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // הערה: ב-MVP register פתוח כדי לאפשר יצירת המשתמש הראשון (OWNER)
  // בכל טננט. בפרודקשן כדאי להגביל register לזמינות דרך invite/seed
  // בלבד, לא endpoint ציבורי - TODO לפני go-live.
  @Post('register')
  register(@Req() req: Request, @Body() body: { email: string; password: string; name: string; role: 'OWNER' | 'MANAGER' | 'FIELD' }) {
    return this.authService.register(req.tenantId!, body);
  }

  @Post('login')
  login(@Req() req: Request, @Body() body: { email: string; password: string }) {
    return this.authService.login(req.tenantId!, body.email, body.password);
  }
}

```

## `src/modules/auth/auth.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
        signOptions: { expiresIn: '12h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}

```

## `src/modules/auth/auth.service.ts`

```typescript
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

// ============================================================
// Auth בסיסי: hash+compare עם bcrypt, JWT חתום עם tenantId+userId+role
// בתוכו. אין session/cookie - JWT ב-Authorization header בלבד
// (מתאים גם ל-SPA וגם ל-PWA).
//
// החלטה מכוונת: ה-JWT כולל tenantId, אבל ה-source of truth לכל
// בקשה הוא עדיין TenantContextMiddleware (מה-subdomain), לא ה-JWT.
// ה-TenantGuard (בקובץ נפרד) בודק שהשניים תואמים - ראו הסבר שם.
// ============================================================

const BCRYPT_ROUNDS = 12;

export interface JwtPayload {
  sub: string;      // userId
  tenantId: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(tenantId: string, params: {
    email: string;
    password: string;
    name: string;
    role: 'OWNER' | 'MANAGER' | 'FIELD';
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: params.email } },
    });
    if (existing) throw new ConflictException('User with this email already exists for this tenant');

    const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: params.email,
        passwordHash,
        name: params.name,
        role: params.role,
      },
    });

    return this.buildAuthResponse(user);
  }

  async login(tenantId: string, email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.buildAuthResponse(user);
  }

  private buildAuthResponse(user: { id: string; tenantId: string; role: string; name: string; email: string }) {
    const payload: JwtPayload = { sub: user.id, tenantId: user.tenantId, role: user.role };
    return {
      accessToken: this.jwt.sign(payload),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }

  verifyToken(token: string): JwtPayload {
    return this.jwt.verify<JwtPayload>(token);
  }
}

```

## `src/modules/auth/jwt-auth.guard.ts`

```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

// ============================================================
// שני דברים בו-זמנית, בכוונה:
// 1. אימות ה-JWT (המשתמש הוא מי שהוא טוען שהוא)
// 2. וידוא tenant consistency: user.tenantId (מתוך ה-JWT) === req.tenantId
//    (מתוך ה-subdomain, שנקבע ב-TenantContextMiddleware)
//
// למה זה קריטי: בלי הבדיקה הזו, משתמש עם JWT תקין מ-tenant1 יכול
// תיאורטית לשלוח בקשה ל-tenant2.yourapp.com ולנסות לגשת לנתונים שם.
// RLS ב-DB יחסום את זה ברמת השורה, אבל זו הגנה נוספת ברמת האפליקציה
// שתופסת את זה מוקדם יותר, עם שגיאה ברורה יותר (403 ולא DB error מוזר).
// ============================================================

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; tenantId: string; role: string };
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice('Bearer '.length);
    const payload = this.authService.verifyToken(token); // זורק אם לא תקין/פג תוקף

    if (payload.tenantId !== req.tenantId) {
      throw new ForbiddenException('Token does not match tenant for this request');
    }

    req.user = { id: payload.sub, tenantId: payload.tenantId, role: payload.role };
    return true;
  }
}

```

## `src/modules/comms/comms.controller.ts`

```typescript
import { Controller, Post, Param, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { CommsService } from './comms.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// endpoint ידני - שימושי כשמייל אוטומטי נכשל (למשל Gmail לא היה
// מחובר ברגע הסגירה) ומנהל רוצה לנסות לשלוח שוב אחרי שתיקן את זה
@UseGuards(JwtAuthGuard)
@Controller('comms')
export class CommsController {
  constructor(private readonly commsService: CommsService) {}

  @Post('tasks/:id/resend-closed-email')
  async resend(@Req() req: Request, @Param('id') id: string) {
    const result = await this.commsService.resendClosedEmail(req.tenantId!, id);
    if (!result.sent) {
      throw new BadRequestException(result.reason ?? 'Could not send email');
    }
    return result;
  }
}

```

## `src/modules/comms/comms.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { CommsService } from './comms.service';
import { CommsController } from './comms.controller';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [AuthModule, IntegrationsModule],
  controllers: [CommsController],
  providers: [CommsService],
  exports: [CommsService],
})
export class CommsModule {}

```

## `src/modules/comms/comms.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { renderTemplate } from './template-renderer.util';

interface ChecklistItem {
  label: string;
  done: boolean;
  priceCode?: string;
}

type TemplateKey = 'taskCreated' | 'taskClosed';

export interface SendResult {
  sent: boolean;
  reason?: string;
}

// ============================================================
// Customer Comms Agent (מסמך הארכיטקטורה, סעיף 6.5 + טבלה 5.1 שורה 6א).
//
// שני triggers, שני template keys מ-TenantConfig.emailTemplates
// (ראו seed.ts):
// - task.created (רק source=EMAIL) -> "taskCreated": אישור קבלת פנייה.
//   לא נשלח על MANUAL כי פתיחה ידנית כבר כרוכה במגע ישיר עם הלקוח
//   (בעל העסק שמדבר איתו בטלפון/בחנות) - מייל אוטומטי שם מיותר.
// - task.closed (תמיד) -> "taskClosed": סיכום מה שבוצע, מתוך ה-
//   checklist בפועל, לא ניחוש.
//
// כשל שליחה (Gmail לא מחובר, טוקן פג וכו') לא זורק שגיאה שמפילה את
// שאר ה-event listeners (Invoicing כבר רץ באותו אירוע) - מתועד ומוחזר
// כתוצאה שלילית בלבד. ראו גם resendClosedEmail לניסיון חוזר ידני.
// ============================================================

@Injectable()
export class CommsService {
  private readonly logger = new Logger(CommsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  @OnEvent('task.created')
  async handleTaskCreated(payload: { tenantId: string; taskId: string; source: string }) {
    if (payload.source !== 'EMAIL') return;
    const result = await this.sendTemplateEmail(payload.tenantId, payload.taskId, 'taskCreated');
    if (!result.sent) {
      this.logger.warn(`taskCreated email not sent for task ${payload.taskId}: ${result.reason}`);
    }
  }

  @OnEvent('task.closed')
  async handleTaskClosed(payload: { tenantId: string; taskId: string }) {
    const result = await this.sendTemplateEmail(payload.tenantId, payload.taskId, 'taskClosed');
    if (!result.sent) {
      this.logger.warn(`taskClosed email not sent for task ${payload.taskId}: ${result.reason}`);
    }
  }

  // חשוף גם ל-controller לצורך "שלח שוב" ידני - אותה לוגיקה בדיוק,
  // בלי כפילות קוד בין הנתיב האוטומטי לידני
  async resendClosedEmail(tenantId: string, taskId: string): Promise<SendResult> {
    return this.sendTemplateEmail(tenantId, taskId, 'taskClosed');
  }

  private async sendTemplateEmail(
    tenantId: string,
    taskId: string,
    templateKey: TemplateKey,
  ): Promise<SendResult> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { customer: true },
    });
    if (!task) return { sent: false, reason: 'task not found' };
    if (!task.customer.email) return { sent: false, reason: 'customer has no email address on file' };

    const config = await this.prisma.tenantConfig.findUnique({ where: { tenantId } });
    const templates = (config?.emailTemplates as unknown as Record<string, string> | undefined) ?? {};
    const template = templates[templateKey];
    if (!template) {
      return { sent: false, reason: `no "${templateKey}" template configured in TenantConfig.emailTemplates` };
    }

    const checklist = (task.checklist as unknown as ChecklistItem[] | null) ?? [];
    const checklistSummary =
      checklist.filter((item) => item.done).map((item) => item.label).join(', ') || 'ללא פירוט זמין';

    const body = renderTemplate(template, {
      customerName: task.customer.name,
      checklistSummary,
      taskTitle: task.title,
    });

    try {
      const gmail = await this.integrations.getConnector(tenantId, 'GMAIL');
      await gmail.ensureAuthenticated();
      await gmail.send('message', {
        to: task.customer.email,
        subject: this.subjectFor(templateKey, task.title),
        body,
      });
      return { sent: true };
    } catch (err) {
      this.logger.error(`Failed to send "${templateKey}" email for task ${taskId}`, err);
      return { sent: false, reason: 'send failed - see server logs (likely Gmail not connected for this tenant)' };
    }
  }

  private subjectFor(templateKey: TemplateKey, taskTitle: string): string {
    return templateKey === 'taskClosed'
      ? `העבודה הושלמה: ${taskTitle}`
      : `קיבלנו את פנייתך: ${taskTitle}`;
  }
}

```

## `src/modules/comms/template-renderer.util.ts`

```typescript
// החלפת placeholders בסגנון {key} בתבנית מייל (ראו seed.ts:
// "שלום {customerName}, הטיפול בפנייתך הושלם..."). placeholder
// שלא סופק ערך עבורו נשאר כמו שהוא (לא נעלם בשקט) - כדי שחוסר
// בתבנית/בנתונים יבלוט בבדיקה, לא ישתתק.
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match));
}

```

## `src/modules/customers/customers.controller.ts`

```typescript
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  findAll(@Req() req: Request) {
    return this.customersService.findAll(req.tenantId!);
  }

  @Get('search')
  search(@Req() req: Request, @Query('q') q: string) {
    return this.customersService.search(req.tenantId!, q || '');
  }

  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    return this.customersService.findOne(req.tenantId!, id);
  }

  @Post()
  create(@Req() req: Request, @Body() body: { name: string; email?: string; phone?: string; address?: string }) {
    return this.customersService.create(req.tenantId!, body);
  }
}

```

## `src/modules/customers/customers.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}

```

## `src/modules/customers/customers.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  // חשוב: כל query כאן מסונן ב-tenantId מפורשות בקוד - RLS הוא
  // רשת ביטחון נוספת, לא תחליף לסינון הזה (מסמך הארכיטקטורה, סעיף 8).

  findAll(tenantId: string) {
    return this.prisma.customer.findMany({ where: { tenantId } });
  }

  findOne(tenantId: string, id: string) {
    return this.prisma.customer.findFirst({ where: { id, tenantId } });
  }

  create(tenantId: string, data: { name: string; email?: string; phone?: string; address?: string }) {
    return this.prisma.customer.create({ data: { ...data, tenantId } });
  }

  // autocomplete ללקוח קיים - בשימוש בטופס הידני (JobTypeTemplate flow)
  search(tenantId: string, query: string) {
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 10,
    });
  }
}

```

## `src/modules/intake/intake-extraction.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';

// ============================================================
// "המוח" - Intake Agent LLM extraction (מסמך הארכיטקטורה, סעיף 6.1).
//
// עקרון מרכזי מהמסמך: LLM רק כאן, לא בשאר ה-pipeline. הקלט הוא
// טקסט חופשי (נושא+גוף מייל), הפלט הוא JSON קשיח שממופה ל-Task:
// - איזה JobTypeTemplate של הטננט הזה (אם בכלל) מתאים לפנייה
// - ערכי השדות שהתבנית הזו מגדירה (dynamic - נגזר מ-JobTypeTemplate.fields)
// - עדיפות (1-3)
// - ציון ביטחון - מתחת לסף, לא נועלים template בכלל (המשימה נשארת
//   "גולמית" לבדיקה ידנית, ראו tasks.service.ts / integrations.controller.ts)
//
// מודל: Haiku (זול/מהיר) - מתאים בדיוק ל"חילוץ קל" כפי שהוגדר
// במסמך הארכיטקטורה, לא Sonnet/Opus שיקרים משמעותית למשימה כזו.
// ============================================================

const extractionResultSchema = z.object({
  matchedTemplateId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  extractedFields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  priority: z.number().int().min(1).max(3),
  customerAddressHint: z.string().nullable(),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

const CONFIDENCE_THRESHOLD = 0.6;

const EMPTY_RESULT: ExtractionResult = {
  matchedTemplateId: null,
  confidence: 0,
  extractedFields: {},
  priority: 2,
  customerAddressHint: null,
};

const SYSTEM_PROMPT = `אתה מסייע לחילוץ מידע מובנה מתוך פניות לקוחות שמגיעות במייל, עבור מערכת ניהול עבודה.
תפקידך: לקרוא את תוכן הפנייה, לזהות איזו מבין תבניות "סוגי העבודה" המוגדרות (אם בכלל) הכי מתאימה, ולחלץ את השדות הרלוונטיים.

חוקים קשיחים:
1. החזר אך ורק JSON תקין - בלי טקסט נוסף, בלי הסברים, בלי markdown code fences.
2. אם אף תבנית לא מתאימה בבירור, matchedTemplateId חייב להיות null, ו-confidence נמוך (מתחת ל-0.5).
3. אל תמציא ערכים לשדות שלא הוזכרו בפנייה בפועל - השאר אותם מחוץ ל-extractedFields.
4. confidence משקף עד כמה אתה בטוח בהתאמת התבנית + בערכי השדות שחילצת, לא רק אחד מהם.
5. priority: 1=דחוף (מילים כמו "דחוף", "חירום", "עכשיו"), 2=רגיל (ברירת מחדל), 3=לא דחוף.

מבנה הפלט (JSON בלבד):
{
  "matchedTemplateId": string | null,
  "confidence": number (0-1),
  "extractedFields": { [key: string]: string | number | boolean },
  "priority": number (1-3),
  "customerAddressHint": string | null
}`;

@Injectable()
export class IntakeExtractionService {
  private readonly logger = new Logger(IntakeExtractionService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.client = new Anthropic({ apiKey: this.config.get<string>('ANTHROPIC_API_KEY') });
    this.model = this.config.get<string>('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001');
  }

  async extractFromEmail(
    tenantId: string,
    email: { subject: string; bodyText: string },
  ): Promise<ExtractionResult> {
    const templates = await this.prisma.jobTypeTemplate.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, fields: true },
    });

    // אין תבניות מוגדרות לטננט הזה בכלל - אין על מה לסווג, לא שווה
    // לקרוא ל-LLM בשביל זה (חוסך עלות, תואם לעיקרון "זול קודם")
    if (templates.length === 0) {
      return EMPTY_RESULT;
    }

    const userPrompt = this.buildUserPrompt(email, templates);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        this.logger.warn('LLM response contained no text block');
        return EMPTY_RESULT;
      }

      return this.parseAndValidate(textBlock.text);
    } catch (err) {
      // כשל ב-API (רשת, rate limit וכו') לא אמור להפיל את כל הסנכרון -
      // עדיף Task גולמי לבדיקה ידנית מאשר לאבד את הפנייה לגמרי
      this.logger.error('LLM extraction call failed, falling back to manual review', err);
      return EMPTY_RESULT;
    }
  }

  // ההחלטה אם לנעול template בפועל - מופרדת מה-extraction עצמו, כך
  // שאפשר לשנות את הסף בלי לגעת בלוגיקת ה-LLM
  shouldAutoAssignTemplate(result: ExtractionResult): boolean {
    return result.matchedTemplateId !== null && result.confidence >= CONFIDENCE_THRESHOLD;
  }

  private buildUserPrompt(
    email: { subject: string; bodyText: string },
    templates: Array<{ id: string; name: string; fields: unknown }>,
  ): string {
    const templatesDescription = templates
      .map((t) => `- id: "${t.id}", name: "${t.name}", fields: ${JSON.stringify(t.fields)}`)
      .join('\n');

    return `תבניות סוגי עבודה זמינות לטננט הזה:
${templatesDescription}

פנייה שהתקבלה במייל:
נושא: ${email.subject}
תוכן: ${email.bodyText}

חלץ את המידע לפי הפורמט שהוגדר בהוראות המערכת.`;
  }

  private parseAndValidate(rawText: string): ExtractionResult {
    // הגנה בסיסית למרות ההנחיה המפורשת ב-system prompt - מודלים
    // לפעמים עוטפים JSON ב-code fences למרות בקשה מפורשת שלא
    const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      this.logger.warn(`LLM did not return valid JSON: ${cleaned.slice(0, 200)}`);
      return EMPTY_RESULT;
    }

    const result = extractionResultSchema.safeParse(parsed);
    if (!result.success) {
      this.logger.warn(`LLM JSON did not match expected schema: ${result.error.message}`);
      return EMPTY_RESULT;
    }

    return result.data;
  }
}

```

## `src/modules/intake/intake.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { IntakeExtractionService } from './intake-extraction.service';

@Module({
  providers: [IntakeExtractionService],
  exports: [IntakeExtractionService],
})
export class IntakeModule {}

```

## `src/modules/integrations/connector.interface.ts`

```typescript
// ============================================================
// Connector Interface (מסמך הארכיטקטורה, סעיף 3.1)
// כל ספק חיצוני (Gmail, Drive, ובעתיד Outlook/חשבונית ירוקה) מממש
// את אותו ה-interface. שאר האפליקציה (Intake, Comms, Invoicing
// modules) קוראת ל-IntegrationsService.getConnector(tenantId, provider)
// ולא יודעת/צריכה לדעת איזה ספק ספציפי מאחורי זה.
//
// הוספת ספק חדש = מימוש אחד של ה-interface הזה + רישום ב-registry
// (IntegrationsService) - לא שינוי בשום מודול קיים אחר.
// ============================================================

export interface Connector {
  readonly provider: string;

  // מוודא שיש טוקן תקף (מרענן access token עם refresh token אם פג תוקף).
  // נקרא לפני כל fetch/send - לא נקרא ישירות מבחוץ בדרך כלל.
  ensureAuthenticated(): Promise<void>;

  // resource הוא string חופשי לפי הקונקטור (לדוגמה Gmail: "unread_messages")
  fetch<T = unknown>(resource: string, filter?: Record<string, unknown>): Promise<T>;

  // resource לדוגמה Gmail: "message" (שליחת מייל), Drive: "file" (העלאה)
  send<T = unknown>(resource: string, payload: unknown): Promise<T>;

  // רישום ל-push notifications אם הספק תומך (Gmail API watch).
  // מחזיר מזהה subscription לצורך ניהול/ביטול בהמשך. אופציונלי -
  // קונקטורים שלא תומכים (כמו Drive ב-MVP) יכולים להחזיר null.
  subscribe?(event: string): Promise<string | null>;
}

export interface OAuthConnector extends Connector {
  getAuthUrl(state: string): string;
  handleCallback(code: string): Promise<{ accessToken: string; refreshToken: string; scopes: string[] }>;
}

```

## `src/modules/integrations/drive.connector.ts`

```typescript
import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { Connector } from './connector.interface';
import { GoogleAuthClient } from './google-oauth.service';

// ============================================================
// Drive Connector - מסמך הארכיטקטורה, סעיף 3.2.
// שימוש עיקרי ב-MVP: שמירת PDF-ים של חשבוניות (Invoicing module,
// עדיין לא נבנה) בתיקייה ייעודית בדרייב של הטננט עצמו.
//
// scope הוא drive.file בלבד (לא drive מלא) - האפליקציה רואה/עורכת
// רק קבצים שהיא עצמה יצרה, לא את כל ה-Drive של הלקוח. זו בחירת
// אבטחה מכוונת, לא מגבלה טכנית.
// ============================================================

export class DriveConnector implements Connector {
  readonly provider = 'DRIVE';
  private readonly drive: drive_v3.Drive;

  constructor(private readonly authClient: GoogleAuthClient) {
    this.drive = google.drive({ version: 'v3', auth: authClient });
  }

  async ensureAuthenticated(): Promise<void> {
    if (!this.authClient.credentials.refresh_token) {
      throw new Error('DriveConnector: no refresh_token set on auth client');
    }
  }

  async fetch<T = drive_v3.Schema$File[]>(resource: string, filter: Record<string, unknown> = {}): Promise<T> {
    if (resource !== 'files') {
      throw new Error(`DriveConnector.fetch: unsupported resource "${resource}"`);
    }
    const res = await this.drive.files.list({
      q: (filter.query as string) ?? undefined,
      fields: 'files(id, name, mimeType, webViewLink, createdTime)',
      pageSize: (filter.pageSize as number) ?? 20,
    });
    return (res.data.files ?? []) as unknown as T;
  }

  async send<T = { fileId: string; webViewLink: string | null }>(resource: string, payload: unknown): Promise<T> {
    if (resource !== 'file') {
      throw new Error(`DriveConnector.send: unsupported resource "${resource}"`);
    }
    const { name, mimeType, content, folderId } = payload as {
      name: string; mimeType: string; content: Buffer; folderId?: string;
    };

    const res = await this.drive.files.create({
      requestBody: { name, parents: folderId ? [folderId] : undefined },
      media: { mimeType, body: Readable.from(content) },
      fields: 'id, webViewLink',
    });

    return { fileId: res.data.id!, webViewLink: res.data.webViewLink ?? null } as unknown as T;
  }

  // Drive לא תומך ב-subscribe במובן הזה ב-MVP - אין push notifications
  // נדרשות ל-Invoicing (זה פעולה יזומה, לא reactive)
  async subscribe(): Promise<string | null> {
    return null;
  }
}

```

## `src/modules/integrations/email-parsing.util.ts`

```typescript
// חילוץ שם+מייל מכותרת "From" גולמית, למשל:
// 'ישראל ישראלי <israel@example.com>' -> { name: 'ישראל ישראלי', email: 'israel@example.com' }
export function parseFromHeader(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.*?)\s*<(.+?)>\s*$/);
  if (match) {
    return { name: match[1].replace(/"/g, '').trim() || match[2], email: match[2].trim() };
  }
  return { name: raw.trim(), email: raw.trim() };
}

```

## `src/modules/integrations/gmail.connector.ts`

```typescript
import { Logger } from '@nestjs/common';
import { google, gmail_v1 } from 'googleapis';
import { Connector } from './connector.interface';
import { GoogleAuthClient } from './google-oauth.service';

export interface ParsedEmail {
  gmailMessageId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  bodyText: string;
  receivedAt: Date;
}

// ============================================================
// Gmail Connector - מסמך הארכיטקטורה, סעיף 3.2.
//
// fetch('unread_messages'): שולף מיילים שלא נקראו - זה מה ש-Intake
// module (עתידי, עם LLM extraction) יקרא כדי ליצור Task-ים.
// ב-MVP הנוכחי הקריאה היא ידנית/יזומה (polling), לא push אמיתי -
// ראו הערה על watch() למטה.
//
// send('message'): שליחת מייל תשובה - ה-Comms module (עתידי) ישתמש בזה.
// ============================================================

export class GmailConnector implements Connector {
  readonly provider = 'GMAIL';
  private readonly logger = new Logger(GmailConnector.name);
  private readonly gmail: gmail_v1.Gmail;

  constructor(private readonly authClient: GoogleAuthClient) {
    this.gmail = google.gmail({ version: 'v1', auth: authClient });
  }

  async ensureAuthenticated(): Promise<void> {
    // google-auth-library מרענן access token אוטומטית ברגע שנדרש
    // (ראו google-oauth.service.ts, createAuthenticatedClient) - אין
    // צורך בבדיקה יזומה כאן, רק לוודא שיש בכלל refresh_token מוגדר.
    if (!this.authClient.credentials.refresh_token) {
      throw new Error('GmailConnector: no refresh_token set on auth client');
    }
  }

  async fetch<T = ParsedEmail[]>(resource: string, filter: Record<string, unknown> = {}): Promise<T> {
    if (resource !== 'unread_messages') {
      throw new Error(`GmailConnector.fetch: unsupported resource "${resource}"`);
    }

    const maxResults = (filter.maxResults as number) ?? 20;
    const list = await this.gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults,
    });

    const messageIds = list.data.messages ?? [];
    const emails: ParsedEmail[] = [];

    for (const { id } of messageIds) {
      if (!id) continue;
      const full = await this.gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      emails.push(this.parseMessage(full.data));
    }

    return emails as unknown as T;
  }

  async send<T = { messageId: string }>(resource: string, payload: unknown): Promise<T> {
    if (resource !== 'message') {
      throw new Error(`GmailConnector.send: unsupported resource "${resource}"`);
    }
    const { to, subject, body, threadId } = payload as { to: string; subject: string; body: string; threadId?: string };

    const raw = this.buildRawMessage(to, subject, body);
    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId },
    });

    return { messageId: res.data.id! } as unknown as T;
  }

  // ============================================================
  // push notifications אמיתיות (Gmail API watch) דורשות Google Cloud
  // Pub/Sub topic מוגדר מראש + subscription שמצביע ל-webhook שלנו.
  // זה תלוי בסביבת GCP, לא רק ב-OAuth - לכן לא ממומש כאן במלואו.
  // ב-MVP: הסנכרון הוא יזום (polling) דרך fetch('unread_messages'),
  // נקרא למשל כל כמה דקות ע"י cron/scheduler (TODO), או ידנית
  // דרך endpoint (ראו integrations.controller.ts - /gmail/sync).
  // ============================================================
  async subscribe(_event: string): Promise<string | null> {
    this.logger.warn('GmailConnector.subscribe: Gmail push (watch) requires GCP Pub/Sub setup - not implemented, using polling instead');
    return null;
  }

  private parseMessage(msg: gmail_v1.Schema$Message): ParsedEmail {
    const headers = msg.payload?.headers ?? [];
    const getHeader = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

    return {
      gmailMessageId: msg.id!,
      threadId: msg.threadId!,
      from: getHeader('From'),
      subject: getHeader('Subject'),
      snippet: msg.snippet ?? '',
      bodyText: this.extractBodyText(msg.payload),
      receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
    };
  }

  private extractBodyText(part?: gmail_v1.Schema$MessagePart): string {
    if (!part) return '';
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf8');
    }
    for (const sub of part.parts ?? []) {
      const text = this.extractBodyText(sub);
      if (text) return text;
    }
    return '';
  }

  private buildRawMessage(to: string, subject: string, body: string): string {
    const message = [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body,
    ].join('\n');

    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}

```

## `src/modules/integrations/google-oauth.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';

// ============================================================
// שכבה דקה מעל google-auth-library. שים לב: Gmail ו-Drive חולקים
// אותו OAuth client + הסכמה משולבת (scope אחד לכל השירותים) - טננט
// מחבר "חשבון Google" פעם אחת, וזה נותן גישה גם ל-Gmail וגם ל-Drive.
//
// הערה קריטית ל-redirect_uri: Google OAuth דורש URI מדויק שרשום
// מראש ב-Google Cloud Console - **לא תומך ב-wildcard subdomains**.
// המשמעות: ה-callback URL חייב להיות בדומיין הבסיס הקבוע
// (https://yourapp.com/integrations/google/callback), לא
// tenant1.yourapp.com/... כמו שאר האפליקציה. לכן איזה טננט התחיל
// את ה-flow מקודד בפרמטר ה-state (JWT קצר-מועד), לא נלקח מה-subdomain
// (ראו integrations.controller.ts - ה-callback רץ על דומיין הבסיס,
// שם TenantContextMiddleware מדלג ולא מגדיר req.tenantId).
// ============================================================

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file', // גישה רק לקבצים שהאפליקציה עצמה יצרה/פתחה - לא לכל ה-Drive
];

// טיפוס נגזר מתוך googleapis עצמה, לא מ-google-auth-library כתלות
// נפרדת. הסיבה: googleapis מכילה עותק פנימי משלה של google-auth-library
// (דרך googleapis-common), וזה גורם לקונפליקט טיפוסים אם מתקינים גם
// את google-auth-library כחבילה עצמאית - TypeScript רואה שתי מחלקות
// OAuth2Client "זהות" מבחינה מבנית אבל ממקורות import שונים, ומסרב
// להתייחס אליהן כאותו טיפוס (private field מתנגש). הפתרון: לגזור את
// הטיפוס תמיד מ-googleapis עצמה, בכל מקום בקוד - לא לערבב מקורות.
export type GoogleAuthClient = InstanceType<typeof google.auth.OAuth2>;

@Injectable()
export class GoogleOAuthService {
  constructor(private readonly config: ConfigService) {}

  private createClient() {
    return new google.auth.OAuth2(
      this.config.get<string>('GOOGLE_CLIENT_ID'),
      this.config.get<string>('GOOGLE_CLIENT_SECRET'),
      this.config.get<string>('GOOGLE_REDIRECT_URI'),
    );
  }

  buildAuthUrl(state: string): string {
    const client = this.createClient();
    return client.generateAuthUrl({
      access_type: 'offline', // חובה כדי לקבל refresh_token
      prompt: 'consent',      // מבטיח refresh_token גם אם המשתמש כבר אישר בעבר
      scope: GOOGLE_SCOPES,
      state,
    });
  }

  async exchangeCode(code: string): Promise<{ accessToken: string; refreshToken: string; scopes: string[] }> {
    const client = this.createClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        'No refresh_token returned by Google. This happens if the tenant already granted ' +
        'consent before without prompt=consent - our buildAuthUrl always sets prompt=consent ' +
        'to avoid this, but if it still happens, the fix is to revoke app access at ' +
        'https://myaccount.google.com/permissions and reconnect.',
      );
    }
    return {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token,
      scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
    };
  }

  // בונה client מאומת מוכן לשימוש, עם רענון אוטומטי של access token
  // (google-auth-library עושה refresh לבד ברגע שהטוקן פג, אם יש refresh_token).
  // onTokenRefresh נקרא כשה-library מרעננת בפועל, כדי לשמור את ה-access
  // token המעודכן (מוצפן) חזרה ל-DB - ראו integrations.service.ts.
  createAuthenticatedClient(
    tokens: { accessToken: string; refreshToken: string },
    onTokenRefresh?: (newAccessToken: string, expiryDate: number | null | undefined) => void,
  ): GoogleAuthClient {
    const client = this.createClient();
    client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (onTokenRefresh) {
      client.on('tokens', (newTokens) => {
        if (newTokens.access_token) {
          onTokenRefresh(newTokens.access_token, newTokens.expiry_date);
        }
      });
    }
    return client;
  }
}

```

## `src/modules/integrations/integrations.controller.ts`

```typescript
import { Controller, Get, Post, Delete, Param, Query, Req, Res, UseGuards, BadRequestException } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TasksService } from '../tasks/tasks.service';
import { CustomersService } from '../customers/customers.service';
import { IntakeExtractionService } from '../intake/intake-extraction.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseFromHeader } from './email-parsing.util';
import { ParsedEmail } from './gmail.connector';

interface OAuthStatePayload {
  tenantId: string;
  purpose: 'google_oauth_state';
}

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly jwt: JwtService,
    private readonly tasksService: TasksService,
    private readonly customersService: CustomersService,
    private readonly intakeExtraction: IntakeExtractionService,
    private readonly prisma: PrismaService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  listStatus(@Req() req: Request) {
    return this.integrationsService.listStatus(req.tenantId!);
  }

  // רץ על תת-הדומיין של הטננט (יש req.tenantId, כי JwtAuthGuard כבר
  // אימת גם את זה). מקודד את tenantId ב-state כי ה-callback (למטה)
  // רץ על דומיין הבסיס הקבוע ולא יידע את זה מה-subdomain.
  @UseGuards(JwtAuthGuard)
  @Get('google/connect')
  connectGoogle(@Req() req: Request) {
    const state = this.jwt.sign(
      { tenantId: req.tenantId!, purpose: 'google_oauth_state' } as OAuthStatePayload,
      { expiresIn: '10m' },
    );
    return { authUrl: this.integrationsService.buildGoogleAuthUrl(state) };
  }

  // Google מפנה לכאן לפי GOOGLE_REDIRECT_URI - **חייב להיות דומיין
  // בסיס קבוע** (לא tenant1.yourapp.com), ולכן אין כאן req.tenantId
  // מה-middleware - התננט מגיע מפענוח ה-state בלבד. אין UseGuards כאן
  // בכוונה: זו קריאה שמגיעה ישירות מ-Google, לא מהמשתמש המחובר שלנו.
  @Get('google/callback')
  async googleCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    if (!code || !state) throw new BadRequestException('Missing code or state');

    let payload: OAuthStatePayload;
    try {
      payload = this.jwt.verify<OAuthStatePayload>(state);
    } catch {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
    if (payload.purpose !== 'google_oauth_state') {
      throw new BadRequestException('Invalid state payload');
    }

    await this.integrationsService.handleGoogleCallback(payload.tenantId, code);

    const tenant = await this.prisma.tenant.findUnique({ where: { id: payload.tenantId } });
    const baseDomain = process.env.BASE_DOMAIN ?? 'craftmind-ai.com';
    // הפניה חזרה למסך הניהול של הטננט אחרי חיבור מוצלח
    return res.redirect(`https://${tenant?.subdomain}.${baseDomain}/settings/integrations?connected=google`);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':provider')
  disconnect(@Req() req: Request, @Param('provider') provider: 'GMAIL' | 'DRIVE') {
    return this.integrationsService.disconnect(req.tenantId!, provider);
  }

  // ============================================================
  // סנכרון ידני/יזום - לא push אמיתי (ראו הערה ב-gmail.connector.ts
  // על watch()). ב-production זה ירוץ ב-cron (למשל כל 2-5 דקות) -
  // ה-endpoint הזה בעצם *הוא* מה שה-cron יקרא, פשוט חשוף גם ידנית
  // לצורך בדיקה/דיבוג ב-MVP.
  //
  // כולל עכשיו LLM extraction (IntakeExtractionService) - "המוח"
  // שמבין את תוכן הפנייה. אם הביטחון נמוך מדי (ראו shouldAutoAssignTemplate),
  // המשימה עדיין נוצרת אבל בלי jobTypeTemplateId - כלומר בלי checklist
  // אוטומטי ובלי hard filter על סקיל ב-Scheduling - מנהל יבדוק ידנית.
  // ============================================================
  @UseGuards(JwtAuthGuard)
  @Post('gmail/sync')
  async syncGmail(@Req() req: Request) {
    const tenantId = req.tenantId!;
    const connector = await this.integrationsService.getConnector(tenantId, 'GMAIL');
    await connector.ensureAuthenticated();

    const emails = await connector.fetch<ParsedEmail[]>('unread_messages', { maxResults: 10 });

    const created: Array<{ taskId: string; matchedTemplate: boolean; confidence: number }> = [];
    const skipped: string[] = [];

    for (const email of emails) {
      const existing = await this.prisma.task.findFirst({
        where: { tenantId, sourceEmailId: email.gmailMessageId },
      });
      if (existing) {
        skipped.push(email.gmailMessageId);
        continue;
      }

      const { name, email: fromEmail } = parseFromHeader(email.from);

      let customer = (await this.customersService.search(tenantId, fromEmail))[0];
      if (!customer) {
        customer = await this.customersService.create(tenantId, { name, email: fromEmail });
      }

      const extraction = await this.intakeExtraction.extractFromEmail(tenantId, {
        subject: email.subject,
        bodyText: email.bodyText || email.snippet,
      });
      const autoAssign = this.intakeExtraction.shouldAutoAssignTemplate(extraction);

      const task = await this.tasksService.createFromEmail(tenantId, {
        customerId: customer.id,
        title: email.subject || '(ללא נושא)',
        description: email.snippet,
        sourceEmailId: email.gmailMessageId,
        jobTypeTemplateId: autoAssign ? extraction.matchedTemplateId : null,
        extractedFields: extraction.extractedFields,
        priority: extraction.priority,
      });

      created.push({ taskId: task.id, matchedTemplate: autoAssign, confidence: extraction.confidence });
    }

    return { created, skippedAlreadyProcessed: skipped.length, totalFetched: emails.length };
  }
}

```

## `src/modules/integrations/integrations.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { GoogleOAuthService } from './google-oauth.service';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { CustomersModule } from '../customers/customers.module';
import { IntakeModule } from '../intake/intake.module';

@Module({
  imports: [
    AuthModule,
    TasksModule,
    CustomersModule,
    IntakeModule,
    // רישום JwtModule נפרד (לא זהה למופע שב-AuthModule) - משמש רק
    // לחתימת/אימות ה-state הזמני ב-OAuth flow, לא לטוקני login.
    // אותו JWT_SECRET משמש בשניהם ב-MVP; ניתן להפריד ל-secret נפרד
    // בעתיד אם רוצים בידוד גדול יותר בין השניים.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
      }),
    }),
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, GoogleOAuthService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}

```

## `src/modules/integrations/integrations.service.ts`

```typescript
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleOAuthService } from './google-oauth.service';
import { GmailConnector } from './gmail.connector';
import { DriveConnector } from './drive.connector';
import { Connector } from './connector.interface';
import { encryptSecret, decryptSecret } from '../../common/crypto.util';

type GoogleProvider = 'GMAIL' | 'DRIVE';

// ============================================================
// זהו ה-registry שממנו כל שאר האפליקציה מקבלת connector מוכן לשימוש
// (מסמך הארכיטקטורה, סעיף 3). Intake/Comms/Invoicing modules יקראו
// ל-getConnector(tenantId, 'GMAIL'/'DRIVE') ולא ידעו כלום על OAuth,
// הצפנה, או googleapis - זה כל העניין ב-abstraction הזה.
// ============================================================

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleOAuth: GoogleOAuthService,
  ) {}

  // --- OAuth flow (Google מכסה גם Gmail וגם Drive בהסכמה אחת) ---

  buildGoogleAuthUrl(state: string): string {
    return this.googleOAuth.buildAuthUrl(state);
  }

  async handleGoogleCallback(tenantId: string, code: string): Promise<void> {
    const { accessToken, refreshToken, scopes } = await this.googleOAuth.exchangeCode(code);

    const accessTokenEncrypted = encryptSecret(accessToken);
    const refreshTokenEncrypted = encryptSecret(refreshToken);

    // הסכמה אחת מול Google מכסה גם Gmail וגם Drive - שתי רשומות,
    // אותם טוקנים. בעתיד, אם צריך scopes שונים לכל שירות, זה נפרד בקלות.
    for (const provider of ['GMAIL', 'DRIVE'] as GoogleProvider[]) {
      await this.prisma.tenantIntegration.upsert({
        where: { tenantId_provider: { tenantId, provider } },
        update: { accessTokenEncrypted, refreshTokenEncrypted, scopes, status: 'CONNECTED' },
        create: { tenantId, provider, accessTokenEncrypted, refreshTokenEncrypted, scopes, status: 'CONNECTED' },
      });
    }

    this.logger.log(`Google integration connected for tenant ${tenantId} (Gmail + Drive)`);
  }

  async disconnect(tenantId: string, provider: GoogleProvider): Promise<void> {
    await this.prisma.tenantIntegration.updateMany({
      where: { tenantId, provider },
      data: { status: 'DISCONNECTED', accessTokenEncrypted: null, refreshTokenEncrypted: null },
    });
  }

  async listStatus(tenantId: string) {
    return this.prisma.tenantIntegration.findMany({
      where: { tenantId },
      select: { provider: true, status: true, updatedAt: true },
    });
  }

  // --- Factory: getConnector - זה מה שמודולי פיצ'ר אחרים קוראים ---

  async getConnector(tenantId: string, provider: GoogleProvider): Promise<Connector> {
    const integration = await this.prisma.tenantIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });

    if (!integration || integration.status !== 'CONNECTED' || !integration.accessTokenEncrypted || !integration.refreshTokenEncrypted) {
      throw new NotFoundException(`${provider} is not connected for this tenant`);
    }

    const accessToken = decryptSecret(integration.accessTokenEncrypted);
    const refreshToken = decryptSecret(integration.refreshTokenEncrypted);

    const authClient = this.googleOAuth.createAuthenticatedClient(
      { accessToken, refreshToken },
      // כשה-library מרעננת access token אוטומטית, שומרים את החדש
      // מוצפן חזרה ל-DB - כך שבפעם הבאה לא צריך לרענן שוב מיד
      (newAccessToken) => {
        this.prisma.tenantIntegration
          .update({
            where: { tenantId_provider: { tenantId, provider } },
            data: { accessTokenEncrypted: encryptSecret(newAccessToken) },
          })
          .catch((err: unknown) => this.logger.error(`Failed to persist refreshed token for ${provider}`, err));
      },
    );

    return provider === 'GMAIL' ? new GmailConnector(authClient) : new DriveConnector(authClient);
  }
}

```

## `src/modules/inventory/inventory.controller.ts`

```typescript
import { Controller, Get, Post, Patch, Body, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  findAll(@Req() req: Request) {
    return this.inventoryService.findAll(req.tenantId!);
  }

  @Get('low-stock')
  findLowStock(@Req() req: Request) {
    return this.inventoryService.findLowStock(req.tenantId!);
  }

  @Post()
  create(@Req() req: Request, @Body() body: {
    sku: string; name: string; quantity?: number; lowStockThreshold?: number; unitPrice?: number; category?: string;
  }) {
    return this.inventoryService.create(req.tenantId!, body);
  }

  // restock ידני, למשל אחרי הזמנת סחורה מספק - delta יכול להיות שלילי
  // (תיקון אחרי ספירת מלאי פיזית)
  @Patch(':id/adjust')
  adjust(@Req() req: Request, @Param('id') id: string, @Body('delta') delta: number) {
    return this.inventoryService.adjustQuantity(req.tenantId!, id, delta);
  }
}

```

## `src/modules/inventory/inventory.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}

```

## `src/modules/inventory/inventory.service.ts`

```typescript
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';

interface ChecklistItem {
  label: string;
  done: boolean;
  priceCode?: string;
  sku?: string;  // מקשר לפריט מלאי (InventoryItem.sku) - נפרד מ-priceCode בכוונה:
  qty?: number;  // לא כל שורת מחירון צורכת חלק פיזי (למשל "בדיקת גז" - אין sku)
}

// ============================================================
// Inventory Agent (מסמך הארכיטקטורה, סעיף 6.3) - שני מצבי עבודה
// על אותה טבלה בדיוק (InventoryItem):
//
// 1. מצב שירות שטח (פעיל עכשיו): ניכוי אוטומטי בסגירת checklist item
//    עם sku מוגדר - ראו handleTaskClosed. זה התוסף שמופעל אצל חברת
//    האחזקה/נגרייה.
//
// 2. מצב קמעונאות (מוכן, לא מחובר עדיין): checkAvailability() קיים
//    כאן כפונקציה כללית לשימוש עתידי ע"י Intake module כשמגיע Task
//    מסוג הזמנת מוצר - matching מול מלאי לפני אישור הזמנה. לא מחובר
//    בפועל כי אין עדיין לקוח בורטיקל קמעונאות (ראו Roadmap, סעיף 9
//    במסמך הארכיטקטורה - זה השלב האחרון, בכוונה).
// ============================================================

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent('task.closed')
  async handleTaskClosed(payload: { tenantId: string; taskId: string }) {
    const task = await this.prisma.task.findUnique({ where: { id: payload.taskId } });
    if (!task?.checklist) return;

    const checklist = task.checklist as unknown as ChecklistItem[];
    const consumedItems = checklist.filter((item) => item.done && item.sku);
    if (consumedItems.length === 0) return;

    for (const item of consumedItems) {
      await this.deduct(payload.tenantId, item.sku!, item.qty ?? 1, payload.taskId);
    }
  }

  private async deduct(tenantId: string, sku: string, qty: number, taskId: string) {
    const inventoryItem = await this.prisma.inventoryItem.findUnique({
      where: { tenantId_sku: { tenantId, sku } },
    });

    if (!inventoryItem) {
      // לא זורקים - המשימה כבר נסגרה, לא רוצים להפיל את שאר ה-
      // listeners (Invoicing/Comms) על אירוע שכבר קרה. רק מתעדים.
      this.logger.warn(`Task ${taskId} closed with sku "${sku}" not found in inventory for tenant ${tenantId}`);
      return;
    }

    const updated = await this.prisma.inventoryItem.update({
      where: { id: inventoryItem.id },
      data: { quantity: { decrement: qty } },
    });

    if (updated.quantity < 0) {
      this.logger.warn(
        `Inventory for sku "${sku}" went negative (${updated.quantity}) after task ${taskId} - ` +
        `stock count may be out of sync with reality, needs manual correction`,
      );
    }

    if (updated.quantity <= updated.lowStockThreshold) {
      this.logger.warn(`Low stock alert: "${updated.name}" (${sku}) is at ${updated.quantity} units for tenant ${tenantId}`);
      // TODO: Comms module לא מאזין לאירוע הזה עדיין - זה hook מוכן
      // להתראת מנהל (מייל/Push) ברגע שיתווסף template מתאים
      this.events.emit('inventory.low_stock', { tenantId, sku, quantity: updated.quantity, name: updated.name });
    }
  }

  // --- שימוש עתידי: matching מול הזמנה נכנסת בקמעונאות (סעיף 5.2) ---
  async checkAvailability(tenantId: string, sku: string, requestedQty: number): Promise<{ available: boolean; currentQuantity: number }> {
    const item = await this.prisma.inventoryItem.findUnique({ where: { tenantId_sku: { tenantId, sku } } });
    if (!item) return { available: false, currentQuantity: 0 };
    return { available: item.quantity >= requestedQty, currentQuantity: item.quantity };
  }

  // --- CRUD בסיסי לניהול ידני של המלאי ---

  findAll(tenantId: string) {
    return this.prisma.inventoryItem.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async findLowStock(tenantId: string) {
    // Prisma לא תומך בהשוואת שתי עמודות של אותה שורה (quantity <=
    // lowStockThreshold) ב-where רגיל בלי raw SQL - ובהיקף של MVP
    // (עשרות/מאות פריטי מלאי לכל היותר per tenant) סינון ב-JS אחרי
    // findMany פשוט וברור יותר מ-raw SQL עם סיכון לטעויות casing
    // בשמות עמודות (Prisma לא ממפה ל-snake_case בלי @map מפורש).
    const items = await this.prisma.inventoryItem.findMany({ where: { tenantId } });
    return items.filter((item: { quantity: number; lowStockThreshold: number }) => item.quantity <= item.lowStockThreshold);
  }

  async create(tenantId: string, data: {
    sku: string; name: string; quantity?: number; lowStockThreshold?: number; unitPrice?: number; category?: string;
  }) {
    const existing = await this.prisma.inventoryItem.findUnique({ where: { tenantId_sku: { tenantId, sku: data.sku } } });
    if (existing) throw new BadRequestException(`SKU "${data.sku}" already exists for this tenant`);

    return this.prisma.inventoryItem.create({ data: { tenantId, ...data } });
  }

  // restock/תיקון ידני - delta יכול להיות חיובי (הגיע מלאי חדש) או
  // שלילי (תיקון אחרי ספירת מלאי פיזית ולא תאמה למערכת)
  async adjustQuantity(tenantId: string, id: string, delta: number) {
    const item = await this.prisma.inventoryItem.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Inventory item not found for this tenant');

    return this.prisma.inventoryItem.update({
      where: { id },
      data: { quantity: { increment: delta } },
    });
  }
}

```

## `src/modules/invoicing/invoice-pdf.util.ts`

```typescript
import PDFDocument from 'pdfkit';

// ============================================================
// יצירת PDF פנימי לחשבונית (מסמך הארכיטקטורה, סעיף 6.4: "ב-MVP
// הפקת PDF פנימי, ללא חשבונית ירוקה"). פשוט ומעשי - טבלת שורות
// + סכום כולל. לא מטרה לחקות עיצוב חשבונית רשמית; זה קובץ שנשמר
// ב-Drive של הטננט ומועבר ידנית לרואה חשבון בשלב זה.
// ============================================================

export interface InvoicePdfData {
  tenantName: string;
  customerName: string;
  invoiceId: string;
  periodStart: Date;
  periodEnd: Date;
  lineItems: Array<{ description: string; priceCode: string; amount: number }>;
  totalAmount: number;
}

export function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fmtDate = (d: Date) => d.toLocaleDateString('en-GB');

    doc.fontSize(20).text(data.tenantName, { align: 'right' });
    doc.moveDown(0.5);
    doc.fontSize(14).text(`Invoice #${data.invoiceId.slice(0, 8)}`, { align: 'right' });
    doc.fontSize(10).text(`Period: ${fmtDate(data.periodStart)} - ${fmtDate(data.periodEnd)}`, { align: 'right' });
    doc.text(`Customer: ${data.customerName}`, { align: 'right' });
    doc.moveDown(1.5);

    // כותרות טבלה
    const startY = doc.y;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Description', 50, startY, { width: 280 });
    doc.text('Code', 340, startY, { width: 100 });
    doc.text('Amount', 450, startY, { width: 80, align: 'right' });
    doc.moveDown(0.5);
    doc.font('Helvetica');
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.3);

    for (const item of data.lineItems) {
      const rowY = doc.y;
      doc.text(item.description, 50, rowY, { width: 280 });
      doc.text(item.priceCode, 340, rowY, { width: 100 });
      doc.text(item.amount.toFixed(2), 450, rowY, { width: 80, align: 'right' });
      doc.moveDown(0.4);
    }

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text(`Total: ${data.totalAmount.toFixed(2)}`, { align: 'right' });

    doc.end();
  });
}

```

## `src/modules/invoicing/invoicing.controller.ts`

```typescript
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { InvoicingService } from './invoicing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('invoices')
export class InvoicingController {
  constructor(private readonly invoicingService: InvoicingService) {}

  @Get()
  findAll(@Req() req: Request, @Query('customerId') customerId?: string) {
    return this.invoicingService.findAll(req.tenantId!, customerId);
  }

  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    return this.invoicingService.findOne(req.tenantId!, id);
  }

  // פעולה יזומה של מנהל (מסמך הארכיטקטורה, סעיף 5.1 שורה 7) -
  // לא אוטומטית, ולא מוגבלת לתזמון חודשי דווקא - המנהל בוחר טווח
  @Post('generate')
  generate(@Req() req: Request, @Body() body: { customerId: string; periodStart: string; periodEnd: string }) {
    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      throw new BadRequestException('periodStart/periodEnd must be valid ISO date strings');
    }
    return this.invoicingService.generateInvoice(req.tenantId!, { customerId: body.customerId, periodStart, periodEnd });
  }
}

```

## `src/modules/invoicing/invoicing.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { InvoicingService } from './invoicing.service';
import { InvoicingController } from './invoicing.controller';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [AuthModule, IntegrationsModule],
  controllers: [InvoicingController],
  providers: [InvoicingService],
  exports: [InvoicingService],
})
export class InvoicingModule {}

```

## `src/modules/invoicing/invoicing.service.ts`

```typescript
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { generateInvoicePdf } from './invoice-pdf.util';

interface ChecklistItem {
  label: string;
  done: boolean;
  priceCode?: string;
}

// ============================================================
// Invoicing Agent (מסמך הארכיטקטורה, סעיפים 6.4 + טבלת 5.1 שורות 6ג/7).
// שני תפקידים נפרדים בכוונה:
//
// 1. validateClosedTask (@OnEvent('task.closed')) - רץ מיד בסגירה,
//    רק *מוודא* שכל checklist item עם priceCode קיים במחירון (מתריע
//    מוקדם על מיפוי חסר) - לא יוצר חשבונית בפועל עדיין.
//
// 2. generateInvoice() - פעולה יזומה של מנהל (טבלה 5.1, שורה 7):
//    פילטר משימות סגורות לפי לקוח+טווח תאריכים -> חישוב סכומים ->
//    יצירת Invoice+InvoiceLineItem -> PDF -> Drive.
//    מונע כפל-חיוב: משימה שכבר הופיעה ב-InvoiceLineItem כלשהו
//    (מכל חשבונית קודמת של אותו לקוח) לא תיכלל שוב.
// ============================================================

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  @OnEvent('task.closed')
  async validateClosedTask(payload: { tenantId: string; taskId: string }) {
    const task = await this.prisma.task.findUnique({ where: { id: payload.taskId } });
    if (!task?.checklist) return;

    const checklist = task.checklist as unknown as ChecklistItem[];
    const doneWithCode = checklist.filter((item) => item.done && item.priceCode);
    if (doneWithCode.length === 0) return;

    const priceCodes = doneWithCode.map((item) => item.priceCode!);
    const found = await this.prisma.priceListItem.findMany({
      where: { tenantId: payload.tenantId, code: { in: priceCodes }, isActive: true },
      select: { code: true },
    });
    const foundCodes = new Set(found.map((f: { code: string }) => f.code));

    const missing = priceCodes.filter((code) => !foundCodes.has(code));
    if (missing.length > 0) {
      this.logger.warn(
        `Task ${payload.taskId} closed with checklist priceCode(s) not found in PriceListItem: ${missing.join(', ')}. ` +
        `Invoice generation will skip these line items until a manager adds them to the price list.`,
      );
    }
  }

  async generateInvoice(tenantId: string, params: {
    customerId: string;
    periodStart: Date;
    periodEnd: Date;
  }) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: params.customerId, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found for this tenant');

    // משימות שכבר הופיעו בחשבונית קודמת (של הלקוח הזה) - לא לחייב פעמיים
    const alreadyInvoiced = await this.prisma.invoiceLineItem.findMany({
      where: { taskId: { not: null }, invoice: { tenantId, customerId: params.customerId } },
      select: { taskId: true },
    });
    const excludeTaskIds = alreadyInvoiced.map((i: { taskId: string | null }) => i.taskId!).filter(Boolean);

    const closedTasks = await this.prisma.task.findMany({
      where: {
        tenantId,
        customerId: params.customerId,
        status: 'CLOSED',
        closedAt: { gte: params.periodStart, lte: params.periodEnd },
        id: { notIn: excludeTaskIds },
      },
    });

    if (closedTasks.length === 0) {
      throw new BadRequestException('No un-invoiced closed tasks found for this customer in the given period');
    }

    interface PriceListEntry { code: string; description: string; price: unknown }
    const priceList: PriceListEntry[] = await this.prisma.priceListItem.findMany({ where: { tenantId, isActive: true } });
    const priceByCode = new Map<string, PriceListEntry>(priceList.map((p) => [p.code, p]));

    const lineItemsData: Array<{ taskId: string; priceCode: string; description: string; amount: number }> = [];

    for (const task of closedTasks) {
      const checklist = (task.checklist as unknown as ChecklistItem[]) ?? [];
      for (const item of checklist) {
        if (!item.done || !item.priceCode) continue;
        const priceEntry = priceByCode.get(item.priceCode);
        if (!priceEntry) continue; // כבר הוזהר ב-validateClosedTask - לא נכשל כאן, פשוט מדלגים

        lineItemsData.push({
          taskId: task.id,
          priceCode: item.priceCode,
          description: priceEntry.description,
          amount: Number(priceEntry.price),
        });
      }
    }

    if (lineItemsData.length === 0) {
      throw new BadRequestException(
        'Found closed tasks but no billable checklist items matched an active price list entry',
      );
    }

    const totalAmount = lineItemsData.reduce((sum, li) => sum + li.amount, 0);

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    // יצירת Invoice + line items באותה טרנזקציה - לא רוצים חשבונית
    // "יתומה" בלי שורות אם משהו נכשל באמצע
    const invoice = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.invoice.create({
        data: {
          tenantId,
          customerId: params.customerId,
          periodStart: params.periodStart,
          periodEnd: params.periodEnd,
          totalAmount,
          status: 'DRAFT',
        },
      });

      await tx.invoiceLineItem.createMany({
        data: lineItemsData.map((li) => ({ invoiceId: created.id, ...li })),
      });

      return created;
    });

    // PDF + שמירה ב-Drive - מחוץ לטרנזקציה בכוונה: אם ה-Drive
    // upload נכשל (למשל טוקן פג ולא הצליח לרענן), עדיין נשארת לנו
    // חשבונית DRAFT תקינה ב-DB שאפשר לנסות שוב לייצא אליה PDF,
    // במקום לאבד את כל העבודה
    try {
      const pdfBuffer = await generateInvoicePdf({
        tenantName: tenant.name,
        customerName: customer.name,
        invoiceId: invoice.id,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        lineItems: lineItemsData,
        totalAmount,
      });

      const drive = await this.integrations.getConnector(tenantId, 'DRIVE');
      const uploaded = await drive.send<{ fileId: string }>('file', {
        name: `invoice-${invoice.id.slice(0, 8)}-${customer.name}.pdf`,
        mimeType: 'application/pdf',
        content: pdfBuffer,
      });

      return this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'FINALIZED', pdfDriveFileId: uploaded.fileId },
        include: { lineItems: true },
      });
    } catch (err) {
      this.logger.error(
        `Invoice ${invoice.id} created but PDF/Drive upload failed - invoice remains in DRAFT status. ` +
        `Likely cause: Drive not connected for this tenant, or token refresh failed.`,
        err,
      );
      return this.prisma.invoice.findUnique({ where: { id: invoice.id }, include: { lineItems: true } });
    }
  }

  findAll(tenantId: string, customerId?: string) {
    return this.prisma.invoice.findMany({
      where: { tenantId, ...(customerId ? { customerId } : {}) },
      include: { lineItems: true, customer: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(tenantId: string, id: string) {
    return this.prisma.invoice.findFirst({
      where: { id, tenantId },
      include: { lineItems: true, customer: true },
    });
  }
}

```

## `src/modules/job-type-templates/job-type-templates.controller.ts`

```typescript
import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JobTypeTemplatesService } from './job-type-templates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('job-type-templates')
export class JobTypeTemplatesController {
  constructor(private readonly service: JobTypeTemplatesService) {}

  @Get()
  findAll(@Req() req: Request) {
    return this.service.findAllActive(req.tenantId!);
  }

  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    return this.service.findOne(req.tenantId!, id);
  }

  @Post()
  create(@Req() req: Request, @Body() body: any) {
    return this.service.create(req.tenantId!, body);
  }
}

```

## `src/modules/job-type-templates/job-type-templates.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { JobTypeTemplatesController } from './job-type-templates.controller';
import { JobTypeTemplatesService } from './job-type-templates.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [JobTypeTemplatesController],
  providers: [JobTypeTemplatesService],
  exports: [JobTypeTemplatesService],
})
export class JobTypeTemplatesModule {}

```

## `src/modules/job-type-templates/job-type-templates.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ראו מסמך הארכיטקטורה סעיף 4.3 - זו הישות שמזינה את הטופס הידני
@Injectable()
export class JobTypeTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  findAllActive(tenantId: string) {
    return this.prisma.jobTypeTemplate.findMany({
      where: { tenantId, isActive: true },
    });
  }

  findOne(tenantId: string, id: string) {
    return this.prisma.jobTypeTemplate.findFirst({ where: { id, tenantId } });
  }

  // דוגמת seed - בפועל ייווצר דרך מסך ניהול, לא קוד
  create(tenantId: string, data: {
    name: string;
    fields: unknown; // { key, label, type, required, options? }[]
    defaultChecklist: unknown; // { label, priceCode? }[]
    defaultPriority?: number;
  }) {
    return this.prisma.jobTypeTemplate.create({
      data: { tenantId, ...data } as any,
    });
  }
}

```

## `src/modules/onboarding/document-learning.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { extractTextFromPdf } from './pdf-text.util';

// ============================================================
// "הלמידה" מהמסמכים שהעסק מעלה (הצעות מחיר + הזמנות חומרים).
// שימוש שני, נפרד, ב-LLM (מעבר ל-Intake) - כאן המטרה היא לחלץ
// שורות פריטים+מחירים ממסמך free-form (PDF), לא לסווג פנייה.
//
// מודל עסקי: זו הערכה **גסה** בכוונה - ממוצע כולל של הצעות מול
// הזמנות חומרים, לא matching פריט-מול-פריט (זה יידרש NLP הרבה יותר
// מורכב ופחות אמין ב-MVP). זו נקודת התחלה למנהל לעיין בה, לא מספר
// סופי שהמערכת "מכריזה" עליו כנכון.
// ============================================================

const lineItemsResultSchema = z.object({
  lineItems: z.array(z.object({
    description: z.string(),
    amount: z.number(),
  })),
  totalAmount: z.number().nullable(),
});

export type LineItemsResult = z.infer<typeof lineItemsResultSchema>;

const SYSTEM_PROMPT = `אתה מסייע לחלץ שורות פריטים ומחירים ממסמך עסקי (הצעת מחיר או הזמנת חומרים) בעברית.

חוקים קשיחים:
1. החזר אך ורק JSON תקין - בלי טקסט נוסף, בלי הסברים, בלי markdown code fences.
2. אם אין מבנה ברור של שורות פריטים במסמך, החזר lineItems ריק ו-totalAmount null - אל תמציא נתונים.
3. totalAmount הוא הסכום הכולל של המסמך אם מופיע בבירור (למשל "סה"כ לתשלום"), אחרת null.

מבנה הפלט (JSON בלבד):
{
  "lineItems": [{ "description": string, "amount": number }],
  "totalAmount": number | null
}`;

@Injectable()
export class DocumentLearningService {
  private readonly logger = new Logger(DocumentLearningService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.client = new Anthropic({ apiKey: this.config.get<string>('ANTHROPIC_API_KEY') });
    this.model = this.config.get<string>('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001');
  }

  async processUploadedDocument(sessionId: string, docType: 'QUOTE' | 'MATERIAL_ORDER', file: { originalname: string; buffer: Buffer; mimetype: string }) {
    const text = file.mimetype === 'application/pdf'
      ? await extractTextFromPdf(file.buffer)
      : file.buffer.toString('utf8'); // txt/csv וכו' - נתמך כ-fallback פשוט

    const extraction = await this.extractLineItems(text);

    return this.prisma.onboardingDocument.create({
      data: {
        sessionId,
        docType,
        originalName: file.originalname,
        extractedText: text.slice(0, 20_000), // הגנה מפני מסמכים ענקיים - 20K תווים מספיק לכל ניתוח סביר
        extractedLineItems: extraction.lineItems as any,
        totalAmount: extraction.totalAmount as any,
      },
    });
  }

  private async extractLineItems(text: string): Promise<LineItemsResult> {
    if (!text.trim()) {
      return { lineItems: [], totalAmount: null };
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `תוכן המסמך:\n\n${text.slice(0, 15_000)}` }],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        return { lineItems: [], totalAmount: null };
      }

      const cleaned = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
      const parsed = JSON.parse(cleaned);
      const result = lineItemsResultSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.warn(`Document extraction JSON did not match schema: ${result.error.message}`);
        return { lineItems: [], totalAmount: null };
      }
      return result.data;
    } catch (err) {
      this.logger.error('Document line-item extraction failed', err);
      return { lineItems: [], totalAmount: null };
    }
  }

  // הערכה גסה (לא matching פריט-מול-פריט) - יחס בין ממוצע הצעות מחיר
  // לממוצע הזמנות חומרים, כנקודת פתיחה למנהל לעיין ולתקן
  async computeSuggestedMarkup(sessionId: string): Promise<{
    avgQuoteTotal: number | null;
    avgMaterialOrderTotal: number | null;
    suggestedMarkupPercent: number | null;
    note: string;
  }> {
    const documents: Array<{ docType: string; totalAmount: unknown }> =
      await this.prisma.onboardingDocument.findMany({ where: { sessionId } });

    const quoteTotals = documents
      .filter((d: { docType: string; totalAmount: unknown }) => d.docType === 'QUOTE' && typeof d.totalAmount === 'number')
      .map((d: { totalAmount: unknown }) => d.totalAmount as number);
    const materialTotals = documents
      .filter((d: { docType: string; totalAmount: unknown }) => d.docType === 'MATERIAL_ORDER' && typeof d.totalAmount === 'number')
      .map((d: { totalAmount: unknown }) => d.totalAmount as number);

    const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

    const avgQuoteTotal = avg(quoteTotals);
    const avgMaterialOrderTotal = avg(materialTotals);

    if (avgQuoteTotal === null || avgMaterialOrderTotal === null || avgMaterialOrderTotal === 0) {
      return {
        avgQuoteTotal,
        avgMaterialOrderTotal,
        suggestedMarkupPercent: null,
        note: 'אין מספיק מסמכים עם סכום כולל מזוהה משני הסוגים כדי לחשב הערכה - זו הערכה גסה בלבד, יש להשלים ידנית',
      };
    }

    const suggestedMarkupPercent = Math.round(((avgQuoteTotal / avgMaterialOrderTotal) - 1) * 100);

    return {
      avgQuoteTotal,
      avgMaterialOrderTotal,
      suggestedMarkupPercent,
      note: 'הערכה גסה מבוססת יחס ממוצעים כולל, לא התאמת פריט-מול-פריט - יש לבדוק ידנית לפני הסתמכות',
    };
  }
}

```

## `src/modules/onboarding/onboarding-finalize.service.ts`

```typescript
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingService } from './onboarding.service';
import { DocumentLearningService } from './document-learning.service';
import { slugify } from './slugify.util';

const BCRYPT_ROUNDS = 12;

interface CompanyInfo {
  legalName: string;
  businessId: string;
  vertical: 'MAINTENANCE' | 'CARPENTRY' | 'RETAIL';
  contactEmail: string;
}
interface TeamMember { name: string; email: string; role: 'OWNER' | 'MANAGER' | 'FIELD' }
interface PriceCode { code: string; description: string; defaultPrice: number }
interface JobTypeDraft {
  name: string;
  requiredSkill?: string;
  fields: Array<{ key: string; label: string; type: string; required?: boolean }>;
  defaultChecklist: Array<{ label: string; priceCode?: string }>;
}

// ============================================================
// זו הפעולה **היחידה** בכל מודול ה-onboarding שכותבת ל-Tenant/User/
// JobTypeTemplate/PriceListItem בפועל. היא נקראת רק דרך endpoint
// מפורש (POST /onboarding/:id/finalize) - לא אוטומטית מתוך הצ'אט,
// גם אם ה-LLM כבר קרא ל-ready_to_finalize. זו ההפרדה בין "LLM מציע"
// ל"קוד דטרמיניסטי מבצע" (מסמך הארכיטקטורה, עקרון בטיחות).
// ============================================================

@Injectable()
export class OnboardingFinalizeService {
  private readonly logger = new Logger(OnboardingFinalizeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingService: OnboardingService,
    private readonly documentLearning: DocumentLearningService,
  ) {}

  async finalize(sessionId: string, sessionSecret: string, opts: { force?: boolean } = {}) {
    const session = await this.onboardingService.validateSession(sessionId, sessionSecret);

    if (session.status === 'FINALIZED') {
      throw new BadRequestException('This onboarding session was already finalized');
    }
    if (session.status !== 'READY_TO_FINALIZE' && !opts.force) {
      throw new BadRequestException(
        'Onboarding chat has not signaled readiness yet - either continue the conversation, ' +
        'or pass force:true to finalize anyway with whatever has been collected so far',
      );
    }

    const companyInfo = session.companyInfo as unknown as CompanyInfo | null;
    const teamMembers = (session.teamMembers as unknown as TeamMember[] | null) ?? [];
    const priceCodes = (session.priceCodes as unknown as PriceCode[] | null) ?? [];
    const jobTypes = (session.jobTypes as unknown as JobTypeDraft[] | null) ?? [];

    if (!companyInfo?.legalName || !companyInfo.businessId || !companyInfo.vertical) {
      throw new BadRequestException('Missing required company info (legalName/businessId/vertical) - chat did not collect enough yet');
    }
    if (teamMembers.length === 0) {
      throw new BadRequestException('At least one team member (the business owner) is required before finalizing');
    }

    const subdomain = await this.generateUniqueSubdomain(companyInfo.legalName);
    const enabledModules = this.defaultModulesForVertical(companyInfo.vertical);

    // סיסמה זמנית לכל משתמש - מוצגת פעם אחת בתשובה הזו בלבד, לא נשמרת
    // בשום מקום בטקסט גלוי (רק ה-hash נשמר ב-DB, כמו בכל User אחר)
    const usersWithTempPasswords: Array<{ email: string; name: string; role: string; temporaryPassword: string }> = [];

    const tenant = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdTenant = await tx.tenant.create({
        data: {
          name: companyInfo.legalName,
          vertical: companyInfo.vertical,
          subdomain,
          config: {
            create: {
              enabledModules,
              theme: { primaryColor: '#2563eb', logoUrl: null },
              schedulingWeights: enabledModules.includes('scheduling')
                ? { skillWeight: 0.5, distanceWeight: 0.3, loadWeight: 0.2 }
                : undefined,
              emailTemplates: {
                taskCreated: 'שלום {customerName}, קיבלנו את פנייתך ונחזור אליך בהקדם.',
                taskClosed: 'שלום {customerName}, הטיפול בפנייתך הושלם. פירוט: {checklistSummary}',
              },
            },
          },
        },
      });

      for (const member of teamMembers) {
        const temporaryPassword = crypto.randomBytes(9).toString('base64url'); // סיסמה זמנית קריאה, לשינוי בכניסה ראשונה
        const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);

        await tx.user.create({
          data: {
            tenantId: createdTenant.id,
            email: member.email,
            name: member.name,
            role: member.role,
            passwordHash,
          },
        });

        usersWithTempPasswords.push({ email: member.email, name: member.name, role: member.role, temporaryPassword });
      }

      if (priceCodes.length > 0) {
        await tx.priceListItem.createMany({
          data: priceCodes.map((p) => ({
            tenantId: createdTenant.id,
            code: p.code,
            description: p.description,
            price: p.defaultPrice,
          })),
          skipDuplicates: true,
        });
      }

      for (const jt of jobTypes) {
        await tx.jobTypeTemplate.create({
          data: {
            tenantId: createdTenant.id,
            name: jt.name,
            requiredSkill: jt.requiredSkill,
            fields: jt.fields as any,
            defaultChecklist: jt.defaultChecklist as any,
          },
        });
      }

      return createdTenant;
    });

    const learningInsights = await this.documentLearning.computeSuggestedMarkup(sessionId);

    await this.prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { status: 'FINALIZED', resultTenantId: tenant.id, finalizedAt: new Date() },
    });

    this.logger.log(`Onboarding finalized: tenant ${tenant.id} (${tenant.subdomain}) created with ${usersWithTempPasswords.length} user(s)`);

    return {
      tenantId: tenant.id,
      subdomain: tenant.subdomain,
      users: usersWithTempPasswords,
      jobTypesCreated: jobTypes.length,
      priceCodesCreated: priceCodes.length,
      learningInsights,
    };
  }

  private defaultModulesForVertical(vertical: CompanyInfo['vertical']): string[] {
    // קמעונאות לא מפעילה Scheduling בכלל (סעיף 6.2 במסמך הארכיטקטורה) -
    // אין "שיוך לטכנאי" כשאין צוות שטח
    return vertical === 'RETAIL'
      ? ['intake', 'inventory', 'invoicing', 'comms']
      : ['intake', 'scheduling', 'inventory', 'invoicing', 'comms'];
  }

  private async generateUniqueSubdomain(legalName: string): Promise<string> {
    const base = slugify(legalName);
    let candidate = base;
    let suffix = 1;

    while (await this.prisma.tenant.findUnique({ where: { subdomain: candidate } })) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }
}

```

## `src/modules/onboarding/onboarding-tools.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';

// ============================================================
// הגדרות ה-tools שה-LLM יכול לקרוא במהלך שיחת ה-onboarding.
// עיקרון מרכזי: ה-LLM אף פעם לא כותב ל-DB ישירות - הוא רק "מסמן"
// עובדה מובנית (tool call), וקוד דטרמיניסטי (onboarding.service.ts)
// הוא שמעדכן את ה-DB בפועל. זה מפריד בין "הבנה" (LLM) ל"ביצוע" (קוד).
// ============================================================

export const ONBOARDING_TOOLS: Anthropic.Tool[] = [
  {
    name: 'record_company_info',
    description: 'שמור את פרטי החברה הבסיסיים ברגע שנאספו כולם בשיחה (שם, ח.פ, סוג העסק, מייל ליצירת קשר). אפשר לקרוא שוב אם פרט מתעדכן.',
    input_schema: {
      type: 'object',
      properties: {
        legalName: { type: 'string', description: 'שם החברה הרשמי' },
        businessId: { type: 'string', description: 'מספר ח.פ או עוסק מורשה' },
        vertical: { type: 'string', enum: ['MAINTENANCE', 'CARPENTRY', 'RETAIL'], description: 'MAINTENANCE=חברת אחזקה, CARPENTRY=נגרייה, RETAIL=חנות קמעונאית' },
        contactEmail: { type: 'string' },
      },
      required: ['legalName', 'businessId', 'vertical', 'contactEmail'],
    },
  },
  {
    name: 'add_team_member',
    description: 'הוסף איש צוות אחד שהוזכר בשיחה. קרא פעם אחת לכל איש צוות (לא כל השיחה מחדש).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        role: { type: 'string', enum: ['OWNER', 'MANAGER', 'FIELD'], description: 'OWNER=בעל העסק, MANAGER=מנהל/פקיד, FIELD=איש צוות שטח' },
      },
      required: ['name', 'email', 'role'],
    },
  },
  {
    name: 'add_price_code',
    description: 'הוסף קוד מחירון/"קוד סגירה" אחד שהוזכר בשיחה - למשל פעולה שהעסק מתמחר בנפרד. קרא פעם אחת לכל קוד.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'קוד קצר ללא רווחים, למשל AC-FILTER-REPLACE' },
        description: { type: 'string' },
        defaultPrice: { type: 'number' },
      },
      required: ['code', 'description', 'defaultPrice'],
    },
  },
  {
    name: 'add_job_type',
    description: 'הוסף סוג עבודה (תבנית) אחד שהוגדר בשיחה - למשל "התקנת מזגן" או "ארון הזמנה". קרא פעם אחת לכל סוג עבודה, אחרי שדנתם באילו שדות/פעולות הוא כולל.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        requiredSkill: { type: 'string', description: 'אופציונלי - התמחות נדרשת מטכנאי, לשיוך אוטומטי' },
        fields: {
          type: 'array',
          description: 'שדות שהטופס הידני יציג בפתיחת עבודה מהסוג הזה',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' }, label: { type: 'string' },
              type: { type: 'string', enum: ['text', 'number', 'select', 'date'] },
              required: { type: 'boolean' },
            },
            required: ['key', 'label', 'type'],
          },
        },
        defaultChecklist: {
          type: 'array',
          description: 'הפעולות שצריך לסמן כדי לסגור עבודה מהסוג הזה, כל אחת עם קוד מחירון אם רלוונטי',
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, priceCode: { type: 'string' } },
            required: ['label'],
          },
        },
      },
      required: ['name', 'fields', 'defaultChecklist'],
    },
  },
  {
    name: 'ready_to_finalize',
    description: 'קרא לפונקציה הזו רק אחרי שנאספו: פרטי חברה מלאים, לפחות איש צוות אחד (בעל העסק לפחות), ולפחות סוג עבודה אחד עם checklist. אל תקרא לזה מוקדם מדי.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'סיכום קצר בעברית של מה שנאסף, להצגה למשתמש לפני אישור סופי' },
      },
      required: ['summary'],
    },
  },
];

```

## `src/modules/onboarding/onboarding.controller.ts`

```typescript
import { Controller, Post, Get, Body, Param, Query, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OnboardingService } from './onboarding.service';
import { OnboardingFinalizeService } from './onboarding-finalize.service';
import { DocumentLearningService } from './document-learning.service';

// ============================================================
// שים לב: אין כאן JwtAuthGuard בכלל - onboarding קורה *לפני* שיש
// טננט/משתמש מאומת (מסמך הארכיטקטורה, "onboarding קורה לפני שהטננט
// קיים"). הבידוד היחיד הוא sessionSecret שמאומת בתוך כל service
// call (ראו OnboardingService.validateSession). רץ על דומיין הבסיס,
// לא tenant subdomain - כמו ה-Google OAuth callback.
// ============================================================

@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly finalizeService: OnboardingFinalizeService,
    private readonly documentLearning: DocumentLearningService,
  ) {}

  @Post('start')
  start() {
    return this.onboardingService.start();
  }

  @Post(':id/message')
  sendMessage(@Param('id') id: string, @Body() body: { sessionSecret: string; message: string }) {
    return this.onboardingService.sendMessage(id, body.sessionSecret, body.message);
  }

  @Get(':id/summary')
  getSummary(@Param('id') id: string, @Query('sessionSecret') sessionSecret: string) {
    return this.onboardingService.getSessionSummary(id, sessionSecret);
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Param('id') id: string,
    @Query('sessionSecret') sessionSecret: string,
    @Query('docType') docType: 'QUOTE' | 'MATERIAL_ORDER',
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded (expected multipart field "file")');
    if (docType !== 'QUOTE' && docType !== 'MATERIAL_ORDER') {
      throw new BadRequestException('docType query param must be "QUOTE" or "MATERIAL_ORDER"');
    }

    // מוודא שה-session שייך לבעל ה-sessionSecret לפני שמעבדים קובץ
    // (יקר יחסית - PDF parsing + קריאת LLM) - לא לבזבז עיבוד על בקשה לא מאומתת
    await this.onboardingService.validateSession(id, sessionSecret);

    return this.documentLearning.processUploadedDocument(id, docType, {
      originalname: file.originalname,
      buffer: file.buffer,
      mimetype: file.mimetype,
    });
  }

  @Post(':id/finalize')
  finalize(@Param('id') id: string, @Body() body: { sessionSecret: string; force?: boolean }) {
    return this.finalizeService.finalize(id, body.sessionSecret, { force: body.force });
  }
}

```

## `src/modules/onboarding/onboarding.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingFinalizeService } from './onboarding-finalize.service';
import { DocumentLearningService } from './document-learning.service';
import { OnboardingController } from './onboarding.controller';

@Module({
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingFinalizeService, DocumentLearningService],
  exports: [OnboardingService],
})
export class OnboardingModule {}

```

## `src/modules/onboarding/onboarding.service.ts`

```typescript
import { Injectable, Logger, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { ONBOARDING_TOOLS } from './onboarding-tools';

interface CompanyInfo {
  legalName: string;
  businessId: string;
  vertical: 'MAINTENANCE' | 'CARPENTRY' | 'RETAIL';
  contactEmail: string;
}
interface TeamMember { name: string; email: string; role: 'OWNER' | 'MANAGER' | 'FIELD' }
interface PriceCode { code: string; description: string; defaultPrice: number }
interface JobTypeDraft {
  name: string;
  requiredSkill?: string;
  fields: Array<{ key: string; label: string; type: string; required?: boolean }>;
  defaultChecklist: Array<{ label: string; priceCode?: string }>;
}

const MAX_TOOL_ITERATIONS = 5; // הגנה מפני לולאת tool-calls אינסופית

// ============================================================
// "מוח" ה-Onboarding - שיחה מרובת-תורות עם Claude, tool-use בלבד
// (לא פרסור טקסט חופשי) לאיסוף מידע מובנה. ראו onboarding-tools.ts
// להגדרות הכלים, ו-onboarding-finalize.service.ts ליצירת הטננט
// בפועל (פעולה נפרדת, מאושרת אנושית - לא כאן).
//
// מודל: כאן במכוון *לא* Haiku (בניגוד ל-Intake/Document-Learning) -
// זו שיחה מורכבת, חד-פעמית לכל טננט חדש, שבה איכות השיחה חשובה
// יותר מעלות. תדירות נמוכה = ההצדקה הכלכלית למודל חזק יותר כאן.
// ============================================================

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.client = new Anthropic({ apiKey: this.config.get<string>('ANTHROPIC_API_KEY') });
    this.model = this.config.get<string>('ONBOARDING_MODEL', 'claude-sonnet-5');
  }

  async start(): Promise<{ sessionId: string; sessionSecret: string; message: string }> {
    const sessionSecret = crypto.randomBytes(24).toString('hex');
    const greeting =
      'שלום! אני כאן כדי להכיר את העסק שלך ולהקים עבורו את המערכת. ' +
      'בוא נתחיל מהבסיס - מה השם הרשמי של החברה, ומה מספר ח.פ או עוסק מורשה?';

    const session = await this.prisma.onboardingSession.create({
      data: {
        sessionSecret,
        conversationHistory: [{ role: 'assistant', content: greeting }] as any,
      },
    });

    return { sessionId: session.id, sessionSecret, message: greeting };
  }

  async sendMessage(sessionId: string, sessionSecret: string, userMessage: string): Promise<{ reply: string; status: string }> {
    const session = await this.validateSession(sessionId, sessionSecret);
    if (session.status !== 'IN_PROGRESS') {
      throw new BadRequestException(`Session is already ${session.status} - cannot continue chatting`);
    }

    // מצב מקומי מוטבע (mutable) - מתעדכן מ-tool calls במהלך התור הזה,
    // נכתב ל-DB פעם אחת בסוף במקום query נפרד לכל tool call
    const companyInfo = (session.companyInfo as unknown as CompanyInfo | null) ?? null;
    const teamMembers = ((session.teamMembers as unknown as TeamMember[] | null) ?? []).slice();
    const priceCodes = ((session.priceCodes as unknown as PriceCode[] | null) ?? []).slice();
    const jobTypes = ((session.jobTypes as unknown as JobTypeDraft[] | null) ?? []).slice();
    let updatedCompanyInfo = companyInfo;
    let readyToFinalize = false;

    const docCounts = await this.getDocumentCounts(sessionId);

    let messages: Anthropic.MessageParam[] = ((session.conversationHistory as unknown as Anthropic.MessageParam[]) ?? []);
    messages = [...messages, { role: 'user', content: userMessage }];

    let finalText = 'קיבלתי, בוא נמשיך.';

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: this.buildSystemPrompt(docCounts),
        tools: ONBOARDING_TOOLS,
        messages,
      });

      messages = [...messages, { role: 'assistant', content: response.content }];

      const toolUses = response.content.filter((block) => block.type === 'tool_use');
      if (toolUses.length === 0) {
        const textBlock = response.content.find((block) => block.type === 'text');
        finalText = textBlock && textBlock.type === 'text' ? textBlock.text : finalText;
        break;
      }

      const toolResults: Anthropic.ContentBlockParam[] = [];
      for (const toolUse of toolUses) {
        const input = toolUse.input as Record<string, unknown>;

        switch (toolUse.name) {
          case 'record_company_info':
            updatedCompanyInfo = input as unknown as CompanyInfo;
            break;
          case 'add_team_member':
            teamMembers.push(input as unknown as TeamMember);
            break;
          case 'add_price_code':
            priceCodes.push(input as unknown as PriceCode);
            break;
          case 'add_job_type':
            jobTypes.push(input as unknown as JobTypeDraft);
            break;
          case 'ready_to_finalize':
            readyToFinalize = true;
            break;
          default:
            this.logger.warn(`Unknown tool called by LLM: ${toolUse.name}`);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ ok: true }),
        });
      }

      messages = [...messages, { role: 'user', content: toolResults }];

      if (iteration === MAX_TOOL_ITERATIONS - 1) {
        finalText = 'קלטתי את הפרטים - נמשיך משם. יש עוד משהו שתרצה להוסיף?';
      }
    }

    await this.prisma.onboardingSession.update({
      where: { id: sessionId },
      data: {
        conversationHistory: messages as any,
        companyInfo: updatedCompanyInfo as any,
        teamMembers: teamMembers as any,
        priceCodes: priceCodes as any,
        jobTypes: jobTypes as any,
        status: readyToFinalize ? 'READY_TO_FINALIZE' : undefined,
      },
    });

    return { reply: finalText, status: readyToFinalize ? 'READY_TO_FINALIZE' : 'IN_PROGRESS' };
  }

  async getSessionSummary(sessionId: string, sessionSecret: string) {
    const session = await this.validateSession(sessionId, sessionSecret);
    const docCounts = await this.getDocumentCounts(sessionId);
    return {
      status: session.status,
      companyInfo: session.companyInfo,
      teamMembers: session.teamMembers,
      priceCodes: session.priceCodes,
      jobTypes: session.jobTypes,
      documentCounts: docCounts,
    };
  }

  private async getDocumentCounts(sessionId: string): Promise<{ quotes: number; materialOrders: number }> {
    const counts = await this.prisma.onboardingDocument.groupBy({
      by: ['docType'],
      where: { sessionId },
      _count: { _all: true },
    });
    const quotes = counts.find((c: { docType: string }) => c.docType === 'QUOTE')?._count?._all ?? 0;
    const materialOrders = counts.find((c: { docType: string }) => c.docType === 'MATERIAL_ORDER')?._count?._all ?? 0;
    return { quotes, materialOrders };
  }

  private buildSystemPrompt(docCounts: { quotes: number; materialOrders: number }): string {
    return `אתה מנהל שיחת onboarding עבור עסק חדש שמצטרף למערכת ניהול עבודה. תפקידך לאסוף בהדרגה, בשיחה טבעית וידידותית בעברית:

1. פרטי חברה בסיסיים (שם רשמי, ח.פ/עוסק מורשה, סוג העסק - חברת אחזקה/נגרייה/חנות קמעונאית, מייל ליצירת קשר) - קרא ל-record_company_info כשיש לך את כולם.
2. אנשי צוות - לפחות בעל העסק עצמו, עם תפקיד ומייל - קרא ל-add_team_member לכל אחד.
3. "קודי סגירה" / קודי מחירון - פעולות שהעסק מתמחר בנפרד (למשל "החלפת פילטר - 80 ש"ח") - קרא ל-add_price_code לכל אחד שמוזכר.
4. סוגי עבודה (למשל "התקנת מזגן") - אילו שדות רלוונטיים ואילו פעולות/checklist נדרשות לסגירה - קרא ל-add_job_type.
5. אחרי כל אלה, בקש מהמשתמש להעלות עד 10 הצעות מחיר ישנות ועד 10 הזמנות חומרים אחרונות (דרך כפתור ההעלאה בממשק - אתה לא מקבל את הקבצים ישירות בצ'אט, רק מציין שזה הזמן להעלות).
   סטטוס נוכחי של העלאות: ${docCounts.quotes} הצעות מחיר, ${docCounts.materialOrders} הזמנות חומרים הועלו עד כה.
6. כשיש לך פרטי חברה מלאים, לפחות איש צוות אחד, ולפחות סוג עבודה אחד - קרא ל-ready_to_finalize עם סיכום קצר. אל תמהר לקרוא לזה לפני שיש מספיק מידע, אבל גם אל תעכב מעבר לצורך אם המשתמש כבר ענה על הכל.

חשוב: תמיד תשאל שאלה אחת בכל פעם, לא רשימה ארוכה של שאלות יחד. תהיה טבעי וקצר.`;
  }

  async validateSession(sessionId: string, sessionSecret: string) {
    const session = await this.prisma.onboardingSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Onboarding session not found');

    const provided = Buffer.from(sessionSecret);
    const actual = Buffer.from(session.sessionSecret);
    const valid = provided.length === actual.length && crypto.timingSafeEqual(provided, actual);
    if (!valid) throw new ForbiddenException('Invalid session secret');

    return session;
  }
}

```

## `src/modules/onboarding/pdf-text.util.ts`

```typescript
import { PDFParse } from 'pdf-parse';

// חילוץ טקסט גולמי מ-PDF - שלב ראשון לפני שה-LLM מנסה להבין מבנה
// (שורות פריטים/מחירים). לא OCR - אם המסמך הוא סריקה של תמונה בלי
// שכבת טקסט, זה יחזיר מחרוזת ריקה. TODO עתידי: fallback ל-OCR
// (למשל Tesseract) למסמכים סרוקים - לא ממומש ב-MVP.
//
// הערה: pdf-parse v2 שינה API לגמרי מול v1 (מ-callback/function בודד
// ל-class עם getText() אסינכרוני) - חשוב לוודא מול הגרסה המותקנת
// בפועל (package.json) שה-API הזה עדיין תואם, ולא להניח קוד לדוגמה
// ישן מהאינטרנט.
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

```

## `src/modules/onboarding/slugify.util.ts`

```typescript
// הופך שם חברה חופשי (עברית/אנגלית) ל-subdomain תקין. עברית לא
// יכולה להישאר ב-subdomain (DNS/URL) - מוסרת, ונשען על fallback
// גנרי אם לא נשאר כלום. ייחודיות (בדיקה מול Tenant קיימים) מטופלת
// בשכבה שקוראת לפונקציה הזו (onboarding-finalize.service.ts), לא כאן.
export function slugify(input: string): string {
  const ascii = input
    .toLowerCase()
    .replace(/[^\x00-\x7F]/g, '') // הסרת תווים לא-ASCII (עברית וכו')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return ascii || `tenant-${Date.now().toString(36)}`;
}

```

## `src/modules/prisma/prisma.module.ts`

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

```

## `src/modules/prisma/prisma.service.ts`

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

```

## `src/modules/scheduling/scheduling.controller.ts`

```typescript
import { Controller, Post, Param, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { SchedulingService } from './scheduling.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// endpoint ידני - שימושי כשה-auto-assign בסגירת האירוע נכשל
// (למשל: אף טכנאי לא היה זמין ברגע היצירה) ומנהל רוצה לנסות שוב,
// או לשייך מחדש ידנית אחרי ששינה זמינות טכנאי.
@UseGuards(JwtAuthGuard)
@Controller('scheduling')
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Post(':taskId/assign')
  async assign(@Req() req: Request, @Param('taskId') taskId: string) {
    const result = await this.schedulingService.assignTask(req.tenantId!, taskId);
    if (!result.assigned) {
      throw new BadRequestException(result.reason ?? 'Could not assign task');
    }
    return result;
  }
}

```

## `src/modules/scheduling/scheduling.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { SchedulingController } from './scheduling.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SchedulingController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}

```

## `src/modules/scheduling/scheduling.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { haversineDistanceKm } from '../../common/geo.util';

// ============================================================
// Scheduling Agent (מסמך הארכיטקטורה, סעיף 6.2).
// לא רלוונטי לכל טננט: קמעונאות לא מפעילה את המודול הזה בכלל
// (enabledModules ב-TenantConfig לא כולל "scheduling"), ולכן
// handleTaskCreated פשוט חוזר מוקדם עבור טננטים כאלה.
//
// אין כאן LLM כלל - רק אלגוריתם ניקוד דטרמיניסטי:
//   score = skillWeight*skillMatch + distanceWeight*distanceScore + loadWeight*loadScore
// כפי שתוכנן. requiredSkill הוא hard filter (לא soft) - טכנאי בלי
// ההתמחות הנדרשת לא נכנס בכלל להשוואה, לא רק מקבל ניקוד נמוך.
// ============================================================

interface SchedulingWeights {
  skillWeight: number;
  distanceWeight: number;
  loadWeight: number;
}

// טיפוסים מקומיים מפורשים לשדות שבהם אנחנו משתמשים - לא תלוי בהאם
// Prisma Client נוצר במלואו בסביבת ההרצה (ראו הערה ב-README על
// מגבלת רשת ב-sandbox של הפיתוח - לא רלוונטי לסביבה האמיתית שלך,
// אבל טיפוסים מפורשים הם ממילא נוהג טוב יותר כאן).
interface CandidateUser {
  id: string;
  skills: string[];
  homeLat: number | null;
  homeLng: number | null;
}

interface LoadCount {
  assignedToUserId: string | null;
  _count: { _all: number };
}

const DEFAULT_WEIGHTS: SchedulingWeights = {
  skillWeight: 0.5,
  distanceWeight: 0.3,
  loadWeight: 0.2,
};

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent('task.created')
  async handleTaskCreated(payload: { tenantId: string; taskId: string; source: string }) {
    const result = await this.assignTask(payload.tenantId, payload.taskId);
    if (!result.assigned) {
      this.logger.log(`Task ${payload.taskId} not auto-assigned: ${result.reason}`);
    }
  }

  // ניתן לקריאה גם ידנית (endpoint) לצורך שיוך מחדש - לא רק כתגובה לאירוע
  async assignTask(tenantId: string, taskId: string): Promise<{ assigned: boolean; userId?: string; reason?: string }> {
    const config = await this.prisma.tenantConfig.findUnique({ where: { tenantId } });
    const enabledModules = (config?.enabledModules as string[] | undefined) ?? [];
    if (!enabledModules.includes('scheduling')) {
      return { assigned: false, reason: 'scheduling module not enabled for this tenant (vertical)' };
    }

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { jobTypeTemplate: true },
    });
    if (!task) return { assigned: false, reason: 'task not found' };

    const requiredSkill = task.jobTypeTemplate?.requiredSkill ?? null;

    const candidates: CandidateUser[] = await this.prisma.user.findMany({
      where: { tenantId, role: 'FIELD', isActive: true },
    });
    if (candidates.length === 0) {
      return { assigned: false, reason: 'no active field technicians' };
    }

    const eligible: CandidateUser[] = requiredSkill
      ? candidates.filter((c) => c.skills.includes(requiredSkill))
      : candidates;

    if (eligible.length === 0) {
      return { assigned: false, reason: `no technician with required skill "${requiredSkill}"` };
    }

    const weights: SchedulingWeights =
      (config?.schedulingWeights as unknown as SchedulingWeights) ?? DEFAULT_WEIGHTS;

    // עומס נוכחי לכל מועמד - כמה משימות פתוחות/בביצוע כבר משויכות לו
    const loadCounts: LoadCount[] = await this.prisma.task.groupBy({
      by: ['assignedToUserId'],
      where: {
        tenantId,
        status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
        assignedToUserId: { in: eligible.map((c) => c.id) },
      },
      _count: { _all: true },
    }) as unknown as LoadCount[];
    const loadMap = new Map<string | null, number>(
      loadCounts.map((l) => [l.assignedToUserId, l._count._all]),
    );

    let best: { userId: string; score: number } | null = null;

    for (const candidate of eligible) {
      const skillMatch = requiredSkill ? 1 : 0.5; // אין דרישת סקיל -> לא מבדיל בין מועמדים בציר הזה

      let distanceScore = 0.5; // ברירת מחדל אם חסר מיקום לאחד הצדדים
      if (
        task.locationLat != null && task.locationLng != null &&
        candidate.homeLat != null && candidate.homeLng != null
      ) {
        const distanceKm = haversineDistanceKm(
          task.locationLat, task.locationLng,
          candidate.homeLat, candidate.homeLng,
        );
        distanceScore = 1 / (1 + distanceKm);
      }

      const load: number = loadMap.get(candidate.id) ?? 0;
      const loadScore = 1 / (1 + load);

      const score =
        weights.skillWeight * skillMatch +
        weights.distanceWeight * distanceScore +
        weights.loadWeight * loadScore;

      if (!best || score > best.score) {
        best = { userId: candidate.id, score };
      }
    }

    if (!best) return { assigned: false, reason: 'no candidate scored' };

    await this.prisma.task.update({
      where: { id: taskId },
      data: { assignedToUserId: best.userId, status: 'ASSIGNED' },
    });

    this.events.emit('task.assigned', { tenantId, taskId, userId: best.userId });
    return { assigned: true, userId: best.userId };
  }
}

```

## `src/modules/tasks/tasks.controller.ts`

```typescript
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  findAll(@Req() req: Request, @Query('status') status?: string) {
    return this.tasksService.findAll(req.tenantId!, { status });
  }

  @Post('manual')
  createManual(@Req() req: Request, @Body() body: any) {
    return this.tasksService.createManual(req.tenantId!, body);
  }

  @Post(':id/close')
  close(@Req() req: Request, @Param('id') id: string, @Body('checklist') checklist: unknown) {
    return this.tasksService.close(req.tenantId!, id, checklist);
  }
}

```

## `src/modules/tasks/tasks.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}

```

## `src/modules/tasks/tasks.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';

// ============================================================
// זהו ה-Intake module + ליבת ה-Task lifecycle (מסמך הארכיטקטורה,
// סעיפים 5+6.1). שני מסלולי היצירה (מייל/ידני) מובילים לאותה
// createManual/createFromEmail -> אותה טבלת Task.
//
// Scheduling/Invoicing/Comms modules (עדיין לא נבנו בשלד הזה)
// יאזינו לאירועים 'task.created' ו-'task.closed' דרך EventEmitter2,
// באותה תבנית בדיוק כמו כאן - ראו README.md.
// ============================================================

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  findAll(tenantId: string, filters: { status?: string } = {}) {
    return this.prisma.task.findMany({
      where: { tenantId, ...(filters.status ? { status: filters.status as any } : {}) },
      include: { customer: true, assignedTo: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // עוזר משותף לשני מסלולי היצירה - שולף checklist/priority ברירת מחדל
  // מהתבנית אם יש התאמה. גם EMAIL וגם MANUAL עוברים דרך אותה לוגיקה,
  // כי זו אותה ישות Task בדיוק (מסמך הארכיטקטורה, סעיף 5).
  private async resolveTemplateDefaults(tenantId: string, jobTypeTemplateId: string | null) {
    if (!jobTypeTemplateId) return { checklist: null, priority: 2 };
    const template = await this.prisma.jobTypeTemplate.findFirst({
      where: { id: jobTypeTemplateId, tenantId },
    });
    if (!template) throw new Error('JobTypeTemplate not found for this tenant');
    return { checklist: template.defaultChecklist, priority: template.defaultPriority };
  }

  // ---- מסלול ב': פתיחה ידנית (JobTypeTemplate) - ראו סעיף 6.1 ----
  async createManual(tenantId: string, params: {
    customerId: string;
    jobTypeTemplateId: string;
    title: string;
    customFields?: Record<string, unknown>;
  }) {
    const { checklist, priority } = await this.resolveTemplateDefaults(tenantId, params.jobTypeTemplateId);

    const task = await this.prisma.task.create({
      data: {
        tenantId,
        customerId: params.customerId,
        jobTypeTemplateId: params.jobTypeTemplateId,
        title: params.title,
        source: 'MANUAL',
        priority,
        checklist: checklist as any,
        customFields: params.customFields as any,
      },
    });

    this.events.emit('task.created', { tenantId, taskId: task.id, source: 'MANUAL' });
    return task;
  }

  // ---- מסלול א': ממייל. jobTypeTemplateId/priority כאן מגיעים מה-
  // IntakeExtractionService (LLM) - null אם הביטחון נמוך מדי, ואז
  // המשימה נשארת "גולמית" לבדיקה ידנית (ראו intake-extraction.service.ts) ----
  async createFromEmail(tenantId: string, params: {
    customerId: string;
    title: string;
    description?: string;
    sourceEmailId: string;
    jobTypeTemplateId?: string | null;
    extractedFields?: Record<string, unknown>;
    priority?: number;
  }) {
    const { checklist, priority: defaultPriority } = await this.resolveTemplateDefaults(
      tenantId, params.jobTypeTemplateId ?? null,
    );

    const task = await this.prisma.task.create({
      data: {
        tenantId,
        customerId: params.customerId,
        jobTypeTemplateId: params.jobTypeTemplateId ?? null,
        title: params.title,
        description: params.description,
        source: 'EMAIL',
        sourceEmailId: params.sourceEmailId,
        priority: params.priority ?? defaultPriority,
        checklist: checklist as any,
        customFields: params.extractedFields as any,
      },
    });

    this.events.emit('task.created', { tenantId, taskId: task.id, source: 'EMAIL' });
    return task;
  }

  // ---- סגירת משימה - מטריגר לכל שאר האג'נטים (6א/6ב/6ג במסמך הארכיטקטורה) ----
  async close(tenantId: string, taskId: string, finalChecklist: unknown) {
    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'CLOSED', closedAt: new Date(), checklist: finalChecklist as any },
    });

    // Comms module, Invoicing module וכו' יאזינו לאירוע הזה - לא קריאה ישירה
    this.events.emit('task.closed', { tenantId, taskId: task.id });
    return task;
  }
}

```

## `src/modules/tenants/tenants.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';

@Module({
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}

```

## `src/modules/tenants/tenants.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  findBySubdomain(subdomain: string) {
    return this.prisma.tenant.findUnique({
      where: { subdomain },
      include: { config: true },
    });
  }

  // TODO: createTenant() - יצירת טננט חדש + TenantConfig ברירת מחדל
  // לפי vertical (MAINTENANCE/CARPENTRY/RETAIL). ראו db-schema.md
  // ל-enabledModules המומלץ לכל vertical.
}

```

## `frontend-pwa/.gitkeep`

```

```

## `frontend-web/.gitkeep`

```

```

