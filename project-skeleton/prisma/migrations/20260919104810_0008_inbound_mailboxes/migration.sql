-- CreateTable
CREATE TABLE "inbound_mailboxes" (
    "tenantId" UUID NOT NULL,
    "localPart" TEXT NOT NULL,
    "verificationCode" TEXT,
    "verificationUrl" TEXT,
    "verificationReceivedAt" TIMESTAMPTZ(3),
    "lastReceivedAt" TIMESTAMPTZ(3),
    "receivedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inbound_mailboxes_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "inbound_mailboxes_localPart_key" ON "inbound_mailboxes"("localPart");

-- AddForeignKey
ALTER TABLE "inbound_mailboxes" ADD CONSTRAINT "inbound_mailboxes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS — אותה תבנית כמו 0002/0006/0007.
-- =============================================================================
ALTER TABLE public.inbound_mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_mailboxes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.inbound_mailboxes;
CREATE POLICY tenant_isolation ON public.inbound_mailboxes
  FOR ALL
  TO craftmind_app
  USING      ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

DROP POLICY IF EXISTS migrator_maintenance ON public.inbound_mailboxes;
CREATE POLICY migrator_maintenance ON public.inbound_mailboxes
  FOR ALL
  TO craftmind_migrator
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- כתובת קליטה → טננט.
--
-- מייל נכנס מגיע בלי הקשר טננט (אין JWT ואין subdomain), ולכן צריך לתרגם
-- את הכתובת לטננט לפני forTenant. בדיוק כמו resolve_tenant_by_subdomain:
-- פונקציה צרה שמחזירה id אחד, ולא תפקיד שעוקף RLS.
-- טננט מושבת לא נקלט.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.resolve_inbound_mailbox(p_local_part text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT m."tenantId"
  FROM public.inbound_mailboxes m
  JOIN public.tenants t ON t.id = m."tenantId"
  WHERE m."localPart" = lower(p_local_part) AND t."isActive" = true;
$$;

REVOKE ALL ON FUNCTION public.resolve_inbound_mailbox(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_inbound_mailbox(text) TO craftmind_app;
