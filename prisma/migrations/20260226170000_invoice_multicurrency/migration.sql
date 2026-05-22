-- Enums para líneas de pago multimoneda
CREATE TYPE "PaymentLineMethod" AS ENUM ('CASH_USD', 'CASH_BS', 'PAGO_MOVIL', 'ZELLE', 'CARD', 'CREDIT');
CREATE TYPE "PaymentLineCurrency" AS ENUM ('USD', 'VES');

-- Tabla de líneas de pago por factura (híbrido: $ efectivo + Bs Pago Móvil)
CREATE TABLE "invoice_payment_lines" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "method" "PaymentLineMethod" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "PaymentLineCurrency" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payment_lines_pkey" PRIMARY KEY ("id")
);

-- Campos registro dual en factura
ALTER TABLE "invoices" ADD COLUMN "montoUsd" DECIMAL(15,2);
ALTER TABLE "invoices" ADD COLUMN "montoBs" DECIMAL(15,2);
ALTER TABLE "invoices" ADD COLUMN "tasaReferencia" DECIMAL(12,4);

CREATE INDEX "invoice_payment_lines_invoiceId_idx" ON "invoice_payment_lines"("invoiceId");

ALTER TABLE "invoice_payment_lines" ADD CONSTRAINT "invoice_payment_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
