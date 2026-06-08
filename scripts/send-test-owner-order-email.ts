/**
 * Envío de prueba: notificación al owner por nueva compra en boletería.
 * Uso:
 *   npx tsx scripts/send-test-owner-order-email.ts
 * Destinatarios: CONCERT_OWNER_NOTIFY_EMAIL del .env (varios separados por coma).
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { ConfigService } from "@nestjs/config";
import { EmailService } from "../src/modules/email/email.service";
import type { OwnerOrderSeatLine } from "../src/modules/email/email.types";
import { ConcertPaymentMethod } from "@prisma/client";
import { monddyConcertPaymentFields } from "../src/modules/concert/concert-payment.constants";

function loadEnvFile() {
  try {
    const raw = readFileSync(resolve(__dirname, "../.env"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* .env opcional */
  }
}

loadEnvFile();

async function main() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error("❌ RESEND_API_KEY no definida en .env");
    process.exit(1);
  }

  const ownerEmails =
    process.env.CONCERT_OWNER_NOTIFY_EMAIL?.trim() ||
    "glonga10@gmail.com,josealeonr@gmail.com";

  const config = new ConfigService({
    RESEND_API_KEY: apiKey,
    RESEND_FROM_EMAIL:
      process.env.RESEND_FROM_EMAIL || "entradas@marfyl.site",
    RESEND_FROM_NAME: process.env.RESEND_FROM_NAME || "MARFYL Entradas",
    CONCERT_OWNER_NOTIFY_EMAIL: ownerEmails,
    FRONTEND_URL: process.env.FRONTEND_URL || "https://marfyl.site",
  });

  const emailService = new EmailService(config);

  const publicToken = randomUUID();
  const mockOrder = {
    id: 99999,
    organizationId: 1,
    eventId: 1,
    status: "PENDING_PAYMENT" as const,
    paymentMethod: ConcertPaymentMethod.PAGO_MOVIL,
    buyerName: "María Fernández",
    buyerIdDocument: "V-18.765.432",
    buyerPhone: "+58 414-555-0198",
    buyerEmail: "maria.fernandez@example.com",
    amountUsd: 85,
    amountBs: 12450.5,
    exchangeRate: 146.48,
    paymentReference: "REF-8844221",
    paymentProofUrl: null as string | null,
    publicToken,
    paidAt: null as Date | null,
    confirmedById: null as number | null,
    emailSentAt: null as Date | null,
    emailSentTo: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockEvent = {
    id: 1,
    organizationId: 1,
    slug: "hemenegilda-capacidad",
    title: "Bodegón Monddy en Concierto",
    subtitle: "Horacio Blanco Acústico en Íntimo",
    venueName: "Av. Francisco Solano, Chacaíto, Caracas",
    eventStartsAt: new Date("2026-06-15T22:00:00.000Z"),
    isActive: true,
    priceUsdStandard: 35,
    priceUsdVip: 50,
    priceBsVip: null as number | null,
    ...monddyConcertPaymentFields(),
    cashInstructions: null as string | null,
    publicNotes: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSeats: OwnerOrderSeatLine[] = [
    { seatLabel: "Mesa 12 · Asiento 3", sectionCode: "VIP", priceUsd: 50 },
    { seatLabel: "Mesa 12 · Asiento 4", sectionCode: "VIP", priceUsd: 50 },
    {
      seatLabel: "Mesa 8 · Asiento 15",
      sectionCode: "SALON",
      priceUsd: 35,
    },
  ];

  console.log(`📧 Enviando notificación de compra a: ${ownerEmails}`);
  console.log(`   From: ${process.env.RESEND_FROM_EMAIL || "entradas@marfyl.site"}`);

  const ok = await emailService.sendConcertOrderPendingToOwner(
    mockOrder,
    mockEvent,
    mockSeats,
  );

  if (!ok) {
    console.error(
      "❌ No se pudo enviar. Si el dominio marfyl.site no está verificado en Resend,",
    );
    console.error(
      "   configura SPF/DKIM en Namecheap o usa temporalmente RESEND_FROM_EMAIL=onboarding@resend.dev",
    );
    process.exit(1);
  }

  console.log("✅ Correo de nueva compra enviado a todos los owners configurados.");
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
