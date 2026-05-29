-- Comprobante de pago (captura) en órdenes de concierto
ALTER TABLE "concert_orders" ADD COLUMN "paymentProofUrl" TEXT;
