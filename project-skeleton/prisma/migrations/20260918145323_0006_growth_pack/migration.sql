-- CreateEnum
CREATE TYPE "PublicLinkPurpose" AS ENUM ('TASK_STATUS', 'BOOKING', 'QUOTE');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskSource" ADD VALUE 'CUSTOMER_LINK';
ALTER TYPE "TaskSource" ADD VALUE 'QUOTE';

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "unitCost" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "customerConfirmedAt" TIMESTAMPTZ(3),
ADD COLUMN     "equipmentId" UUID,
ADD COLUMN     "onTheWayAt" TIMESTAMPTZ(3),
ADD COLUMN     "rescheduleRequest" TEXT,
ADD COLUMN     "rescheduleRequestedAt" TIMESTAMPTZ(3),
ADD COLUMN     "scheduledEnd" TIMESTAMPTZ(3),
ADD COLUMN     "scheduledStart" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "public_links" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "PublicLinkPurpose" NOT NULL,
    "customerId" UUID NOT NULL,
    "taskId" UUID,
    "equipmentId" UUID,
    "quoteId" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT,
    "location" TEXT,
    "serviceIntervalMonths" INTEGER NOT NULL DEFAULT 6,
    "lastServicedAt" TIMESTAMPTZ(3),
    "lastReminderAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "quoteNumber" INTEGER NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "approvedAt" TIMESTAMPTZ(3),
    "declinedAt" TIMESTAMPTZ(3),
    "taskId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "priceCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_links_tokenHash_key" ON "public_links"("tokenHash");

-- CreateIndex
CREATE INDEX "public_links_tenantId_taskId_purpose_idx" ON "public_links"("tenantId", "taskId", "purpose");

-- CreateIndex
CREATE INDEX "public_links_tenantId_quoteId_idx" ON "public_links"("tenantId", "quoteId");

-- CreateIndex
CREATE INDEX "public_links_tenantId_equipmentId_idx" ON "public_links"("tenantId", "equipmentId");

-- CreateIndex
CREATE INDEX "equipment_tenantId_customerId_idx" ON "equipment"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "equipment_tenantId_isActive_lastServicedAt_idx" ON "equipment"("tenantId", "isActive", "lastServicedAt");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_taskId_key" ON "quotes"("taskId");

-- CreateIndex
CREATE INDEX "quotes_tenantId_status_createdAt_idx" ON "quotes"("tenantId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "quotes_tenantId_customerId_idx" ON "quotes"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_tenantId_quoteNumber_key" ON "quotes"("tenantId", "quoteNumber");

-- CreateIndex
CREATE INDEX "quote_lines_quoteId_idx" ON "quote_lines"("quoteId");

-- CreateIndex
CREATE INDEX "tasks_tenantId_assignedToUserId_scheduledStart_idx" ON "tasks"("tenantId", "assignedToUserId", "scheduledStart");

-- CreateIndex
CREATE INDEX "tasks_equipmentId_idx" ON "tasks"("equipmentId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_links" ADD CONSTRAINT "public_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_links" ADD CONSTRAINT "public_links_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_links" ADD CONSTRAINT "public_links_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_links" ADD CONSTRAINT "public_links_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_links" ADD CONSTRAINT "public_links_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- RLS לטבלאות החדשות — אותה תבנית כמו 0002 ו-0003.
--
-- הרשימה מפורשת: טבלה חדשה נכנסת לכאן במודע, ו-test/integration/rls.spec.ts
-- נכשל על כל טבלה עם עמודת tenantId שאין לה FORCE RLS.
-- =============================================================================
DO $$
DECLARE
  t text;
  new_tables text[] := ARRAY['public_links', 'equipment', 'quotes', 'quote_lines'];
BEGIN
  FOREACH t IN ARRAY new_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        TO craftmind_app
        USING      ("tenantId" = public.current_tenant_id())
        WITH CHECK ("tenantId" = public.current_tenant_id())
    $f$, t);

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

-- =============================================================================
-- טוקן ציבורי → טננט.
--
-- בקשה מלקוח מגיעה בלי התחברות ובלי טננט: הטוקן הוא כל מה שיש. כדי לדעת
-- תחת איזה טננט לפתוח את forTenant, צריך לקרוא שורה אחת מ-public_links לפני
-- שיש הקשר — מה ש-RLS חוסם, בצדק.
--
-- הפתרון זהה ל-resolve_tenant_by_subdomain: פונקציית SECURITY DEFINER צרה
-- שמחזירה עמודה אחת בלבד, ורק לקישור בתוקף. לא תפקיד BYPASSRLS. כל שאר
-- הקריאות רצות אחר כך ב-forTenant רגיל, תחת RLS מלא.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.resolve_public_link(p_token_hash text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT pl."tenantId"
  FROM public.public_links pl
  JOIN public.tenants t ON t.id = pl."tenantId" AND t."isActive" = true
  WHERE pl."tokenHash" = p_token_hash
    AND pl."revokedAt" IS NULL
    AND pl."expiresAt" > now();
$$;

COMMENT ON FUNCTION public.resolve_public_link(text) IS
  'hash של טוקן ציבורי -> tenantId, רק לקישור בתוקף. SECURITY DEFINER מצומצמת, במקום BYPASSRLS.';

REVOKE ALL ON FUNCTION public.resolve_public_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_public_link(text) TO craftmind_app;
