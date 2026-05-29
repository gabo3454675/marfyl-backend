-- Módulo temporal: boletería / concierto

CREATE TYPE "ConcertSeatStatus" AS ENUM ('AVAILABLE', 'HELD', 'SOLD');
CREATE TYPE "ConcertOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELLED');
CREATE TYPE "ConcertPaymentMethod" AS ENUM ('CASH_USD', 'PAGO_MOVIL', 'BANK_TRANSFER');

CREATE TABLE "concert_events" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "venueName" TEXT,
    "eventStartsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priceUsdStandard" DOUBLE PRECISION NOT NULL,
    "priceUsdVip" DOUBLE PRECISION NOT NULL,
    "bankAccountName" TEXT NOT NULL DEFAULT 'Inversiones Hemenegilda Capacidad',
    "bankAccountInfo" TEXT,
    "pagoMovilInfo" TEXT,
    "cashInstructions" TEXT,
    "publicNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concert_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "concert_sections" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "cols" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "concert_sections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "concert_seats" (
    "id" SERIAL NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "rowLabel" TEXT NOT NULL,
    "seatNumber" INTEGER NOT NULL,
    "status" "ConcertSeatStatus" NOT NULL DEFAULT 'AVAILABLE',
    "heldUntil" TIMESTAMP(3),
    "holdToken" TEXT,
    "orderId" INTEGER,

    CONSTRAINT "concert_seats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "concert_orders" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "eventId" INTEGER NOT NULL,
    "status" "ConcertOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentMethod" "ConcertPaymentMethod" NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerIdDocument" TEXT NOT NULL,
    "buyerPhone" TEXT NOT NULL,
    "buyerEmail" TEXT,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "amountBs" DOUBLE PRECISION NOT NULL,
    "exchangeRate" DOUBLE PRECISION NOT NULL,
    "paymentReference" TEXT,
    "publicToken" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "confirmedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concert_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "concert_tickets" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "seatId" INTEGER NOT NULL,
    "publicToken" TEXT NOT NULL,
    "qrPayload" TEXT NOT NULL,
    "seatLabel" TEXT NOT NULL,
    "sectionCode" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "checkedInBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concert_tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "concert_events_organizationId_slug_key" ON "concert_events"("organizationId", "slug");
CREATE INDEX "concert_events_organizationId_idx" ON "concert_events"("organizationId");
CREATE INDEX "concert_events_slug_idx" ON "concert_events"("slug");

CREATE UNIQUE INDEX "concert_sections_eventId_code_key" ON "concert_sections"("eventId", "code");
CREATE UNIQUE INDEX "concert_seats_sectionId_rowLabel_seatNumber_key" ON "concert_seats"("sectionId", "rowLabel", "seatNumber");
CREATE INDEX "concert_seats_sectionId_status_idx" ON "concert_seats"("sectionId", "status");
CREATE INDEX "concert_seats_holdToken_idx" ON "concert_seats"("holdToken");

CREATE UNIQUE INDEX "concert_orders_publicToken_key" ON "concert_orders"("publicToken");
CREATE INDEX "concert_orders_organizationId_idx" ON "concert_orders"("organizationId");
CREATE INDEX "concert_orders_eventId_status_idx" ON "concert_orders"("eventId", "status");

CREATE UNIQUE INDEX "concert_tickets_seatId_key" ON "concert_tickets"("seatId");
CREATE UNIQUE INDEX "concert_tickets_publicToken_key" ON "concert_tickets"("publicToken");
CREATE UNIQUE INDEX "concert_tickets_qrPayload_key" ON "concert_tickets"("qrPayload");
CREATE INDEX "concert_tickets_orderId_idx" ON "concert_tickets"("orderId");
CREATE INDEX "concert_tickets_qrPayload_idx" ON "concert_tickets"("qrPayload");

ALTER TABLE "concert_events" ADD CONSTRAINT "concert_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "concert_sections" ADD CONSTRAINT "concert_sections_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "concert_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "concert_seats" ADD CONSTRAINT "concert_seats_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "concert_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "concert_orders" ADD CONSTRAINT "concert_orders_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "concert_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "concert_tickets" ADD CONSTRAINT "concert_tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "concert_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "concert_tickets" ADD CONSTRAINT "concert_tickets_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "concert_seats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
