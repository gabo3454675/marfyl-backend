-- Trazabilidad de importación por archivo de inventario
-- Se usa ALTER TABLE manual porque `prisma migrate dev` no puede construir
-- la shadow database (P3006) por una migración previa no aplicable
-- (20260323144000_soft_delete_contribuyente_declaraciones).
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "importedViaFile" BOOLEAN NOT NULL DEFAULT false;
