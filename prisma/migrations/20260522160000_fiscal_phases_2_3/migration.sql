-- CreateEnum
CREATE TYPE "FiscalDocumentKind" AS ENUM ('RETENCION_IVA', 'CERTIFICADO_DECLARACION', 'COMPROBANTE_PAGO', 'LIBRO_EXPORT', 'OTRO');
CREATE TYPE "DeclaracionIvaStatus" AS ENUM ('BORRADOR', 'LISTO', 'PRESENTADO');
CREATE TYPE "ComplianceStatus" AS ENUM ('RED', 'YELLOW', 'GREEN', 'CLOSED');
CREATE TYPE "FiscalObligationPeriodicity" AS ENUM ('MENSUAL', 'QUINCENAL', 'ANUAL');

-- AlterTable organizations
ALTER TABLE "organizations" ADD COLUMN "isSpecialTaxpayer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN "isFormalTaxpayer" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable fiscal_profiles
ALTER TABLE "fiscal_profiles" ADD COLUMN "rifLastDigit" INTEGER;
ALTER TABLE "fiscal_profiles" ADD COLUMN "obligations" JSONB;

-- AlterTable fiscal_periods
ALTER TABLE "fiscal_periods" ADD COLUMN "integrityHash" TEXT;

-- AlterTable declaraciones_iva
ALTER TABLE "declaraciones_iva" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "declaraciones_iva" ADD COLUMN "fiscalPeriodId" INTEGER;
ALTER TABLE "declaraciones_iva" ADD COLUMN "status" "DeclaracionIvaStatus" NOT NULL DEFAULT 'BORRADOR';
ALTER TABLE "declaraciones_iva" ADD COLUMN "totals" JSONB;
ALTER TABLE "declaraciones_iva" ALTER COLUMN "contribuyente_id" DROP NOT NULL;

-- CreateTable retenciones_iva
CREATE TABLE "retenciones_iva" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "expenseId" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "supplierTaxId" TEXT,
    "supplierName" TEXT,
    "baseAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "ivaAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "withholdingRate" DECIMAL(5,4) NOT NULL DEFAULT 0.75,
    "withholdingAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "certificateNumber" TEXT,
    "fiscalDocumentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "retenciones_iva_pkey" PRIMARY KEY ("id")
);

-- CreateTable fiscal_documents
CREATE TABLE "fiscal_documents" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "kind" "FiscalDocumentKind" NOT NULL DEFAULT 'OTRO',
    "fileName" TEXT,
    "storageUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable fiscal_obligation_templates
CREATE TABLE "fiscal_obligation_templates" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxpayerTypes" "FiscalTaxpayerType"[],
    "periodicity" "FiscalObligationPeriodicity" NOT NULL DEFAULT 'MENSUAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fiscal_obligation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable fiscal_calendar_rules
CREATE TABLE "fiscal_calendar_rules" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "rifDigitMin" INTEGER NOT NULL DEFAULT 0,
    "rifDigitMax" INTEGER NOT NULL DEFAULT 9,
    "dueDayOfMonth" INTEGER NOT NULL,
    "dueMonthOffset" INTEGER NOT NULL DEFAULT 1,
    "version" TEXT NOT NULL DEFAULT '2026',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "fiscal_calendar_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable fiscal_deadlines
CREATE TABLE "fiscal_deadlines" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "templateId" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "compliance" "ComplianceStatus" NOT NULL DEFAULT 'RED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fiscal_deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retenciones_iva_expenseId_key" ON "retenciones_iva"("expenseId");
CREATE UNIQUE INDEX "retenciones_iva_fiscalDocumentId_key" ON "retenciones_iva"("fiscalDocumentId");
CREATE INDEX "retenciones_iva_organizationId_periodYear_periodMonth_idx" ON "retenciones_iva"("organizationId", "periodYear", "periodMonth");

CREATE UNIQUE INDEX "fiscal_obligation_templates_code_key" ON "fiscal_obligation_templates"("code");
CREATE INDEX "fiscal_documents_organizationId_kind_idx" ON "fiscal_documents"("organizationId", "kind");
CREATE INDEX "fiscal_calendar_rules_templateId_idx" ON "fiscal_calendar_rules"("templateId");
CREATE UNIQUE INDEX "fiscal_deadlines_organizationId_templateId_periodYear_periodMont_key" ON "fiscal_deadlines"("organizationId", "templateId", "periodYear", "periodMonth");
CREATE INDEX "fiscal_deadlines_organizationId_dueDate_idx" ON "fiscal_deadlines"("organizationId", "dueDate");

CREATE UNIQUE INDEX "declaraciones_iva_fiscalPeriodId_key" ON "declaraciones_iva"("fiscalPeriodId");
CREATE INDEX "declaraciones_iva_organizationId_idx" ON "declaraciones_iva"("organizationId");

-- AddForeignKey
ALTER TABLE "retenciones_iva" ADD CONSTRAINT "retenciones_iva_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "retenciones_iva" ADD CONSTRAINT "retenciones_iva_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "retenciones_iva" ADD CONSTRAINT "retenciones_iva_fiscalDocumentId_fkey" FOREIGN KEY ("fiscalDocumentId") REFERENCES "fiscal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fiscal_calendar_rules" ADD CONSTRAINT "fiscal_calendar_rules_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "fiscal_obligation_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fiscal_deadlines" ADD CONSTRAINT "fiscal_deadlines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fiscal_deadlines" ADD CONSTRAINT "fiscal_deadlines_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "fiscal_obligation_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "declaraciones_iva" ADD CONSTRAINT "declaraciones_iva_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "declaraciones_iva" ADD CONSTRAINT "declaraciones_iva_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
