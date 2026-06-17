-- Moneda de pago por empleado (USD o VES). Solo agrega columnas; no borra datos.
CREATE TYPE "PayrollCurrency" AS ENUM ('USD', 'VES');

ALTER TABLE "payroll_profiles" ADD COLUMN "payCurrency" "PayrollCurrency" NOT NULL DEFAULT 'USD';

ALTER TABLE "payroll_lines" ADD COLUMN "payCurrency" "PayrollCurrency" NOT NULL DEFAULT 'USD';
