/**
 * Sincroniza catálogo de mesas y libera mesa 7 (one-off / mantenimiento).
 * Uso: npx tsx prisma/fix-concert-mesa.ts
 */
import { PrismaClient, ConcertSeatStatus, ConcertOrderStatus } from "@prisma/client";
import { HEMENEGILDA_SEAT_CATALOG } from "../src/modules/concert/hemenegilda-seat-catalog";

const prisma = new PrismaClient();
const SLUG = process.env.CONCERT_DEFAULT_SLUG || "hemenegilda-capacidad";
const MESA = 7;

async function main() {
  const event = await prisma.concertEvent.findFirst({
    where: { slug: SLUG },
    include: { sections: true },
  });
  if (!event) throw new Error(`Evento ${SLUG} no encontrado`);

  const salon = event.sections.find((s) => s.code === "SALON");
  if (!salon) throw new Error("Sección SALON no encontrada");

  for (const entry of HEMENEGILDA_SEAT_CATALOG) {
    await prisma.concertSeat.updateMany({
      where: { sectionId: salon.id, displayNumber: entry.displayNumber },
      data: {
        mesaNumber: entry.mesaNumber,
        priceUsd: entry.priceUsd,
        priceBs: entry.priceBs,
        tierCode: entry.tierCode,
        tierLabel: entry.tierLabel,
        rowLabel: `M${entry.mesaNumber}`,
      },
    });
  }
  console.log("✅ Catálogo sincronizado");

  const mesaSeats = await prisma.concertSeat.findMany({
    where: {
      sectionId: salon.id,
      mesaNumber: MESA,
      status: { not: ConcertSeatStatus.SOLD },
    },
    select: { id: true, status: true, orderId: true, displayNumber: true },
  });
  console.log(`Mesa ${MESA} antes:`, mesaSeats);

  const orderIds = [
    ...new Set(
      mesaSeats
        .map((s) => s.orderId)
        .filter((id): id is number => id != null),
    ),
  ];

  for (const orderId of orderIds) {
    const order = await prisma.concertOrder.findFirst({
      where: { id: orderId, status: ConcertOrderStatus.PENDING_PAYMENT },
    });
    if (!order) continue;
    await prisma.concertSeat.updateMany({
      where: { orderId },
      data: {
        status: ConcertSeatStatus.AVAILABLE,
        orderId: null,
        holdToken: null,
        heldUntil: null,
      },
    });
    await prisma.concertOrder.update({
      where: { id: orderId },
      data: { status: ConcertOrderStatus.CANCELLED },
    });
    console.log(`✅ Orden pendiente cancelada: #${orderId}`);
  }

  const released = await prisma.concertSeat.updateMany({
    where: {
      sectionId: salon.id,
      mesaNumber: MESA,
      status: { not: ConcertSeatStatus.SOLD },
    },
    data: {
      status: ConcertSeatStatus.AVAILABLE,
      orderId: null,
      holdToken: null,
      heldUntil: null,
    },
  });
  console.log(`✅ Mesa ${MESA} liberada: ${released.count} asiento(s)`);

  for (const mesa of [2, 3, 7, 8, 9]) {
    const count = await prisma.concertSeat.count({
      where: { sectionId: salon.id, mesaNumber: mesa },
    });
    const available = await prisma.concertSeat.count({
      where: {
        sectionId: salon.id,
        mesaNumber: mesa,
        status: ConcertSeatStatus.AVAILABLE,
      },
    });
    console.log(`   Mesa ${String(mesa).padStart(2, "0")}: ${count} asientos (${available} disponibles)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
