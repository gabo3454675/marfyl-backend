-- Tabla canónica de pagos (tesorería bimoneda, blindaje tenant)
CREATE TABLE "pagos" (
    "id" TEXT NOT NULL,
    "facturaId" INTEGER NOT NULL,
    "moneda" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "monto" DECIMAL(15,2) NOT NULL,
    "tasaCambio" DECIMAL(12,4) NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pagos_facturaId_idx" ON "pagos"("facturaId");
CREATE INDEX "pagos_tenantId_idx" ON "pagos"("tenantId");
CREATE INDEX "pagos_createdAt_idx" ON "pagos"("createdAt");

ALTER TABLE "pagos" ADD CONSTRAINT "pagos_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cierre de caja: totales y diferencias por moneda, flag impreso
ALTER TABLE "cierres_caja" ADD COLUMN "montoFisicoUsd" DECIMAL(15,2);
ALTER TABLE "cierres_caja" ADD COLUMN "montoFisicoVes" DECIMAL(15,2);
ALTER TABLE "cierres_caja" ADD COLUMN "totalUsd" DECIMAL(15,2);
ALTER TABLE "cierres_caja" ADD COLUMN "totalVes" DECIMAL(15,2);
ALTER TABLE "cierres_caja" ADD COLUMN "diferenciaUsd" DECIMAL(15,2);
ALTER TABLE "cierres_caja" ADD COLUMN "diferenciaVes" DECIMAL(15,2);
ALTER TABLE "cierres_caja" ADD COLUMN "impreso" BOOLEAN NOT NULL DEFAULT false;
