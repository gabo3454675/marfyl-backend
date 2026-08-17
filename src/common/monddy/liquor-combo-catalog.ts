/**
 * Catálogo Monddy de 16 combos de licores (isBundle) + receta BOM SKU.
 * Consumido por scripts/seed-monddy-liquor-combos.ts.
 *
 * BOM = botella + 4 vasos + 1 media hielo + mixers.
 * Descorche NUNCA en bundleComponents — solo anotación via resolveComboDescorcheHint.
 * Beers / tobos OUT.
 */

import {
  EXISTING_DESCORCHE_SKUS,
  resolveComboDescorcheHint,
  type ComboDescorcheHint,
} from "./descorche-catalog";

/** Componentes compartidos de todos los combos */
export const COMBO_SHARED_SKUS = {
  cups: "7590200270066", // VASOS PLASTICOS LOS LLANOS N° 27 — qty 4
  halfIce: "00001256", // MEDIA BOLSA DE HIELO — qty 1
  agua: "7590386000013", // AGUA GLACIER 380 ML
  soda: "7591031004592", // MINALBA SPARKLING SODA LATA 355 ML
  pepsi1L: "7591031000983",
  sevenUp1L: "7591031001003",
  gatorade: "7702192422051", // GATORADE TROPICAL 500 ML
} as const;

/** SKUs de tarifas isService — prohibidos en BOM de combo */
export const DESCORCHE_SKU_BLOCKLIST = new Set<string>([
  "DESCORCHE-30",
  "DESCORCHE-20",
  "DESCORCHE-15",
  "DESCORCHE-10",
  EXISTING_DESCORCHE_SKUS.vip,
  EXISTING_DESCORCHE_SKUS.vino,
]);

export type BomSkuRole = "bottle" | "cups" | "ice" | "mixer";

export type BomSkuLine = {
  sku: string;
  quantity: number;
  role: BomSkuRole;
};

export type LiquorComboDef = {
  sku: string;
  name: string;
  /** Precio Ref USD del cartel */
  salePrice: number;
  bottleSku: string;
  /** Si bottleSku no existe en catálogo (p. ej. COMBO-13 Rosario → Misiones) */
  alternateBottleSku?: string;
  extras: { sku: string; quantity: number }[];
};

/**
 * 16 combos COMBO-01…15B. salePrice = Ref USD.
 * Mixers en extras; vasos+hielo se añaden siempre en comboBomSkuLines.
 */
export const LIQUOR_COMBOS: LiquorComboDef[] = [
  {
    sku: "COMBO-01",
    name: "Combo Buchanan 18",
    salePrice: 180,
    bottleSku: "50196913",
    extras: [
      { sku: COMBO_SHARED_SKUS.soda, quantity: 2 },
      { sku: COMBO_SHARED_SKUS.agua, quantity: 2 },
    ],
  },
  {
    sku: "COMBO-02",
    name: "Combo Master",
    salePrice: 80,
    bottleSku: "50019603774",
    extras: [
      { sku: COMBO_SHARED_SKUS.soda, quantity: 2 },
      { sku: COMBO_SHARED_SKUS.agua, quantity: 2 },
    ],
  },
  {
    sku: "COMBO-03",
    name: "Combo Buch 12",
    salePrice: 65,
    bottleSku: "50196388",
    extras: [
      { sku: COMBO_SHARED_SKUS.soda, quantity: 2 },
      { sku: COMBO_SHARED_SKUS.agua, quantity: 2 },
    ],
  },
  {
    sku: "COMBO-04",
    name: "Combo Old Parr",
    salePrice: 55,
    bottleSku: "5000281003160",
    extras: [
      { sku: COMBO_SHARED_SKUS.soda, quantity: 2 },
      { sku: COMBO_SHARED_SKUS.agua, quantity: 2 },
    ],
  },
  {
    sku: "COMBO-05",
    name: "Combo B&W",
    salePrice: 35,
    bottleSku: "50196081",
    extras: [
      { sku: COMBO_SHARED_SKUS.soda, quantity: 1 },
      { sku: COMBO_SHARED_SKUS.agua, quantity: 1 },
    ],
  },
  {
    sku: "COMBO-06",
    name: "Combo Grants",
    salePrice: 35,
    bottleSku: "5010327000039",
    extras: [
      { sku: COMBO_SHARED_SKUS.soda, quantity: 1 },
      { sku: COMBO_SHARED_SKUS.agua, quantity: 1 },
    ],
  },
  {
    sku: "COMBO-07",
    name: "Combo Dewars",
    salePrice: 35,
    bottleSku: "5000277001200",
    extras: [{ sku: COMBO_SHARED_SKUS.agua, quantity: 1 }],
  },
  {
    sku: "COMBO-08",
    name: "Combo Famous Grouse",
    salePrice: 25,
    bottleSku: "5010314750008",
    extras: [
      { sku: COMBO_SHARED_SKUS.soda, quantity: 1 },
      { sku: COMBO_SHARED_SKUS.agua, quantity: 1 },
    ],
  },
  {
    sku: "COMBO-09",
    name: "Combo Gran Marques",
    salePrice: 20,
    bottleSku: "7598544000080",
    extras: [{ sku: COMBO_SHARED_SKUS.pepsi1L, quantity: 1 }],
  },
  {
    sku: "COMBO-10",
    name: "Combo Carupano 6",
    salePrice: 25,
    bottleSku: "7591323001209",
    extras: [{ sku: COMBO_SHARED_SKUS.pepsi1L, quantity: 1 }],
  },
  {
    sku: "COMBO-11",
    name: "Combo Santa Teresa",
    salePrice: 20,
    bottleSku: "7591156404864",
    extras: [{ sku: COMBO_SHARED_SKUS.pepsi1L, quantity: 1 }],
  },
  {
    sku: "COMBO-12",
    name: "Combo Gato Negro",
    salePrice: 20,
    bottleSku: "7804300010638",
    extras: [],
  },
  {
    sku: "COMBO-13",
    name: "Combo Rosario Merlot",
    salePrice: 18,
    bottleSku: "7804436702537",
    /** VINO TINTO MISIONES D RENGO 0.75ML */
    alternateBottleSku: "7808704700140",
    extras: [],
  },
  {
    sku: "COMBO-14",
    name: "Combo Benizar",
    salePrice: 12,
    bottleSku: "8410479014118",
    extras: [],
  },
  {
    sku: "COMBO-15A",
    name: "Combo Caroreña",
    salePrice: 18,
    bottleSku: "7591446001599",
    extras: [{ sku: COMBO_SHARED_SKUS.sevenUp1L, quantity: 1 }],
  },
  {
    sku: "COMBO-15B",
    name: "Combo Anís",
    salePrice: 15,
    bottleSku: "7592254011503",
    extras: [{ sku: COMBO_SHARED_SKUS.gatorade, quantity: 1 }],
  },
];

