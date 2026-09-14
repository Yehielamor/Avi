# ארכיטקטורה

## הצורה: מונוליט מודולרי

תהליך אחד, מסד נתונים אחד, פריסה אחת. בפנים — מודולים עם גבולות אמיתיים.

**למה לא מיקרו-שירותים:** העסקים כאן הם בעלי מקצוע וחנויות. העומס נמדד
בעשרות עד מאות משימות ביום לטננט. מיקרו-שירותים היו מוסיפים עלות תפעול
של סדר גודל בלי לפתור שום בעיה שקיימת. הגבולות המודולריים כאן מאפשרים
לחלץ שירות בעתיד אם אי פעם יהיה צורך אמיתי.

```
src/
  main.ts              נקודת כניסה — helmet, CORS, validation, shutdown
  app.module.ts        חיווט: config, logging, throttling, events, מודולים
  config/              אימות סביבה (zod) — נכשל בעלייה, לא בבקשה הראשונה
  database/            PrismaService + forTenant + AsyncLocalStorage
  common/              middleware, guards, filters, decorators, utils
  health/              /health/live ו-/health/ready
  modules/
    tenants/             ניהול טננטים
    auth/                התחברות, JWT, RolesGuard
    customers/           לקוחות
    job-type-templates/  תבניות "סוג עבודה"
    tasks/               ליבת מחזור חיי המשימה
    scheduling/          שיוך לטכנאי (skill + מרחק + עומס). ללא LLM.
    integrations/        Connector Framework — OAuth, Gmail, Drive
    intake/              חילוץ LLM: טקסט חופשי → משימה מובנית
    invoicing/           checklist → מחירון → PDF → Drive
    comms/               מיילים אוטומטיים ללקוח
    inventory/           ניכוי מלאי + התראות חוסר
    onboarding/          צ'אט הקמת עסק חדש
```

---

## תקשורת בין מודולים

מודולים **לא קוראים זה לזה ישירות** בזרימה העסקית. הם מתקשרים באירועים.

```
TasksService.close()
    │
    ├─ כותב טרנזקציונית: status=CLOSED  +  OutboxEvent('task.closed')
    │
    └─ (אחרי commit) OutboxWorker → BullMQ
                                      ├─ InventoryService   ניכוי מלאי
                                      ├─ InvoicingService   שורות חיוב
                                      └─ CommsService       מייל ללקוח
```

הוספת התנהגות חדשה בסגירת משימה = מודול חדש שמאזין. אין עריכה של `TasksService`.

### למה outbox ולא `EventEmitter2.emit()`

זו הייתה התבנית הקודמת, והיא שברה את המערכת בשתי דרכים:

**1. מאזין שנדחה הפיל את התהליך.**
`emit()` לא ממתין ולא תופס. מאזין `async` שנדחה הופך ל-unhandled rejection,
ו-Node ≥15 מסיים את התהליך. תקלת Postgres אחת בסגירת משימה אחת הפילה את
ה-API **לכל הטננטים** — אחרי שה-200 כבר נשלח ללקוח.

**2. אין אטומיות בין השינוי לתופעות הלוואי.**
המשימה נסגרה, המייל לא נשלח — או ההפך. שום דבר לא רשם שהניכוי כבר בוצע,
אז סגירה כפולה ניכתה פעמיים.

ה-outbox פותר את שניהם: האירוע נכתב **באותה טרנזקציה** שמשנה את המצב העסקי.
או ששניהם קורים או שאף אחד. עובד נפרד קורא, שולח לתור, ומסמן. כשל = retry
עם backoff; אחרי מכסה — `DEAD` עם התראה. אין "נרשם ונזרק".

### מה רץ איפה

| | HTTP handler | עובד תור |
|---|---|---|
| קריאה/כתיבה ל-DB | ✅ | ✅ |
| קריאת LLM | ❌ | ✅ |
| Google API | ❌ | ✅ |
| יצירת PDF | ❌ | ✅ |
| שליחת מייל | ❌ | ✅ |

הכלל: **בקשת HTTP לא מחכה לצד שלישי.** הגרסה הקודמת הפרה את זה בכל מקום —
`POST /integrations/gmail/sync` עשה עד 10 קריאות Gmail סדרתיות, כל אחת ואחריה
קריאת Anthropic מלאה, בתוך בקשה אחת. בקשה של דקות, בלי timeout, ש-proxy
היה קוטע ב-504 בזמן שמשימות המשיכו להיווצר.

---

## הפשטת המחברים

```ts
interface Connector {
  readonly provider: IntegrationProvider;
  isHealthy(): Promise<boolean>;
}
interface EmailConnector extends Connector {
  fetchUnprocessed(cursor?: string): Promise<{ messages: InboundMessage[]; nextCursor?: string }>;
  send(message: OutboundMessage): Promise<void>;
}
interface StorageConnector extends Connector {
  upload(file: FileUpload): Promise<{ fileId: string }>;
}
```

`InvoicingService` ו-`CommsService` תלויים ב-`IntegrationsService.getConnector()`
ולא יודעים דבר על googleapis או OAuth. החלפת Gmail ב-Outlook היא מחלקה חדשה
שמממשת `EmailConnector`. זה אחד הדברים שהשלד המקורי עשה נכון.

---

## הפשטת ה-LLM

שלוש נקודות קריאה בלבד, כולן באותה תבנית:

```
קלט לא-נאמן → חיתוך לאורך מקסימלי → prompt → תשובה → סכמת Zod
     → בדיקת מזהים מול allowlist → כתיבה ל-DB
```

**עיקרון הליבה: ה-LLM מציע, קוד דטרמיניסטי מבצע.**
ב-onboarding, המודל קורא ל-tools שרק *אוספים* עובדות לתוך הסשן.
`onboarding-finalize.service.ts` הוא זה שיוצר את הטננט — קוד רגיל, לא המודל.

הסכנה כאן ספציפית: `intake` מזין גוף מייל של **זר** לתוך מודל שמפיק נתונים
מובנים. כל שדה שהמודל מחזיר הוא בשליטת התוקף עד שהוא מאומת. ראו
[קונבנציות §9](20-backend-conventions.md).

---

## זרימות מרכזיות

### מייל נכנס → משימה

```
Scheduler (כל 3 דק')
  → GmailConnector.fetchUnprocessed(cursor)   עימוד מלא, watermark
  → לכל הודעה, ב-try/catch משלה:              מייל רעיל אחד לא חוסם את השאר
      parse (charset + quoted-printable)
      LLM extraction → Zod → allowlist של templates
      upsert לקוח לפי אימייל מדויק
      create Task  (@@unique([tenantId, sourceEmailId]) מונע כפילות)
      OutboxEvent('task.created')
  → עדכון cursor
```

### סגירת משימה

```
POST /v1/tasks/:id/close
  → forTenant(tenantId):
      updateMany({ where: { id, tenantId, status: { not: 'CLOSED' } } })
      count === 0 ⇒ כבר סגורה, יציאה שקטה     ← אידמפוטנטיות
      OutboxEvent('task.closed')
  → 200

עובד:
  InventoryService  → StockMovement (unique על taskId+item+reason)
  InvoicingService  → InvoiceLineItem (unique על taskId+priceCode)
  CommsService      → מייל ללקוח
```

כל אחד מהשלושה נכשל ומנסה שוב באופן עצמאי. אף אחד לא יכול להפיל את האחרים
או את התהליך.
