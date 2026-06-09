/**
 * Catálogo oficial — Horacio Blanco / Hemenegilda Capacidad
 * Salón de eventos: 66 asientos (mesas 1–20).
 * Cada asiento tiene dos precios del flyer:
 * - priceUsd: efectivo en divisas (ej. $60)
 * - priceBs: monto USD para pago en bolívares (ej. $70), se multiplica × tasa BCV al cobrar
 */

export const HEMENEGILDA_SALON_SEAT_COUNT = 66;
/** Layout legacy con sección VIP aparte (ya no se usa). */
export const HEMENEGILDA_LEGACY_TOTAL_WITH_VIP = 98;
export const HEMENEGILDA_VIP_SECTION_CODE = "VIP" as const;

export type ConcertTierCode =
  | "VIP"
  | "PREFERENCIAL"
  | "MEDIA"
  | "GENERAL";

export type SeatCatalogEntry = {
  sectionCode: "SALON";
  mesaNumber: number;
  /** Número global mostrado al comprador (1–66 salón) */
  displayNumber: number;
  /** Efectivo USD */
  priceUsd: number;
  /** USD al cambio para pago en bolívares (× BCV) */
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

export const HEMENEGILDA_SEAT_CATALOG: SeatCatalogEntry[] = buildSalonCatalog();

export function assertCatalogIntegrity() {
  const salon = HEMENEGILDA_SEAT_CATALOG;
  if (salon.length !== HEMENEGILDA_SALON_SEAT_COUNT)
    throw new Error(
      `Salón: esperados ${HEMENEGILDA_SALON_SEAT_COUNT} asientos, hay ${salon.length}`,
    );
  const nums = new Set(salon.map((s) => s.displayNumber));
  if (nums.size !== HEMENEGILDA_SALON_SEAT_COUNT)
    throw new Error("Salón: números de asiento duplicados o incompletos");
}

assertCatalogIntegrity();
