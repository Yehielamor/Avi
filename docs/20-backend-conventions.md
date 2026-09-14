# קונבנציות שכבת השרת

מסמך מחייב. כל קוד חדש או משוכתב ב-`project-skeleton/src/` עומד בכללים כאן.
הרציונל לכל כלל נמצא ב-[דוח הביקורת](10-audit-findings.md) — אלה אינם העדפות סגנון, כל אחד מהם נובע מבאג שנמצא בפועל.

---

## 1. גישה לנתונים — `forTenant` ותו לא

```ts
// ✅ נכון
const tasks = await this.prisma.forTenant(tenantId, (tx) =>
  tx.task.findMany({ where: { status: 'NEW' } }),
);

// ❌ אסור — יזרוק "tenant context is not set"
const tasks = await this.prisma.task.findMany({ where: { tenantId } });
```

`PrismaService.forTenant(tenantId, fn)` פותח טרנזקציה, קובע `app.current_tenant_id`
בתוכה, ומריץ את `fn` עם לקוח הטרנזקציה. ה-RLS ב-Postgres אוכף את הבידוד.

**כללים:**

- `tenantId` מגיע תמיד מ-`req.tenantId` (שנקבע ב-middleware מה-subdomain) — **לעולם לא מגוף הבקשה, מ-params או מ-query.**
- **אין קריאות רשת בתוך `fn`.** הטרנזקציה מחזיקה חיבור DB. קריאת LLM או Google בפנים = חיבור תפוס לדקות.
- שאילתה שרצה מחוץ ל-`forTenant` **זורקת**. זו התנהגות מכוונת: כשל שקט (אפס שורות) נראה בדיוק כמו "אין נתונים" ושורד שנים.
- `prisma.untenanted` קיים רק לטבלאות שאין להן `tenantId` מעצם טבען (`onboarding_*`). כל שימוש אחר הוא באג.

### 1.1 סינון `tenantId` נשאר בקוד גם כשיש RLS

ה-RLS הוא **רשת ביטחון, לא תחליף**. שאילתה עדיין נכתבת עם `tenantId` מפורש היכן שהוא רלוונטי.
הסיבה: `where: { id }` ללא `tenantId` על שורה של טננט אחר מחזיר `null` במקום `NotFoundException`
ברור — ה-RLS מונע את הדליפה אבל לא נותן הודעת שגיאה טובה.

```ts
// ✅ שתי השכבות
await this.prisma.forTenant(tenantId, async (tx) => {
  const task = await tx.task.findFirst({ where: { id: taskId, tenantId } });
  if (!task) throw new NotFoundException('Task not found');
  ...
});
```

---

## 2. גבולות HTTP — DTO לכל body

`ValidationPipe` גלובלי מוגדר `whitelist: true, forbidNonWhitelisted: true`.
שדה שאינו ב-DTO גורם ל-400.

```ts
// ❌ אסור
@Post()
create(@Body() body: any) { ... }

// ✅ נכון
export class CreateTaskDto {
  @IsUUID() customerId!: string;
  @IsString() @Length(1, 200) title!: string;
  @IsOptional() @IsString() @Length(0, 5000) description?: string;
  @IsOptional() @IsInt() @Min(1) @Max(3) priority?: number;
}
```

**אסור לחלוטין:** לקבל `role`, `tenantId`, `isActive`, או כל שדה הרשאות מגוף הבקשה.
`POST /auth/register` עם `{"role":"OWNER"}` היה הפרצה המקורית.

---

## 3. הרשאות — התפקיד נאכף, לא רק נחתם

`JwtAuthGuard` גלובלי. נקודות פתוחות מסומנות ב-`@Public()` במפורש.
הכיוון הזה מכוון: שכחת סימון מייצרת 401, לא דליפה.

```ts
@Roles(UserRole.OWNER, UserRole.MANAGER)
@Post('invoices/generate')
generate(...) { ... }
```

`UserRole` היה enum דקורטיבי — הוא נחתם ל-JWT ומעולם לא נקרא. טכנאי `FIELD`
יכול היה לנתק את חשבון Google של העסק ולהפיק חשבוניות.

---

## 4. כסף — `Prisma.Decimal` בלבד

```ts
// ❌ אסור
const total = items.reduce((sum, i) => sum + Number(i.price), 0);

// ✅ נכון
const total = items.reduce((sum, i) => sum.add(i.price), new Prisma.Decimal(0));
```

`Number()` על `Decimal` מכניס שגיאת עיגול בינארית. בחשבונית של 300 שורות,
`totalAmount` לא יהיה שווה ל-`SUM(amount)` של שורותיו שלו.

---

## 5. זמנים — UTC ב-DB, `Timestamptz` בסכימה

כל עמודת `DateTime` מסומנת `@db.Timestamptz(3)`. ברירת המחדל של Prisma
היא `timestamp` **ללא** אזור זמן — ולעסק ישראלי עם שעון קיץ, משימה שנסגרה
ב-01:00 מקומי ב-1 לחודש נופלת מחוץ לתקופת החיוב ונשארת לא-מחויבת לצמיתות.

חישובי גבולות תקופה נעשים באזור הזמן של הטננט, לא ב-UTC ולא באזור של השרת.

---

## 6. אידמפוטנטיות — נאכפת ב-DB

פעולה שמשנה מצב ויכולה להישלח פעמיים (לחיצה כפולה, retry של קליינט, cron חופף)
חייבת ערובה ברמת ה-DB, לא בדיקת `findFirst` לפני כתיבה.

