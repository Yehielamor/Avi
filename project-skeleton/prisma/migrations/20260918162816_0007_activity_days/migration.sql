-- CreateTable
CREATE TABLE "activity_days" (
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "activity_days_pkey" PRIMARY KEY ("tenantId","userId","day")
);

-- CreateIndex
CREATE INDEX "activity_days_tenantId_day_idx" ON "activity_days"("tenantId", "day");

-- AddForeignKey
ALTER TABLE "activity_days" ADD CONSTRAINT "activity_days_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_days" ADD CONSTRAINT "activity_days_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS — אותה תבנית כמו 0002/0006. test/integration/rls.spec.ts נכשל על כל
-- טבלה עם tenantId שאין לה FORCE RLS.
-- =============================================================================
ALTER TABLE public.activity_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_days FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.activity_days;
CREATE POLICY tenant_isolation ON public.activity_days
  FOR ALL
  TO craftmind_app
  USING      ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

DROP POLICY IF EXISTS migrator_maintenance ON public.activity_days;
CREATE POLICY migrator_maintenance ON public.activity_days
  FOR ALL
  TO craftmind_migrator
  USING (true)
  WITH CHECK (true);
