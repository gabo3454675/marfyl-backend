-- Idempotencia de importación de compras (solo aditivo, no borra datos)
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "importKey" TEXT;

CREATE INDEX IF NOT EXISTS "expenses_importKey_idx" ON "expenses"("importKey");

CREATE UNIQUE INDEX IF NOT EXISTS "expenses_organizationId_importKey_key"
  ON "expenses" ("organizationId", "importKey")
  WHERE "importKey" IS NOT NULL;

-- Backfill desde descripciones existentes (sin modificar montos ni eliminar filas)
UPDATE "expenses"
SET "importKey" = TRIM(substring(description FROM 'monddy-compra:[^|]+'))
WHERE "importKey" IS NULL
  AND description LIKE '%monddy-compra:%';
