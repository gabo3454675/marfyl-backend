/**
 * Catálogo oficial — Horacio Blanco / Hemenegilda Capacidad
 * Salón evento: 66 asientos (mesas 1–20), precios fijos USD + Bs por asiento.
 * Salón VIP: 32 asientos (mesas 1–8 × 4) — precios VIP: confirmar con cliente si difieren.
 */

export type ConcertTierCode =
  | "VIP"
  | "PREFERENCIAL"
  | "MEDIA"
  | "GENERAL"
  | "VIP_SALON";

export type SeatCatalogEntry = {
  sectionCode: "SALON" | "VIP";
  mesaNumber: number;
  /** Número global mostrado al comprador (1–66 salón, 1–32 VIP) */
  displayNumber: number;
  priceUsd: number;
  priceBs: number;
  tierCode: ConcertTierCode;
  tierLabel: string;
};

/** Mesas del salón — planilla flyer Monddy (total 66 personas).
 *  Tabla visible: 01=4, 02=2, 05=4, 09=2, 10=2, 11–12=4, 14=4, 16–17=2, 18=3, 19–20=4.
 *  Resto (03,04,06,07,08,13,15): completan el total 66 con la distribución física del plano.
 */
const SALON_MESAS: {
  mesa: number;
  seats: number[];
  priceUsd: number;
  priceBs: number;
  tier: ConcertTierCode;
  label: string;
}[] = [
  {
    mesa: 3,
    seats: [1, 2, 3, 4],
    priceUsd: 60,
    priceBs: 70,
    tier: "VIP",
    label: "Silla VIP",
  },
  {
    mesa: 4,
    seats: [5, 6, 7],
    priceUsd: 60,
    priceBs: 70,
    tier: "VIP",
    label: "Silla VIP",
  },
  {
    mesa: 7,
    seats: [8, 9, 10, 11],
    priceUsd: 60,
    priceBs: 70,
    tier: "VIP",
    label: "Silla VIP",
  },
  {
    mesa: 8,
    seats: [12, 13, 14, 15],
    priceUsd: 60,
    priceBs: 70,
    tier: "VIP",
    label: "Silla VIP",
  },
  {
    mesa: 1,
    seats: [16, 17, 18, 19],
    priceUsd: 50,
    priceBs: 60,
    tier: "PREFERENCIAL",
    label: "Silla preferencial",
  },
  {
    mesa: 2,
    seats: [20, 21],
    priceUsd: 50,
    priceBs: 60,
    tier: "PREFERENCIAL",
    label: "Silla preferencial",
  },
  {
    mesa: 5,
    seats: [22, 23, 24, 25],
    priceUsd: 50,
    priceBs: 60,
    tier: "PREFERENCIAL",
    label: "Silla preferencial",
  },
  {
    mesa: 6,
    seats: [26, 27, 28, 29],
    priceUsd: 50,
    priceBs: 60,
    tier: "PREFERENCIAL",
    label: "Silla preferencial",
  },
  {
    mesa: 9,
    seats: [30, 31],
    priceUsd: 45,
    priceBs: 55,
    tier: "MEDIA",
    label: "Silla media",
  },
  {
    mesa: 10,
    seats: [32, 33],
    priceUsd: 45,
    priceBs: 55,
    tier: "MEDIA",
    label: "Silla media",
  },
  {
    mesa: 11,
    seats: [34, 35, 36, 37],
    priceUsd: 45,
    priceBs: 55,
    tier: "MEDIA",
    label: "Silla media",
  },
  {
    mesa: 12,
    seats: [38, 39, 40, 41],
    priceUsd: 45,
    priceBs: 55,
    tier: "MEDIA",
    label: "Silla media",
  },
  {
    mesa: 13,
    seats: [42, 43],
    priceUsd: 45,
    priceBs: 55,
    tier: "MEDIA",
    label: "Silla media",
  },
  {
    mesa: 14,
    seats: [44, 45, 46, 47],
    priceUsd: 45,
    priceBs: 55,
    tier: "MEDIA",
    label: "Silla media",
  },
  {
    mesa: 15,
    seats: [48, 49, 50, 51],
    priceUsd: 40,
    priceBs: 50,
    tier: "GENERAL",
    label: "Silla general",
  },
  {
    mesa: 16,
    seats: [52, 53],
    priceUsd: 40,
    priceBs: 50,
    tier: "GENERAL",
    label: "Silla general",
  },
  {
    mesa: 17,
    seats: [54, 55],
    priceUsd: 40,
    priceBs: 50,
    tier: "GENERAL",
    label: "Silla general",
  },
  {
    mesa: 18,
    seats: [56, 57, 58],
    priceUsd: 40,
    priceBs: 50,
    tier: "GENERAL",
    label: "Silla general",
  },
  {
    mesa: 19,
    seats: [59, 60, 61, 62],
    priceUsd: 40,
    priceBs: 50,
    tier: "GENERAL",
    label: "Silla general",
  },
  {
    mesa: 20,
    seats: [63, 64, 65, 66],
    priceUsd: 40,
    priceBs: 50,
    tier: "GENERAL",
    label: "Silla general",
  },
];

/** Salón VIP: 8 mesas × 4 asientos — tarifa única hasta confirmar planilla VIP */
const VIP_PRICE_USD = 70;
const VIP_PRICE_BS = 85;

function buildSalonCatalog(): SeatCatalogEntry[] {
  const out: SeatCatalogEntry[] = [];
  for (const m of SALON_MESAS) {
    for (const displayNumber of m.seats) {
      out.push({
        sectionCode: "SALON",
        mesaNumber: m.mesa,
        displayNumber,
        priceUsd: m.priceUsd,
        priceBs: m.priceBs,
        tierCode: m.tier,
        tierLabel: m.label,
      });
    }
  }
  return out;
}

function buildVipCatalog(): SeatCatalogEntry[] {
  const out: SeatCatalogEntry[] = [];
  let displayNumber = 0;
  for (let mesa = 1; mesa <= 8; mesa++) {
    for (let pos = 1; pos <= 4; pos++) {
      displayNumber += 1;
      out.push({
        sectionCode: "VIP",
        mesaNumber: mesa,
        displayNumber,
        priceUsd: VIP_PRICE_USD,
        priceBs: VIP_PRICE_BS,
        tierCode: "VIP_SALON",
        tierLabel: "Salón VIP",
      });
    }
  }
  return out;
}

export const HEMENEGILDA_SEAT_CATALOG: SeatCatalogEntry[] = [
  ...buildSalonCatalog(),
  ...buildVipCatalog(),
];

export function assertCatalogIntegrity() {
  const salon = HEMENEGILDA_SEAT_CATALOG.filter(
    (s) => s.sectionCode === "SALON",
  );
  const vip = HEMENEGILDA_SEAT_CATALOG.filter((s) => s.sectionCode === "VIP");
  if (salon.length !== 66)
    throw new Error(`Salón: esperados 66 asientos, hay ${salon.length}`);
  if (vip.length !== 32)
    throw new Error(`VIP: esperados 32 asientos, hay ${vip.length}`);
  const nums = new Set(salon.map((s) => s.displayNumber));
  if (nums.size !== 66)
    throw new Error("Salón: números de asiento duplicados o incompletos");
}

assertCatalogIntegrity();
