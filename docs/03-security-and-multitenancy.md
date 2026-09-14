# בידוד טננטים ואבטחה

המסמך החשוב ביותר בפרויקט. אם אתה נוגע בנתוני טננט, קרא אותו עד הסוף.

---

## למה זה קיים

טננט אחד = עסק אחד. כל העסקים חולקים מסד נתונים אחד. אם הבידוד נכשל,
עסק א׳ רואה את הלקוחות, המחירים והעבודות של עסק ב׳. זה לא באג — זו סגירת החברה.

הביקורת מצאה שהבידוד **לא עבד בכלל**. לא "היה חלש" — לא היה קיים.
המסמך הזה מתאר את מה שהוחלף, ולמה כל חלק בנוי כך.

---

## איך זה נכשל קודם

היו שתי שכבות מתוכננות. שתיהן היו לא-פעילות.

### שכבה 1 — סינון בקוד

רוב השאילתות סיננו `tenantId` נכון. שלוש לא:

```ts
// tasks.service.ts — close()
await this.prisma.task.update({ where: { id: taskId } });  // ללא tenantId
```

תוקף נרשם בטננט משלו, שולח מזהה משימה של הקורבן, ומקבל בתשובה את
השורה המלאה: כותרת, תיאור, שדות מותאמים, מזהה לקוח. בנוסף דרס את
ה-checklist. אותה תבנית ב-`comms.service.ts` — שם היא גרועה יותר: המערכת
רינדרה את נתוני הקורבן למייל ושלחה אותו **דרך חשבון ה-Gmail של התוקף**.
התוקף קרא את המידע מתיקיית ה-Sent שלו.

### שכבה 2 — RLS

```sql
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));
```

נראה נכון. לא עשה כלום. **שתי סיבות בלתי תלויות, כל אחת מספיקה:**

**א. האפליקציה הייתה בעלת הטבלאות.**
`docker-compose.yml` יצר את ה-DB עם `POSTGRES_USER: app`, ו-Prisma יצר
את הטבלאות באותו תפקיד. PostgreSQL **פוטר את בעל הטבלה מה-policies שלו**
אלא אם הוגדר `FORCE ROW LEVEL SECURITY`. הוא לא הוגדר. כל ה-policies
היו קוד מת.

**ב. הקונטקסט נקבע על חיבור אחר מזה שהריץ את השאילתות.**

```ts
await this.prisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenant.id}'`);
```

`PrismaClient` הוא pooled. הקריאה הזו, מחוץ לטרנזקציה, מוציאה חיבור
שרירותי, מריצה `SET` ברמת **session**, ומחזירה אותו. השאילתות אחריה
מקבלות חיבורים אחרים.

- **דליפה:** חיבור חוזר ל-pool עם המשתנה של טננט א׳ עליו. הבקשה הבאה של
  טננט ב׳ מקבלת אותו ורואה את נתוני א׳. RLS שנכשל *פתוח אל הטננט הלא נכון* —
  גרוע מבלי RLS.
- **שבירה:** ה-SET על חיבור אחד, השאילתה על אחר, אפס שורות למשתמש לגיטימי.

ההערה בקוד תלתה את זה ב-PgBouncer. זה היה שגוי: ה-pool הפנימי של Prisma
מספיק.

---

## המודל החדש

### שכבה 0 — שני תפקידי DB

```
craftmind_migrator   בעל הסכימה. מריץ מיגרציות ו-seed. לעולם לא מקבל בקשת HTTP.
craftmind_app        זהות זמן-הריצה. לא בעלים ⇒ RLS חל עליו.
```

שניהם `NOSUPERUSER NOBYPASSRLS` במפורש. **אין תפקיד באפליקציה שיכול לעקוף
בידוד — כולל בטעות.**

נוצרים ב-`docker/postgres/initdb/00-roles.sh`, שרץ פעם אחת באתחול ה-volume.

ההפרדה נאכפת בשתי שכבות בלתי תלויות:

1. `ALTER DEFAULT PRIVILEGES` — ה-app מקבל DML על טבלאות עתידיות, לא DDL.
2. `src/config/env.schema.ts` **דוחה עלייה** אם `DATABASE_URL` מכיל
   `craftmind_migrator`. אי אפשר להצמיד אותו לזמן ריצה בטעות.

### שכבה 1 — RLS עם FORCE ו-WITH CHECK

```sql
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE  ROW LEVEL SECURITY;   -- חל גם על הבעלים

CREATE POLICY tenant_isolation ON customers
  FOR ALL TO craftmind_app
  USING      ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());
