-- DropIndex
DROP INDEX "tasks_tenantId_assignedToUserId_status_idx";

-- CreateIndex
CREATE INDEX "tasks_tenantId_assignedToUserId_status_priority_createdAt_idx" ON "tasks"("tenantId", "assignedToUserId", "status", "priority", "createdAt" DESC);
