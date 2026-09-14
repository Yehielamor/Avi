-- =============================================================================
-- Policy תחזוקה עבור craftmind_migrator
-- =============================================================================
-- למה זה נדרש:
--
--   FORCE ROW LEVEL SECURITY (מיגרציה 0002) מחיל policies גם על בעל
--   הטבלה — וזו בדיוק המטרה שלו. אבל ה-policy `tenant_isolation`
--   מוגדרת `TO craftmind_app` בלבד, ולכן עבור craftmind_migrator לא
--   קיימת שום policy, ו-PostgreSQL עובר ל-deny כברירת מחדל.
--
--   התוצאה: כל מיגרציית *נתונים* עתידית (backfill, תיקון, נרמול)
--   שה-migrator מריץ תיכשל בשקט עם 0 שורות, או תיחסם. וגם `db:seed`
--   לא יעבוד. זו הפתעה שהייתה מתגלה בפרודקשן, באמצע deploy.
--
-- למה זה בטוח:
--
--   craftmind_migrator לעולם אינו מקבל בקשת HTTP. הוא מופיע בדיוק
--   בשני מקומות: `prisma migrate deploy` ו-`db:seed`. אימות הסביבה
--   (src/config/env.schema.ts) *דוחה עלייה* אם DATABASE_URL מכיל את
--   craftmind_migrator, כך שאי אפשר להצמיד אותו בטעות לזמן ריצה.
--
--   כלומר: הגבול בין "יכול לראות הכל" ל-"מבודד לטננט" הוא גבול של
--   תפקיד, נאכף בשתי שכבות בלתי תלויות — ה-policies כאן, ואימות
--   הסביבה באפליקציה.
-- =============================================================================

DO $$
DECLARE
  t text;
  all_rls_tables text[] := ARRAY[
    'tenants',
    'tenant_configs',
    'job_type_templates',
    'users',
    'customers',
    'tasks',
    'inventory_items',
    'stock_movements',
    'price_list_items',
    'invoices',
    'invoice_line_items',
    'tenant_integrations',
    'audit_logs',
    'outbox_events',
    'idempotency_keys',
    'llm_usage'
  ];
BEGIN
  FOREACH t IN ARRAY all_rls_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS migrator_maintenance ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY migrator_maintenance ON public.%I
        FOR ALL
        TO craftmind_migrator
        USING (true)
        WITH CHECK (true)
    $f$, t);
  END LOOP;
END;
$$;
