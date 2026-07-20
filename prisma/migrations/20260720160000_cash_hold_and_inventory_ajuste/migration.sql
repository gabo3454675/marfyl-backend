-- AlterEnum: AJUSTE de inventario (sin impacto P&L)
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'AJUSTE';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CashHoldLocation" AS ENUM ('OFFICE', 'STORE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "cash_holds" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "location" "CashHoldLocation" NOT NULL DEFAULT 'OFFICE',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" DECIMAL(15,2) NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "importKey" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_holds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_holds_importKey_key" ON "cash_holds"("importKey");
CREATE INDEX IF NOT EXISTS "cash_holds_organizationId_idx" ON "cash_holds"("organizationId");
CREATE INDEX IF NOT EXISTS "cash_holds_organizationId_location_idx" ON "cash_holds"("organizationId", "location");
CREATE INDEX IF NOT EXISTS "cash_holds_asOf_idx" ON "cash_holds"("asOf");

DO $$ BEGIN
  ALTER TABLE "cash_holds" ADD CONSTRAINT "cash_holds_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_holds" ADD CONSTRAINT "cash_holds_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
