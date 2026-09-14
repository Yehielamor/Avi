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
