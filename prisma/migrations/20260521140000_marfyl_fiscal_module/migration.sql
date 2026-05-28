-- CreateEnum
CREATE TYPE "FiscalTaxpayerType" AS ENUM ('ORDINARIO', 'ESPECIAL', 'FORMAL');
CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED');
CREATE TYPE "FiscalDocumentType" AS ENUM ('FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO');
CREATE TYPE "LibroLineStatus" AS ENUM ('ACTIVE', 'VOID');

-- AlterTable organizations
ALTER TABLE "organizations" ADD COLUMN "taxId" TEXT;
ALTER TABLE "organizations" ADD COLUMN "legalName" TEXT;

-- AlterTable invoices
ALTER TABLE "invoices" ADD COLUMN "fiscalDocumentType" "FiscalDocumentType" NOT NULL DEFAULT 'FACTURA';
ALTER TABLE "invoices" ADD COLUMN "controlNumber" TEXT;
ALTER TABLE "invoices" ADD COLUMN "fiscalInvoiceNumber" TEXT;
ALTER TABLE "invoices" ADD COLUMN "issueDate" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN "baseExempt" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "baseReduced" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "baseGeneral" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "ivaAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "igtfAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- AlterTable invoice_items
ALTER TABLE "invoice_items" ADD COLUMN "taxRate" INTEGER NOT NULL DEFAULT 16;
ALTER TABLE "invoice_items" ADD COLUMN "taxableBase" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice_items" ADD COLUMN "ivaLine" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- AlterTable expenses
ALTER TABLE "expenses" ADD COLUMN "supplierControlNumber" TEXT;
ALTER TABLE "expenses" ADD COLUMN "supplierInvoiceNumber" TEXT;
ALTER TABLE "expenses" ADD COLUMN "baseExempt" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "baseReduced" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "baseGeneral" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "ivaAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "withholdingIvaAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- CreateTable fiscal_profiles
CREATE TABLE "fiscal_profiles" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "taxId" TEXT,
    "legalName" TEXT,
    "taxpayerType" "FiscalTaxpayerType" NOT NULL DEFAULT 'ORDINARIO',
    "isWithholdingAgent" BOOLEAN NOT NULL DEFAULT false,
    "isSubjectToWithholding" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable fiscal_periods
CREATE TABLE "fiscal_periods" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable libro_venta_lines
CREATE TABLE "libro_venta_lines" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "invoiceId" INTEGER,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "documentType" "FiscalDocumentType" NOT NULL DEFAULT 'FACTURA',
    "invoiceNumber" TEXT,
    "controlNumber" TEXT,
    "customerTaxId" TEXT,
    "customerName" TEXT,
    "baseExempt" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "baseReduced" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "baseGeneral" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "ivaAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "LibroLineStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "libro_venta_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable libro_compra_lines
CREATE TABLE "libro_compra_lines" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "expenseId" INTEGER,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "supplierTaxId" TEXT,
    "supplierName" TEXT,
    "invoiceNumber" TEXT,
    "controlNumber" TEXT,
    "baseExempt" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "baseReduced" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "baseGeneral" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "ivaAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "withholdingIva" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "LibroLineStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "libro_compra_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_profiles_organizationId_key" ON "fiscal_profiles"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_periods_organizationId_year_month_key" ON "fiscal_periods"("organizationId", "year", "month");
CREATE INDEX "fiscal_periods_organizationId_status_idx" ON "fiscal_periods"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "libro_venta_lines_invoiceId_key" ON "libro_venta_lines"("invoiceId");
CREATE INDEX "libro_venta_lines_organizationId_periodYear_periodMonth_idx" ON "libro_venta_lines"("organizationId", "periodYear", "periodMonth");
CREATE INDEX "libro_venta_lines_issueDate_idx" ON "libro_venta_lines"("issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "libro_compra_lines_expenseId_key" ON "libro_compra_lines"("expenseId");
CREATE INDEX "libro_compra_lines_organizationId_periodYear_periodMonth_idx" ON "libro_compra_lines"("organizationId", "periodYear", "periodMonth");
CREATE INDEX "libro_compra_lines_issueDate_idx" ON "libro_compra_lines"("issueDate");

-- AddForeignKey
ALTER TABLE "fiscal_profiles" ADD CONSTRAINT "fiscal_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "libro_venta_lines" ADD CONSTRAINT "libro_venta_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "libro_venta_lines" ADD CONSTRAINT "libro_venta_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "libro_compra_lines" ADD CONSTRAINT "libro_compra_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "libro_compra_lines" ADD CONSTRAINT "libro_compra_lines_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
