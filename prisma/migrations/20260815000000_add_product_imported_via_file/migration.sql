-- Trazabilidad de importación por archivo de inventario
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "importedViaFile" BOOLEAN NOT NULL DEFAULT false;