| פעולה | הערובה |
|---|---|
| סגירת משימה → ניכוי מלאי | `@@unique([taskId, inventoryItemId, reason])` על `StockMovement` |
| מייל → משימה | `@@unique([tenantId, sourceEmailId])` על `Task` |
| חיוב שורת עבודה | `@@unique([taskId, priceCode])` על `InvoiceLineItem` |
| POST כללי | טבלת `IdempotencyKey` + כותרת `Idempotency-Key` |

`findFirst` ואז `create` הוא race. שתי בקשות במקביל יעברו שתיהן את הבדיקה.

בנוסף, מעבר מצב נכתב עם תנאי:

```ts
// ✅ מחזיר count: 0 אם כבר סגורה — במקום לפלוט אירוע שוב
const { count } = await tx.task.updateMany({
  where: { id: taskId, tenantId, status: { not: 'CLOSED' } },
  data: { status: 'CLOSED', closedAt: new Date() },
});
if (count === 0) return { alreadyClosed: true };
```

---

## 7. עבודה אסינכרונית — outbox, לא `emit` ישיר

```ts
// ❌ אסור — מאזין async שנדחה מפיל את התהליך כולו
this.events.emit('task.closed', payload);

// ✅ נכון — נכתב באותה טרנזקציה, נשלח אחרי commit
await tx.outboxEvent.create({ data: { tenantId, eventName: 'task.closed', payload } });
```

`EventEmitter2.emit()` לא ממתין ולא תופס. מאזין `async` שנדחה הופך ל-unhandled
rejection, ו-Node מפיל את התהליך — לכל הטננטים, אחרי שה-200 כבר נשלח.

`OutboxEvent` נכתב טרנזקציונית עם השינוי העסקי. עובד נפרד קורא, שולח ל-BullMQ,
ומסמן. כשל = retry עם backoff, ואחרי מכסה — `DEAD` עם התראה. אין "נרשם ונזרק".

**כל קריאה חיצונית (LLM, Google, שליחת מייל, PDF) רצה בעובד, לא ב-HTTP handler.**

---

## 8. שגיאות — לא בולעים, לא מדליפים

```ts
// ❌ אסור — "rate limited", "מפתח לא תקין" ו-"המודל החזיר טקסט" נראים זהים
try { ... } catch { return EMPTY_RESULT; }

// ✅ נכון
try { ... } catch (err) {
  if (isRateLimit(err)) throw new RetryableError('LLM rate limited', { cause: err });
  this.logger.error({ err, tenantId, purpose }, 'LLM extraction failed');
  throw new LlmExtractionError('extraction failed', { cause: err });
}
```

`catch` ריק אסור. `useUnknownInCatchVariables` דולק, אז `err` הוא `unknown` — צריך לצמצם טיפוס.

---

## 9. קלט LLM — לא נאמן, לא חסום בגודל

1. **כל פלט LLM עובר סכמת Zod לפני שהוא נוגע ב-DB.** `as unknown as X` אסור.
2. **מזהה שהמודל מחזיר נבדק מול רשימה מותרת.** `matchedTemplateId` לא נבדק, ומייל אחד עם הזרקה השבית לצמיתות את קליטת המיילים של הטננט.
3. **קלט נחתך ל-`LLM_MAX_INPUT_CHARS`.** גוף מייל לא חסום = בקשה של מיליוני טוקנים.
4. **שדות שהמודל שולט בהם לא מקבלים משמעות מערכתית ללא בדיקה.** `priority` שנקבע ע"י המודל = מייל מוזרק שקופץ בתור.
5. **כל קריאה נרשמת ל-`LlmUsage`** ונבדקת מול תקציב הטננט לפני השליחה.

---

## 10. אינטגרציות חיצוניות

- כל קריאה עם timeout מפורש ו-retry עם backoff אקספוננציאלי.
- `401`/`invalid_grant` → `IntegrationStatus.EXPIRED` + `lastError`. לא 500 אטום לנצח.
- רענון טוקן נשמר עם `await`. הגרסה הקודמת עשתה fire-and-forget ושמרה רק את ה-`access_token`, כך שרוטציה של refresh token הרגה את האינטגרציה.
- Gmail: עימוד עם `nextPageToken`, watermark ב-`lastSyncedAt`. `is:unread` ללא עימוד מאבד מיילים ישנים לצמיתות.
- כתובת אימייל מ-header חיצוני **מאומתת** לפני שהיא הופכת ל-`To:` יוצא, ו-CRLF מסונן.

---

## 11. בדיקות

| סוג | מיקום | מול מה |
|---|---|---|
| יחידה | `src/**/*.spec.ts` | mocks |
| אינטגרציה | `test/integration/*.spec.ts` | Postgres אמיתי |

**חובה:** כל מודול עם גישה לנתוני טננט מקבל בדיקת אינטגרציה שמוכיחה שטננט א׳
לא יכול לקרוא או לכתוב נתוני טננט ב׳ — דרך ה-API, לא רק דרך ה-DB.

`new Anthropic({...})` בקונסטרוקטור הפך שלושה מסלולים לבלתי ניתנים לבדיקה ללא
מפתחות חיים. לקוחות חיצוניים מוזרקים כ-provider.

---

## 12. רשימת בדיקה לפני merge

- [ ] כל שאילתה עוברת דרך `forTenant`
- [ ] כל `@Body()` הוא DTO עם `class-validator`
- [ ] אין `any` בחתימה ציבורית
- [ ] פעולות שמשנות מצב אידמפוטנטיות ברמת ה-DB
- [ ] עבודה ארוכה ב-outbox, לא ב-handler
- [ ] טבלה חדשה עם `tenantId` נוספה למיגרציית ה-RLS **ולרשימה ב-`test/integration/rls.spec.ts`**
- [ ] כסף ב-`Decimal`, זמנים ב-`Timestamptz`
- [ ] `npm run ci` עובר
