/**
 * Crea o actualiza el evento de boletería en Monddy (slug monddy).
 * Uso: pnpm provision:monddy-concert
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";
import { CONCERT_ORG_SLUG } from "../src/common/founding-orgs";
import {
  HEMENEGILDA_SEAT_CATALOG,
  SeatCatalogEntry,
} from "../src/modules/concert/hemenegilda-seat-catalog";
import { monddyConcertPaymentFields } from "../src/modules/concert/concert-payment.constants";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient();
const SLUG = process.env.CONCERT_DEFAULT_SLUG || "hemenegilda-capacidad";

function catalogEntryToSeat(
  sectionId: number,
  entry: SeatCatalogEntry,
  positionInMesa: number,
): Prisma.ConcertSeatCreateManyInput {
  return {
    sectionId,
    rowLabel: `M${entry.mesaNumber}`,
    seatNumber: positionInMesa,
    mesaNumber: entry.mesaNumber,
    displayNumber: entry.displayNumber,
    priceUsd: entry.priceUsd,
    priceBs: entry.priceBs,
    tierCode: entry.tierCode,
    tierLabel: entry.tierLabel,
  };
}

function buildSeatRows(
  sectionId: number,
  sectionCode: "SALON" | "VIP",
): Prisma.ConcertSeatCreateManyInput[] {
  const entries = HEMENEGILDA_SEAT_CATALOG.filter(
    (e) => e.sectionCode === sectionCode,
  );
  const byMesa = new Map<number, SeatCatalogEntry[]>();
  for (const e of entries) {
    const list = byMesa.get(e.mesaNumber) ?? [];
    list.push(e);
    byMesa.set(e.mesaNumber, list);
  }
  const rows: Prisma.ConcertSeatCreateManyInput[] = [];
  for (const [, mesaEntries] of byMesa) {
    mesaEntries
      .sort((a, b) => a.displayNumber - b.displayNumber)
      .forEach((entry, idx) => {
        rows.push(catalogEntryToSeat(sectionId, entry, idx + 1));
      });
  }
  return rows;
}

async function createFullEvent(organizationId: number) {
  const event = await prisma.concertEvent.create({
    data: {
      organizationId,
      slug: SLUG,
      title: "Horacio Blanco Acústico en Íntimo — Bodegón Monddy",
      subtitle: "Venta digital de entradas",
      venueName: "Av. Francisco Solano, Chacaíto, Caracas",
      eventStartsAt: new Date("2026-06-15T20:00:00.000Z"),
      priceUsdStandard: 40,
      priceUsdVip: 70,
      priceBsVip: 85,
      ...monddyConcertPaymentFields(),
      cashInstructions:
        "Efectivo solo en divisas (USD) en taquilla del local.",
      publicNotes:
        "Pago completo obligatorio. No se aceptan cuentas ni medios de pago digital extranjeros. Precios en USD y Bs según zona y mesa.",
      isActive: true,
    },
  });

  const salon = await prisma.concertSection.create({
    data: {
      eventId: event.id,
      code: "SALON",
      label: "Salón de eventos",
      rows: 0,
      cols: 0,
      sortOrder: 1,
    },
  });
  const vip = await prisma.concertSection.create({
    data: {
      eventId: event.id,
      code: "VIP",
      label: "Salón VIP",
      rows: 0,
      cols: 0,
      sortOrder: 2,
    },
  });

  await prisma.concertSeat.createMany({
    data: [
      ...buildSeatRows(salon.id, "SALON"),
      ...buildSeatRows(vip.id, "VIP"),
    ],
  });

  return event;
}

async function main() {
  const org = await prisma.organization.findUnique({
    where: { slug: CONCERT_ORG_SLUG },
    select: { id: true, nombre: true, concertModuleEnabled: true },
  });

  if (!org) {
    console.error(`❌ No existe organización slug="${CONCERT_ORG_SLUG}"`);
    process.exit(1);
  }

  if (!org.concertModuleEnabled) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { concertModuleEnabled: true },
    });
    console.log(`✅ concertModuleEnabled activado en ${org.nombre}`);
  }

  let event = await prisma.concertEvent.findFirst({
    where: { organizationId: org.id, slug: SLUG },
  });

  if (!event) {
    event = await createFullEvent(org.id);
    console.log(`✅ Evento creado: ${event.slug}`);
  } else {
    const seatCount = await prisma.concertSeat.count({
      where: { section: { eventId: event.id } },
    });
    if (seatCount !== 98) {
      const sold = await prisma.concertSeat.count({
        where: { section: { eventId: event.id }, status: "SOLD" },
      });
      if (sold > 0) {
        console.error(
          `❌ Evento existe con ${sold} asientos vendidos — no se puede reconstruir layout`,
        );
        process.exit(1);
      }
      await prisma.concertSeat.deleteMany({
        where: { section: { eventId: event.id } },
      });
      await prisma.concertSection.deleteMany({ where: { eventId: event.id } });
      await prisma.concertEvent.delete({ where: { id: event.id } });
      event = await createFullEvent(org.id);
      console.log(`✅ Layout reconstruido (${seatCount} → 98 asientos)`);
    } else {
      await prisma.concertEvent.update({
        where: { id: event.id },
        data: monddyConcertPaymentFields(),
      });
      console.log(`✅ Evento ya existía con 98 asientos (datos de pago actualizados)`);
    }
  }

  const total = await prisma.concertSeat.count({
    where: { section: { eventId: event.id } },
  });
  console.log(
    `\n🎫 Boletería Monddy (${org.nombre}, id=${org.id})`,
  );
  console.log(`   Evento: ${event.slug}`);
  console.log(`   Asientos: ${total}`);
  console.log(`   URL pública: /evento/${event.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
