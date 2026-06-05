-- =============================================================================
-- MARFYL — Migración manual: agregar soft-delete (deletedAt) a 3 modelos
-- Generada: 2026-06-05
-- Diagnóstico: schema.prisma declara `deletedAt DateTime?` en Organization,
--              Invoice y Expense, pero NINGUNA migración la crea en la BD.
--              Esto causa PrismaClientKnownRequestError P2022 en queries.
-- =============================================================================

-- 1. Columnas deletedAt (todas nullable, sin default)
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "invoices"      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "expenses"      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- 2. Índices (declarados en schema.prisma @@index([deletedAt]))
CREATE INDEX IF NOT EXISTS "organizations_deletedAt_idx" ON "organizations"("deletedAt");
CREATE INDEX IF NOT EXISTS "invoices_deletedAt_idx"      ON "invoices"("deletedAt");
CREATE INDEX IF NOT EXISTS "expenses_deletedAt_idx"      ON "expenses"("deletedAt");