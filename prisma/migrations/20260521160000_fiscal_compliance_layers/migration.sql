-- Capas de cumplimiento fiscal: normas versionadas, eventos, alertas, auditoría, sync

CREATE TYPE "FiscalNormStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');
CREATE TYPE "FiscalAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "FiscalAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "FiscalDomainEventType" AS ENUM (
  'INVOICE_ISSUED',
  'PURCHASE_REGISTERED',
  'CREDIT_NOTE_CREATED',
  'CASH_CLOSE',
  'PERIOD_CLOSE',
  'PROFILE_CHANGED',
  'RULES_SYNCED',
  'VALIDATION_BLOCKED',
  'VALIDATION_WARNING'
);
CREATE TYPE "FiscalSyncRunType" AS ENUM ('CALENDARIO', 'BCV', 'NORMS');
CREATE TYPE "FiscalSyncRunStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
CREATE TYPE "FiscalComplianceMode" AS ENUM ('DIAGNOSTIC', 'OPERATIONAL');

ALTER TABLE "fiscal_profiles"
  ADD COLUMN IF NOT EXISTS "economicActivity" TEXT,
  ADD COLUMN IF NOT EXISTS "branches" JSONB,
  ADD COLUMN IF NOT EXISTS "lastRulesSyncAt" TIMESTAMP(3);

-- fiscal_calendar_rules se crea en 20260522160000_fiscal_phases_2_3 (migración posterior)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'fiscal_calendar_rules'
  ) THEN
    ALTER TABLE "fiscal_calendar_rules"
      ADD COLUMN IF NOT EXISTS "normVersionId" INTEGER;
  END IF;
END $$;

CREATE TABLE "fiscal_norms" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legalReference" TEXT,
  "officialSource" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_norms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiscal_norms_code_key" ON "fiscal_norms"("code");
CREATE INDEX "fiscal_norms_isActive_idx" ON "fiscal_norms"("isActive");

CREATE TABLE "fiscal_norm_versions" (
  "id" SERIAL NOT NULL,
  "normId" INTEGER NOT NULL,
  "versionCode" TEXT NOT NULL,
  "articleRef" TEXT,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validTo" TIMESTAMP(3),
  "status" "FiscalNormStatus" NOT NULL DEFAULT 'ACTIVE',
  "sourceDocument" TEXT,
  "notes" TEXT,
  "metadata" JSONB,
  "createdByUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_norm_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fiscal_norm_versions_normId_status_idx" ON "fiscal_norm_versions"("normId", "status");
CREATE INDEX "fiscal_norm_versions_validFrom_validTo_idx" ON "fiscal_norm_versions"("validFrom", "validTo");

CREATE TABLE "fiscal_domain_events" (
  "id" SERIAL NOT NULL,
  "organizationId" INTEGER NOT NULL,
  "eventType" "FiscalDomainEventType" NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "payload" JSONB,
  "userId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_domain_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fiscal_domain_events_organizationId_createdAt_idx" ON "fiscal_domain_events"("organizationId", "createdAt");
CREATE INDEX "fiscal_domain_events_organizationId_eventType_idx" ON "fiscal_domain_events"("organizationId", "eventType");

CREATE TABLE "fiscal_compliance_alerts" (
  "id" SERIAL NOT NULL,
  "organizationId" INTEGER NOT NULL,
  "severity" "FiscalAlertSeverity" NOT NULL,
  "status" "FiscalAlertStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "problem" TEXT NOT NULL,
  "risk" TEXT NOT NULL,
  "recommendedAction" TEXT NOT NULL,
  "ruleCode" TEXT,
  "normVersionId" INTEGER,
  "blocksOperation" BOOLEAN NOT NULL DEFAULT false,
  "periodYear" INTEGER,
  "periodMonth" INTEGER,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_compliance_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fiscal_compliance_alerts_organizationId_status_severity_idx"
  ON "fiscal_compliance_alerts"("organizationId", "status", "severity");

CREATE TABLE "fiscal_audit_logs" (
  "id" SERIAL NOT NULL,
  "organizationId" INTEGER NOT NULL,
  "userId" INTEGER,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "ruleCode" TEXT,
  "beforeValue" JSONB,
  "afterValue" JSONB,
  "systemResponse" JSONB,
  "userConfirmed" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fiscal_audit_logs_organizationId_createdAt_idx" ON "fiscal_audit_logs"("organizationId", "createdAt");

CREATE TABLE "fiscal_sync_runs" (
  "id" SERIAL NOT NULL,
  "organizationId" INTEGER,
  "syncType" "FiscalSyncRunType" NOT NULL,
  "status" "FiscalSyncRunStatus" NOT NULL DEFAULT 'PENDING',
  "versionLabel" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "errorMessage" TEXT,
  CONSTRAINT "fiscal_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fiscal_sync_runs_syncType_status_idx" ON "fiscal_sync_runs"("syncType", "status");

ALTER TABLE "fiscal_norm_versions"
  ADD CONSTRAINT "fiscal_norm_versions_normId_fkey"
  FOREIGN KEY ("normId") REFERENCES "fiscal_norms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'fiscal_calendar_rules'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_calendar_rules_normVersionId_fkey'
  ) THEN
    ALTER TABLE "fiscal_calendar_rules"
      ADD CONSTRAINT "fiscal_calendar_rules_normVersionId_fkey"
      FOREIGN KEY ("normVersionId") REFERENCES "fiscal_norm_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "fiscal_domain_events"
  ADD CONSTRAINT "fiscal_domain_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fiscal_compliance_alerts"
  ADD CONSTRAINT "fiscal_compliance_alerts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fiscal_compliance_alerts"
  ADD CONSTRAINT "fiscal_compliance_alerts_normVersionId_fkey"
  FOREIGN KEY ("normVersionId") REFERENCES "fiscal_norm_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fiscal_audit_logs"
  ADD CONSTRAINT "fiscal_audit_logs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fiscal_sync_runs"
  ADD CONSTRAINT "fiscal_sync_runs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
