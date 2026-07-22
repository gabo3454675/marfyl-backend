-- CreateEnum
CREATE TYPE "FloorPaymentMode" AS ENUM ('INMEDIATO', 'CUENTA_ABIERTA');

-- AlterTable: Add new columns to floor_orders
ALTER TABLE "floor_orders" ADD COLUMN "zone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "floor_orders" ADD COLUMN "paymentMode" "FloorPaymentMode" NOT NULL DEFAULT 'INMEDIATO';
ALTER TABLE "floor_orders" ADD COLUMN "isOpen" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: Composite index for open tabs queries
CREATE INDEX "floor_orders_organizationId_paymentMode_isOpen_idx" ON "floor_orders"("organizationId", "paymentMode", "isOpen");

-- Update existing rows (ensure defaults are applied)
UPDATE "floor_orders" SET "zone" = '' WHERE "zone" IS NULL;
UPDATE "floor_orders" SET "isOpen" = false WHERE "isOpen" IS NULL;
