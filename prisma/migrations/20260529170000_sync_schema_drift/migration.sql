-- Sync schema drift between migrations and prisma/schema.prisma
-- Generated 2026-05-29

-- AlterEnum: MovementType
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'COMPRA';

-- AlterTable: fcm_tokens
ALTER TABLE "fcm_tokens" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable: fiscal_calendar_rules
ALTER TABLE "fiscal_calendar_rules" ADD COLUMN IF NOT EXISTS "normVersionId" INTEGER;

-- AlterTable: products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "bundleComponents" JSONB;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "isBundle" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "isService" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: expense_payments
CREATE TABLE IF NOT EXISTS "expense_payments" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "expenseId" INTEGER NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "expense_payments_expenseId_idx" ON "expense_payments"("expenseId");
CREATE INDEX IF NOT EXISTS "expense_payments_organizationId_idx" ON "expense_payments"("organizationId");
CREATE INDEX IF NOT EXISTS "concert_orders_publicToken_idx" ON "concert_orders"("publicToken");
CREATE INDEX IF NOT EXISTS "contribuyentes_deleted_at_idx" ON "contribuyentes"("deleted_at");
CREATE INDEX IF NOT EXISTS "declaraciones_islr_contribuyente_id_idx" ON "declaraciones_islr"("contribuyente_id");
CREATE INDEX IF NOT EXISTS "declaraciones_islr_deleted_at_idx" ON "declaraciones_islr"("deleted_at");
CREATE INDEX IF NOT EXISTS "declaraciones_iva_contribuyente_id_idx" ON "declaraciones_iva"("contribuyente_id");
CREATE INDEX IF NOT EXISTS "declaraciones_iva_deleted_at_idx" ON "declaraciones_iva"("deleted_at");
CREATE INDEX IF NOT EXISTS "fiscal_calendar_rules_normVersionId_idx" ON "fiscal_calendar_rules"("normVersionId");
CREATE INDEX IF NOT EXISTS "invoices_organizationId_createdAt_idx" ON "invoices"("organizationId", "createdAt");

-- AddForeignKey (idempotente en producción)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_payments_organizationId_fkey') THEN
    ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_payments_expenseId_fkey') THEN
    ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_calendar_rules_normVersionId_fkey') THEN
    ALTER TABLE "fiscal_calendar_rules" ADD CONSTRAINT "fiscal_calendar_rules_normVersionId_fkey" FOREIGN KEY ("normVersionId") REFERENCES "fiscal_norm_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declaraciones_iva_contribuyente_id_fkey') THEN
    ALTER TABLE "declaraciones_iva" ADD CONSTRAINT "declaraciones_iva_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyentes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declaraciones_islr_contribuyente_id_fkey') THEN
    ALTER TABLE "declaraciones_islr" ADD CONSTRAINT "declaraciones_islr_contribuyente_id_fkey" FOREIGN KEY ("contribuyente_id") REFERENCES "contribuyentes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- RenameIndex
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'fiscal_deadlines_organizationId_templateId_periodYear_periodMon'
  ) THEN
    ALTER INDEX "fiscal_deadlines_organizationId_templateId_periodYear_periodMon" RENAME TO "fiscal_deadlines_organizationId_templateId_periodYear_perio_key";
  END IF;
END $$;
