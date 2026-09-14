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
