-- AlterTable
ALTER TABLE "cierres_caja" ADD COLUMN "publicToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "cierres_caja_publicToken_key" ON "cierres_caja"("publicToken");
CREATE INDEX "cierres_caja_publicToken_idx" ON "cierres_caja"("publicToken");
