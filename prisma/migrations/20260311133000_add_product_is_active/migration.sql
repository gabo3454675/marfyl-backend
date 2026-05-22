-- Add missing isActive column to products for compatibility with current Prisma schema
-- Safe change: defaults to TRUE and applies to existing rows without data loss.

ALTER TABLE "products"
ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

