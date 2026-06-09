/**
 * Crea o actualiza el evento de boletería en Monddy (slug monddy).
 * Uso: pnpm provision:monddy-concert
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";
import { CONCERT_ORG_SLUG } from "../src/common/founding-orgs";
import {
  HEMENEGILDA_LEGACY_TOTAL_WITH_VIP,
  HEMENEGILDA_SALON_SEAT_COUNT,
  HEMENEGILDA_SEAT_CATALOG,
  HEMENEGILDA_VIP_SECTION_CODE,
  SeatCatalogEntry,
} from "../src/modules/concert/hemenegilda-seat-catalog";
import { monddyConcertPaymentFields } from "../src/modules/concert/concert-payment.constants";
import { MONDDY_HEMENEGILDA_EVENT_STARTS_AT } from "../src/modules/concert/concert-event.constants";
import {
  resolveConcertExchangeRate,
  usdToBsForConcert,
} from "../src/modules/concert/concert-pricing.util";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient();
const SLUG = process.env.CONCERT_DEFAULT_SLUG || "hemenegilda-capacidad";

function catalogEntryToSeat(
  sectionId: number,
  entry: SeatCatalogEntry,
  positionInMesa: number,
  exchangeRate: number,
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
  exchangeRate: number,
): Prisma.ConcertSeatCreateManyInput[] {
  const byMesa = new Map<number, SeatCatalogEntry[]>();
  for (const e of HEMENEGILDA_SEAT_CATALOG) {
    const list = byMesa.get(e.mesaNumber) ?? [];
    list.push(e);
    byMesa.set(e.mesaNumber, list);
  }
  const rows: Prisma.ConcertSeatCreateManyInput[] = [];
  for (const [, mesaEntries] of byMesa) {
    mesaEntries
      .sort((a, b) => a.displayNumber - b.displayNumber)
      .forEach((entry, idx) => {
        rows.push(catalogEntryToSeat(sectionId, entry, idx + 1, exchangeRate));
      });
  }
  return rows;
}

async function removeVipSectionIfPossible(eventId: number) {
  const vipSection = await prisma.concertSection.findFirst({
    where: { eventId, code: HEMENEGILDA_VIP_SECTION_CODE },
    select: { id: true },
  });
  if (!vipSection) return false;

  const blocked = await prisma.concertSeat.count({
    where: {
      sectionId: vipSection.id,
      OR: [
        { status: "SOLD" },
        { status: "HELD", heldUntil: { gt: new Date() } },
      ],
    },
  });
  if (blocked > 0) {
    console.error(
      `❌ Salón VIP tiene ${blocked} asiento(s) vendido(s) o en reserva — no se puede eliminar`,
    );
    process.exit(1);
  }

  await prisma.concertSeat.deleteMany({ where: { sectionId: vipSection.id } });
  await prisma.concertSection.delete({ where: { id: vipSection.id } });
  console.log(`✅ Sección Salón VIP eliminada (${HEMENEGILDA_SALON_SEAT_COUNT} asientos en venta)`);
  return true;
}

async function createFullEvent(organizationId: number, exchangeRate: number) {
  const event = await prisma.concertEvent.create({
    data: {
      organizationId,
      slug: SLUG,
      title: "Horacio Blanco Acústico en Íntimo — Bodegón Monddy",
      subtitle: "Venta digital de entradas",
      venueName: "Av. Francisco Solano, Chacaíto, Caracas",
      eventStartsAt: MONDDY_HEMENEGILDA_EVENT_STARTS_AT,
      priceUsdStandard: 40,
      priceUsdVip: 70,
      priceBsVip: usdToBsForConcert(70, exchangeRate),
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

  await prisma.concertSeat.createMany({
    data: buildSeatRows(salon.id, exchangeRate),
  });

  return event;
}

async function syncCatalogPrices(eventId: number, exchangeRate: number) {
  const salon = await prisma.concertSection.findFirst({
    where: { eventId, code: "SALON" },
    select: { id: true },
  });
  if (!salon) return;

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
  console.log(
    `✅ Precios flyer sincronizados (efectivo USD + tier Bs USD; BCV ${exchangeRate})`,
  );
}

async function main() {
  const org = await prisma.organization.findUnique({
    where: { slug: CONCERT_ORG_SLUG },
    select: {
      id: true,
      nombre: true,
      concertModuleEnabled: true,
      exchangeRate: true,
    },
  });

  if (!org) {
    console.error(`❌ No existe organización slug="${CONCERT_ORG_SLUG}"`);
    process.exit(1);
  }

  const exchangeRate = resolveConcertExchangeRate(org.exchangeRate);

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
    event = await createFullEvent(org.id, exchangeRate);
    console.log(`✅ Evento creado: ${event.slug}`);
  } else {
    await removeVipSectionIfPossible(event.id);

    const seatCount = await prisma.concertSeat.count({
      where: { section: { eventId: event.id } },
    });

    if (seatCount === HEMENEGILDA_LEGACY_TOTAL_WITH_VIP) {
      await removeVipSectionIfPossible(event.id);
    }

    const currentCount = await prisma.concertSeat.count({
      where: { section: { eventId: event.id } },
    });

    if (currentCount !== HEMENEGILDA_SALON_SEAT_COUNT) {
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
      event = await createFullEvent(org.id, exchangeRate);
      console.log(
        `✅ Layout reconstruido (${currentCount} → ${HEMENEGILDA_SALON_SEAT_COUNT} asientos)`,
      );
    } else {
      await syncCatalogPrices(event.id, exchangeRate);
      await prisma.concertEvent.update({
        where: { id: event.id },
        data: {
          eventStartsAt: MONDDY_HEMENEGILDA_EVENT_STARTS_AT,
          ...monddyConcertPaymentFields(),
        },
      });
      console.log(
        `✅ Evento ya existía con ${HEMENEGILDA_SALON_SEAT_COUNT} asientos (fecha y pago actualizados)`,
      );
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