/** Receta BOM por SKU (sin descorche). bottleSkuOverride para alt. COMBO-13. */
export function comboBomSkuLines(
  combo: LiquorComboDef,
  opts?: { bottleSkuOverride?: string },
): BomSkuLine[] {
  const bottleSku = opts?.bottleSkuOverride ?? combo.bottleSku;
  const lines: BomSkuLine[] = [
    { sku: bottleSku, quantity: 1, role: "bottle" },
    { sku: COMBO_SHARED_SKUS.cups, quantity: 4, role: "cups" },
    { sku: COMBO_SHARED_SKUS.halfIce, quantity: 1, role: "ice" },
    ...combo.extras.map((e) => ({
      sku: e.sku,
      quantity: e.quantity,
      role: "mixer" as const,
    })),
  ];
  assertNoDescorcheSkusInBom(lines.map((l) => l.sku));
  return lines;
}

/** Falla si algún SKU de tarifa descorche aparece en la receta. */
export function assertNoDescorcheSkusInBom(skus: string[]): void {
  const hit = skus.find((s) => DESCORCHE_SKU_BLOCKLIST.has(s));
  if (hit) {
    throw new Error(
      `BOM de combo no puede incluir descorche/servicio SKU "${hit}"`,
    );
  }
}

/**
 * Anotación para product.description (POS/ops).
 * No implica auto-agregar línea de descorche.
 */
export function formatComboDescorcheDescription(
  comboSku: string,
  opts?: { vipResolvedSku?: string },
): string | null {
  const hint = resolveComboDescorcheHint(comboSku, opts);
  if (!hint) return null;
  return `suggestedDescorcheSku=${hint.suggestedDescorcheSku} tariffUsd=${hint.tariffUsd}`;
}

export type ComboMatrixRow = {
  sku: string;
  name: string;
  salePrice: number;
  bottleSku: string;
  alternateBottleSku?: string;
  bomSkus: BomSkuLine[];
  descorcheHint: ComboDescorcheHint | null;
  description: string | null;
};

/** Matriz completa 16× para seed / docs / tests. */
export function liquorComboMatrix(
  opts?: { vipResolvedSku?: string },
): ComboMatrixRow[] {
  return LIQUOR_COMBOS.map((combo) => {
    const descorcheHint = resolveComboDescorcheHint(combo.sku, opts);
    return {
      sku: combo.sku,
      name: combo.name,
      salePrice: combo.salePrice,
      bottleSku: combo.bottleSku,
      alternateBottleSku: combo.alternateBottleSku,
      bomSkus: comboBomSkuLines(combo),
      descorcheHint,
      description: formatComboDescorcheDescription(combo.sku, opts),
    };
  });
}

/** Todos los SKUs de componentes a resolver en DB (incluye alternate bottles). */
export function allComboComponentSkus(): string[] {
  const skus = new Set<string>([
    COMBO_SHARED_SKUS.cups,
    COMBO_SHARED_SKUS.halfIce,
    COMBO_SHARED_SKUS.agua,
    COMBO_SHARED_SKUS.soda,
    COMBO_SHARED_SKUS.pepsi1L,
    COMBO_SHARED_SKUS.sevenUp1L,
    COMBO_SHARED_SKUS.gatorade,
  ]);
  for (const c of LIQUOR_COMBOS) {
    skus.add(c.bottleSku);
    if (c.alternateBottleSku) skus.add(c.alternateBottleSku);
    for (const e of c.extras) skus.add(e.sku);
  }
  return [...skus];
}
