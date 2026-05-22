-- Conciliación por moneda en cierre de caja
ALTER TABLE "cierres_caja" ADD COLUMN "ventasEfectivoUsd" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "cierres_caja" ADD COLUMN "ventasEfectivoBs" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "cierres_caja" ADD COLUMN "ventasPagoMovil" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "cierres_caja" ADD COLUMN "ventasPos" DECIMAL(15,2) NOT NULL DEFAULT 0;
