-- =============================================================================
-- פונקציות תשתית חוצות-טננטים
-- =============================================================================
-- הבעיה:
--
--   עובד ה-outbox וה-scheduler הם חוצי-טננטים במהותם — הם שואלים
--   "מה ממתין בכל המערכת". אין להם קונטקסט טננט יחיד לבחור, ולכן
--   current_tenant_id() זורק והשאילתה נחסמת.
--
--   זה ה-RLS עובד נכון, לא באג. השאלה היא איך לתת לתשתית לעבוד בלי
--   לפתוח חור.
--
-- הפתרון שנדחה:
--
--   תפקיד עם BYPASSRLS, או policy שמתירה ל-craftmind_app לקרוא את
--   outbox_events ללא קונטקסט. שתיהן היו פותחות הרבה מעבר לצורך —
--   הראשונה את כל הטבלאות, השנייה את כל השורות בטבלה לכל קוד
--   שרץ בתפקיד הזה, כולל handler של HTTP.
--
-- הפתרון שנבחר:
--
--   פונקציות SECURITY DEFINER צרות, בדיוק כמו resolve_tenant_by_subdomain
--   במיגרציה 0002. כל אחת חושפת פעולה *אחת* על טבלה אחת:
--
--     claim_outbox_batch     — תופסת אצווה ומסמנת PROCESSING
--     settle_outbox_event    — מסמנת DONE / DEAD / חזרה ל-PENDING
--     list_intake_tenants    — מחזירה מזהי טננטים עם Gmail מחובר
--
--   הן לא יכולות לקרוא לקוחות, משימות או חשבוניות. רדיוס הפגיעה של
--   באג בהן מוגבל ל-outbox עצמו.
--
--   SET search_path חובה בכל SECURITY DEFINER: בלעדיו אפשר להטעות
--   את הפונקציה לפעול על טבלה מזויפת מסכימה אחרת.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- תפיסת אצווה לעיבוד.
--
-- FOR UPDATE SKIP LOCKED הוא מה שמאפשר כמה מופעים של האפליקציה: כל
-- אחד תופס שורות אחרות במקום להיחסם או לעבד את אותה שורה פעמיים.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_outbox_batch(p_limit integer)
RETURNS TABLE (
  id          uuid,
  tenant_id   uuid,
  event_name  text,
  payload     jsonb,
  attempts    integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH claimed AS (
    SELECT o.id
    FROM public.outbox_events o
    WHERE o.status = 'PENDING'
      AND o."nextAttemptAt" <= now()
    ORDER BY o."createdAt"
    LIMIT GREATEST(1, LEAST(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outbox_events o
  SET status = 'PROCESSING'
  FROM claimed c
  WHERE o.id = c.id
  RETURNING o.id, o."tenantId", o."eventName", o.payload, o.attempts;
$$;

COMMENT ON FUNCTION public.claim_outbox_batch(integer) IS
  'תופסת אצווה מה-outbox ומסמנת PROCESSING. SECURITY DEFINER כי הפרסום חוצה טננטים.';

REVOKE ALL ON FUNCTION public.claim_outbox_batch(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_outbox_batch(integer) TO craftmind_app;

-- -----------------------------------------------------------------------------
-- סגירת אירוע.
--
-- מקבלת רק ערכי סטטוס חוקיים, כך שגם קריאה שגויה לא יכולה להעביר
-- שורה למצב שרירותי.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_outbox_event(
  p_id          uuid,
  p_status      text,
  p_attempts    integer DEFAULT NULL,
  p_error       text    DEFAULT NULL,
  p_retry_after interval DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_status NOT IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'DEAD') THEN
    RAISE EXCEPTION 'invalid outbox status: %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.outbox_events
  SET status        = p_status::"OutboxStatus",
      attempts      = COALESCE(p_attempts, attempts),
      "lastError"   = p_error,
      "processedAt" = CASE WHEN p_status = 'DONE' THEN now() ELSE "processedAt" END,
      "nextAttemptAt" = CASE
                          WHEN p_retry_after IS NOT NULL THEN now() + p_retry_after
                          ELSE "nextAttemptAt"
                        END
  WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION public.settle_outbox_event(uuid, text, integer, text, interval) IS
  'מסמנת אירוע outbox כ-DONE/DEAD/PENDING אחרי עיבוד.';

REVOKE ALL ON FUNCTION public.settle_outbox_event(uuid, text, integer, text, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_outbox_event(uuid, text, integer, text, interval) TO craftmind_app;

-- -----------------------------------------------------------------------------
-- הטננטים שיש להם Gmail פעיל.
--
-- מחזירה מזהים בלבד — לא טוקנים, לא הגדרות. הטוקנים נקראים אחר כך
-- בתוך forTenant של אותו טננט, במסלול הרגיל.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_intake_tenants(p_provider text)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT ti."tenantId"
  FROM public.tenant_integrations ti
  JOIN public.tenants t ON t.id = ti."tenantId"
  WHERE ti.provider = p_provider::"IntegrationProvider"
    AND ti.status   = 'CONNECTED'
    AND t."isActive" = true;
$$;

COMMENT ON FUNCTION public.list_intake_tenants(text) IS
  'מזהי טננטים עם אינטגרציה פעילה, עבור ה-scheduler. מזהים בלבד — לא טוקנים.';

REVOKE ALL ON FUNCTION public.list_intake_tenants(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_intake_tenants(text) TO craftmind_app;
