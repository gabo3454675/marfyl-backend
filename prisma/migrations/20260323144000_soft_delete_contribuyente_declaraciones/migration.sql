-- SAC: soft delete + constraint de unicidad en RIF
-- Migracion segura: no destruye tablas ni datos existentes.

-- 1) Soft delete columns (nullable)
ALTER TABLE "contribuyentes"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

ALTER TABLE "declaraciones_iva"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

ALTER TABLE "declaraciones_islr"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

-- 2) Unicidad en RIF para contribuyentes
-- Nota: si existen duplicados en "RIF", esta sentencia fallara y debes resolver
-- los duplicados antes de reintentar la migracion.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'contribuyentes_RIF_key'
  ) THEN
    CREATE UNIQUE INDEX "contribuyentes_RIF_key"
      ON "contribuyentes" ("RIF");
  END IF;
END $$;
