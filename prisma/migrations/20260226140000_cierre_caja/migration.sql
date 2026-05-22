-- CreateEnum
CREATE TYPE "CierreCajaEstado" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "cierres_caja" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "fechaApertura" TIMESTAMP(3) NOT NULL,
    "fechaCierre" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "montoInicial" DECIMAL(15,2) NOT NULL,
    "ventasEfectivo" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "ventasDigitales" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "autoconsumos" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "montoFisico" DECIMAL(15,2),
    "diferencia" DECIMAL(15,2),
    "observaciones" TEXT,
    "estado" "CierreCajaEstado" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cierres_caja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cierres_caja_tenantId_idx" ON "cierres_caja"("tenantId");
CREATE INDEX "cierres_caja_userId_idx" ON "cierres_caja"("userId");
CREATE INDEX "cierres_caja_estado_idx" ON "cierres_caja"("estado");
CREATE INDEX "cierres_caja_fechaApertura_idx" ON "cierres_caja"("fechaApertura");
CREATE INDEX "cierres_caja_fechaCierre_idx" ON "cierres_caja"("fechaCierre");

-- AddForeignKey
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
