-- Add Product.description + unique SKU per organization
-- This migration aligns DB with prisma/schema.prisma changes.

-- 1) Add description column (nullable)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- 2) Ensure SKU is unique per organization (when both are present)
-- Postgres UNIQUE index allows multiple NULLs, which matches current schema (organizationId and sku are nullable).
CREATE UNIQUE INDEX IF NOT EXISTS "products_organizationId_sku_key"
ON "products" ("organizationId", "sku");

