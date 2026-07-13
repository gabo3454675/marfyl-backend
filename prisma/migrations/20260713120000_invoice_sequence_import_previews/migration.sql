-- Secuencia atómica de consecutivos por organización
CREATE TABLE IF NOT EXISTS "organization_invoice_sequences" (
  "organizationId" INTEGER NOT NULL,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_invoice_sequences_pkey" PRIMARY KEY ("organizationId")
);

ALTER TABLE "organization_invoice_sequences"
  ADD CONSTRAINT "organization_invoice_sequences_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Inicializar secuencias desde MAX(consecutiveNumber)+1
INSERT INTO "organization_invoice_sequences" ("organizationId", "nextNumber", "updatedAt")
SELECT "organizationId", COALESCE(MAX("consecutiveNumber"), 0) + 1, CURRENT_TIMESTAMP
FROM "invoices"
WHERE "organizationId" IS NOT NULL
GROUP BY "organizationId"
ON CONFLICT ("organizationId") DO NOTHING;

-- Preview batches importación ventas (multi-réplica)
CREATE TABLE IF NOT EXISTS "sales_import_preview_batches" (
  "id" TEXT NOT NULL,
  "organizationId" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_import_preview_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sales_import_preview_batches_organizationId_idx"
  ON "sales_import_preview_batches"("organizationId");
CREATE INDEX IF NOT EXISTS "sales_import_preview_batches_expiresAt_idx"
  ON "sales_import_preview_batches"("expiresAt");

ALTER TABLE "sales_import_preview_batches"
  ADD CONSTRAINT "sales_import_preview_batches_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Columnas legacy import (idempotencia ventas POS)
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "legacyImportKey" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "importSource" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "isLegacyImport" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_organizationId_legacyImportKey_key"
  ON "invoices" ("organizationId", "legacyImportKey");

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_organizationId_consecutiveNumber_key"
  ON "invoices" ("organizationId", "consecutiveNumber");