```

`USING` מסנן **קריאה**. `WITH CHECK` חוסם **כתיבה**. בלי השני, `INSERT`
עם `tenantId` של טננט אחר עובר בלי התנגדות. בגרסה הישנה היה רק `USING`.

### שכבה 2 — קונטקסט טרנזקציוני

```ts
async forTenant<T>(tenantId: string, fn: (tx: TenantClient) => Promise<T>): Promise<T> {
  return this.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
```

שלושה הבדלים מהותיים:

| | ישן | חדש |
|---|---|---|
| טווח | session — נדבק לחיבור | transaction — מתאפס ב-COMMIT |
| פרמטריזציה | אינטרפולציית מחרוזת | `$1` |
| אטומיות | ה-SET והשאילתה על חיבורים שונים | אותה טרנזקציה, אותו חיבור |

`set_config(..., true)` הוא transaction-local. הוא **לא יכול** לדלוף לבקשה הבאה.

### שכבה 3 — כשל רועש

```sql
CREATE FUNCTION public.current_tenant_id() RETURNS uuid AS $$
BEGIN
  v := current_setting('app.current_tenant_id', true);
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'tenant context is not set' USING ERRCODE = '42501';
  END IF;
  RETURN v::uuid;
END; $$;
```

הבחירה לזרוק ולא להחזיר `NULL` מכוונת. `NULL` היה גורם לכל השוואה להיות
`NULL`, כלומר אפס שורות — כשל שנראה **בדיוק כמו "אין נתונים"** ושורד שנים.
זריקה הופכת "שכחתי קונטקסט" משעתיים דיבוג לשגיאה אחת ברורה.

---

## בעיית התרנגולת והביצה

ה-middleware חייב לתרגם `subdomain → tenantId` לפני שיש קונטקסט. אבל
ל-`tenants` יש policy. בלי פתרון, **כל בקשה נכשלת**.

הפתרון הוא פונקציית `SECURITY DEFINER` מצומצמת במכוון:

```sql
CREATE FUNCTION public.resolve_tenant_by_subdomain(p_subdomain text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$ SELECT id FROM tenants WHERE subdomain = p_subdomain AND "isActive" $$;
```

היא חושפת **עמודה אחת, לפי חיפוש אחד**. הבחירה המתבקשת — תפקיד עם
`BYPASSRLS` — הייתה חושפת את *כל* הטבלאות לקוד שצריך רק את זה.

`SET search_path` הוא חובה בכל `SECURITY DEFINER`: בלעדיו אפשר להטעות
את הפונקציה לקרוא לטבלה מזויפת מסכימה אחרת.

### יצירת טננט חדש

אין עקיפה. הקוד מייצר UUID, קובע אותו כקונטקסט, ואז מבצע `INSERT`:

```ts
const tenantId = randomUUID();
await prisma.forTenant(tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, ... } }));
```

ה-`WITH CHECK (id = current_tenant_id())` מאשר — ה-id תואם את הקונטקסט.

---

## הוכחה

`test/integration/rls.spec.ts` — 47 בדיקות מול Postgres אמיתי, כ-`craftmind_app`:

- מתחבר בתפקיד שאינו בעל הטבלאות
- התפקיד `NOBYPASSRLS` ו-`NOSUPERUSER`
- כל טבלה `relrowsecurity` **וגם** `relforcerowsecurity`
- לכל policy יש `WITH CHECK` ולא רק `USING`
- `WHERE tenantId = <אחר>` מחזיר 0
- `findUnique` על שורה של אחר מחזיר `null`
- `INSERT` עם tenantId של אחר נדחה
- `UPDATE`/`DELETE` על שורות של אחר משפיעים על 0 שורות
- שאילתה ללא קונטקסט **זורקת**
- הקונטקסט מתאפס אחרי הטרנזקציה
- `tenantId` שאינו UUID נדחה לפני שהוא מגיע ל-DB

```bash
npm run test:int
```

**הבדיקה הזו היא השער.** טבלה חדשה עם `tenantId` שלא נוספה למיגרציית
ה-RLS מפילה אותה.

---

## ה-RLS אינו תחליף לסינון בקוד

```ts
// ✅ שתי השכבות
const task = await tx.task.findFirst({ where: { id: taskId, tenantId } });
if (!task) throw new NotFoundException('Task not found');
```

ה-RLS מונע את הדליפה. הסינון המפורש נותן הודעת שגיאה נכונה במקום `null`
מסתורי, ומשאיר את הכוונה גלויה לקורא הבא.

---

## רשימת בדיקה

מוסיף טבלה עם `tenantId`?

1. `@@index([tenantId, ...])` לפי צורת השאילתה בפועל
2. הוסף למערך ב-מיגרציית RLS חדשה (`ENABLE` + `FORCE` + policy עם `WITH CHECK`)
3. הוסף ל-`migrator_maintenance` policy
4. הוסף ל-`TENANT_SCOPED_TABLES` ב-`test/integration/rls.spec.ts`
5. `npm run test:int`
