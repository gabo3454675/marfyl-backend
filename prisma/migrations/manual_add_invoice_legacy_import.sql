-- Idempotencia importación ventas POS legacy (Monddy)
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "legacyImportKey" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "importSource" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "isLegacyImport" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_organizationId_legacyImportKey_key"
  ON "invoices" ("organizationId", "legacyImportKey");
