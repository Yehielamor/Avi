-- =============================================================================
-- Row-Level Security — בידוד טננטים ברמת מסד הנתונים
-- =============================================================================
-- זו מיגרציה, לא קובץ psql ידני. הסיבה: בגרסה הקודמת ה-RLS היה צעד
-- ידני חד-פעמי ("להריץ psql -f rls-policies.sql אחרי המיגרציה"),
-- שגם לא היה אידמפוטנטי. פריסה אחת ששוכחת אותו = DB רב-דיירי ללא
-- שום בידוד, בלי שגיאה בשום מקום. ראו docs/10-audit-findings.md#C12.
--
-- שלושה תיקונים מהותיים מול הגרסה הקודמת:
--
--   1. FORCE ROW LEVEL SECURITY — בלעדיו, בעל הטבלה פטור מה-policies
--      של עצמו. האפליקציה התחברה קודם באותו תפקיד שיצר את הטבלאות,
--      ולכן כל ה-policies היו קוד מת. (#I3)
--
--   2. WITH CHECK, לא רק USING — USING מסנן *קריאה*. בלי WITH CHECK,
--      INSERT/UPDATE עם tenant_id של טננט אחר עובר בלי התנגדות.
--
--   3. הקונטקסט נקבע עם set_config(..., true) בתוך טרנזקציה, לא עם
--      `SET` ברמת session. `SET` על חיבור מ-pool דולף לבקשה הבאה
--      שתקבל את אותו חיבור. (#C1)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- פונקציית הקונטקסט.
--
-- היא *זורקת* כשהקונטקסט לא הוגדר, במקום להחזיר NULL. הבחירה הזו
-- מכוונת: NULL היה גורם לכל השוואה להיות NULL, כלומר אפס שורות —
-- כשל שקט שנראה בדיוק כמו "אין נתונים". זריקה הופכת "שכחתי להגדיר
-- קונטקסט" משעתיים דיבוג לשגיאה אחת ברורה.
--
-- STABLE ולא VOLATILE: הערך קבוע בתוך statement, מה שמאפשר למתכנן
-- להריץ אותה פעם אחת במקום לכל שורה.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v text;
BEGIN
  v := current_setting('app.current_tenant_id', true);

  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'tenant context is not set: app.current_tenant_id is empty'
      USING ERRCODE = '42501',
            HINT = 'Query ran outside PrismaService.forTenant(). See docs/03-security-and-multitenancy.md';
  END IF;

  RETURN v::uuid;
END;
$$;

COMMENT ON FUNCTION public.current_tenant_id() IS
  'מחזירה את הטננט של הטרנזקציה הנוכחית. זורקת אם לא הוגדר — כשל רועש במכוון.';

REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO craftmind_app;

-- -----------------------------------------------------------------------------
-- פתרון בעיית התרנגולת והביצה.
--
-- ה-middleware חייב לתרגם subdomain -> tenant_id *לפני* שהוא יכול
-- להגדיר קונטקסט. אבל ל-tenants יש policy. בלי פתרון, כל בקשה
-- נכשלת. (#C4)
--
-- הפתרון הוא SECURITY DEFINER מצומצמת במכוון: היא חושפת בדיוק עמודה
-- אחת, לפי חיפוש אחד. הבחירה המתבקשת — תפקיד עם BYPASSRLS — הייתה
-- חושפת את *כל* הטבלאות לקוד שצריך רק את זה.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_tenant_by_subdomain(p_subdomain text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.tenants
  WHERE subdomain = p_subdomain AND "isActive" = true;
$$;

COMMENT ON FUNCTION public.resolve_tenant_by_subdomain(text) IS
  'תרגום subdomain->id עבור ה-middleware. SECURITY DEFINER מצומצמת: עמודה אחת בלבד, במקום תפקיד BYPASSRLS.';

REVOKE ALL ON FUNCTION public.resolve_tenant_by_subdomain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tenant_by_subdomain(text) TO craftmind_app;

-- -----------------------------------------------------------------------------
-- הפעלת RLS + policies על כל טבלה עם tenant_id.
--
-- שימו לב ל-DO block: הוא עובר על רשימה מפורשת ולא על "כל טבלה עם
-- עמודת tenantId". הרשימה מפורשת בכוונה — טבלה חדשה חייבת להיכנס
-- לכאן במודע, ובדיקת האינטגרציה נכשלת אם שכחו.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'tenant_configs',
    'job_type_templates',
    'users',
    'customers',
    'tasks',
    'inventory_items',
    'stock_movements',
    'price_list_items',
    'invoices',
    'tenant_integrations',
    'audit_logs',
    'outbox_events',
    'idempotency_keys',
    'llm_usage'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE: חל גם על בעל הטבלה. זה השורה שהופכת את כל הקובץ
    -- ממסמך כוונות להגנה בפועל.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        TO craftmind_app
        USING      ("tenantId" = public.current_tenant_id())
        WITH CHECK ("tenantId" = public.current_tenant_id())
    $f$, t);
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- tenants — מקרה מיוחד: העמודה היא `id`, לא `tenantId`.
--
-- ה-WITH CHECK כאן הוא מה שמאפשר ל-onboarding ליצור טננט: הקוד
-- מייצר UUID, קובע אותו כקונטקסט, ואז מבצע INSERT. ה-id תואם את
-- הקונטקסט, אז ה-policy מאשרת. אין צורך בשום עקיפה.
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.tenants;
CREATE POLICY tenant_isolation ON public.tenants
  FOR ALL
  TO craftmind_app
  USING      (id = public.current_tenant_id())
  WITH CHECK (id = public.current_tenant_id());

-- -----------------------------------------------------------------------------
-- invoice_line_items — אין לו tenantId ישיר; הבידוד עובר דרך החשבונית.
-- ה-EXISTS משתמש באינדקס על invoices.id (PK), לא בסריקה.
-- -----------------------------------------------------------------------------
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.invoice_line_items;
CREATE POLICY tenant_isolation ON public.invoice_line_items
  FOR ALL
  TO craftmind_app
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_line_items."invoiceId"
      AND i."tenantId" = public.current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_line_items."invoiceId"
      AND i."tenantId" = public.current_tenant_id()
  ));

-- -----------------------------------------------------------------------------
-- onboarding_sessions / onboarding_documents — *ללא* RLS, במכוון.
--
-- ל-onboarding אין tenant_id כי הוא קורה לפני שהטננט קיים. הבידוד
-- שם הוא hash של sessionSecret בהשוואה בזמן קבוע, פלוס TTL. אל
-- תוסיפו כאן RLS מתוך הרגל — זה ישבור את כל הזרימה.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- הרשאות מפורשות על הטבלאות הקיימות. ה-ALTER DEFAULT PRIVILEGES
-- ב-initdb מכסה טבלאות *עתידיות*; אלה נוצרו במיגרציה 0001.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO craftmind_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO craftmind_app;
