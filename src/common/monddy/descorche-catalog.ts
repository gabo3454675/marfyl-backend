/**
 * Catálogo Monddy de tarifas de descorche (isService) + mapeo combo→tarifa.
 * Consumido por scripts/seed-monddy-descorches.ts y documentado para TASK-004 combos.
 *
 * BOM v1: vacío (sin botella). Acompañamientos opcionales se añaden después
 * como líneas explícitas de rol "accompaniment" — no por heurística de nombre.
 */

/** SKUs conocidos en Excel / catálogo Monddy */
export const EXISTING_DESCORCHE_SKUS = {
  /** DESCORCHE VIP — tarifa $20 si el precio coincide */
  vip: "0000112",
  /** Descorche vino — tarifa $10 (mapeo vinos COMBO-12/13) */
  vino: "0000125",
} as const;

/** Fallback si VIP 0000112 existe pero salePrice ≠ 20 */
export const VIP_FALLBACK_SKU = "DESCORCHE-20";

export type DescorcheTariffUsd = 30 | 20 | 15 | 10;

export type DescorcheRole = "tariff";

/**
 * Definición de producto tarifa. BOM vacío a propósito (v1):
 * - isService cobra la tarifa
 * - saleMode=DESCORCHE no baja botella
 * - acompañamientos se pueden agregar luego sin SKUs de botella
 */
export type DescorcheTariffDef = {
  /** SKU canónico a crear / preferir */
  sku: string;
  name: string;
  salePrice: DescorcheTariffUsd;
  /** Si true, al seed se intenta reutilizar este SKU solo si salePrice coincide */
  reuseIfPriceMatches?: boolean;
  /** SKU alterno si reuseIfPriceMatches falla */
  fallbackSku?: string;
  /** Rol explícito (evita heurísticas por nombre en BOM) */
  role: DescorcheRole;
  /**
   * isExempt: si se conoce de Excel al upsert, se preserva el valor existente.
   * Para altas nuevas: true (servicios VIP/VINO en Monddy suelen ir exentos).
   */
  defaultIsExempt: boolean;
};

/**
 * Cuatro tarifas de cartel + VINO dedicado a vinos.
 * Beers OUT — no hay tarifas de cerveza aquí.
 */
export const DESCORCHE_TARIFFS: DescorcheTariffDef[] = [
  {
    sku: "DESCORCHE-30",
    name: "Descorche $30",
    salePrice: 30,
    role: "tariff",
    defaultIsExempt: true,
  },
  {
    sku: EXISTING_DESCORCHE_SKUS.vip,
    name: "DESCORCHE VIP",
    salePrice: 20,
    reuseIfPriceMatches: true,
    fallbackSku: VIP_FALLBACK_SKU,
    role: "tariff",
    defaultIsExempt: true,
  },
  {
    sku: "DESCORCHE-15",
    name: "Descorche $15",
    salePrice: 15,
    role: "tariff",
    defaultIsExempt: true,
  },
  {
    sku: "DESCORCHE-10",
    name: "Descorche $10",
    salePrice: 10,
    role: "tariff",
    defaultIsExempt: true,
  },
  {
    sku: EXISTING_DESCORCHE_SKUS.vino,
    name: "DESCORCHE VINO",
    salePrice: 10,
    reuseIfPriceMatches: true,
    fallbackSku: "DESCORCHE-10",
    role: "tariff",
    defaultIsExempt: true,
  },
];

/**
 * Mapeo combo → tarifa USD / SKU sugerido (anotación; no auto-agrega línea en POS).
 *
 * COMBO-01 → 30 (DESCORCHE-30)
 * COMBO-02..04 → 20 (VIP 0000112 o DESCORCHE-20)
 * COMBO-05..07 → 15 (DESCORCHE-15)
 * COMBO-08 → 10 (DESCORCHE-10 genérico)
 * COMBO-12..13 → 10 (VINO 0000125 — vinos)
 * else → none
 */
export type ComboDescorcheHint = {
  comboSku: string;
  tariffUsd: DescorcheTariffUsd;
  /** SKU preferido de la tarifa isService */
  suggestedDescorcheSku: string;
};

const COMBO_TO_TARIFF: Record<string, DescorcheTariffUsd | null> = {
  "COMBO-01": 30,
  "COMBO-02": 20,
  "COMBO-03": 20,
  "COMBO-04": 20,
  "COMBO-05": 15,
  "COMBO-06": 15,
  "COMBO-07": 15,
  "COMBO-08": 10,
  "COMBO-09": null,
  "COMBO-10": null,
  "COMBO-11": null,
  "COMBO-12": 10,
  "COMBO-13": 10,
  "COMBO-14": null,
  "COMBO-15A": null,
  "COMBO-15B": null,
};

/** Vinos usan SKU VINO; el resto de $10 usa DESCORCHE-10 genérico. */
const WINE_COMBOS = new Set(["COMBO-12", "COMBO-13"]);

export function suggestedDescorcheSkuForTariff(
  tariffUsd: DescorcheTariffUsd,
  opts?: { wine?: boolean; vipResolvedSku?: string },
): string {
  switch (tariffUsd) {
    case 30:
      return "DESCORCHE-30";
    case 20:
      return opts?.vipResolvedSku ?? EXISTING_DESCORCHE_SKUS.vip;
    case 15:
      return "DESCORCHE-15";
    case 10:
      return opts?.wine
        ? EXISTING_DESCORCHE_SKUS.vino
        : "DESCORCHE-10";
    default: {
      const _exhaustive: never = tariffUsd;
      return _exhaustive;
    }
  }
}

export function resolveComboDescorcheHint(
  comboSku: string,
  opts?: { vipResolvedSku?: string },
): ComboDescorcheHint | null {
  const tariff = COMBO_TO_TARIFF[comboSku];
  if (tariff == null) return null;
  return {
    comboSku,
    tariffUsd: tariff,
    suggestedDescorcheSku: suggestedDescorcheSkuForTariff(tariff, {
      wine: WINE_COMBOS.has(comboSku),
      vipResolvedSku: opts?.vipResolvedSku,
    }),
  };
}

/** Lista completa de hints para los 16 combos conocidos (null = sin descorche). */
export function allComboDescorcheHints(
  opts?: { vipResolvedSku?: string },
): Array<ComboDescorcheHint | { comboSku: string; tariffUsd: null }> {
  return Object.keys(COMBO_TO_TARIFF).map((comboSku) => {
    const hint = resolveComboDescorcheHint(comboSku, opts);
    if (hint) return hint;
    return { comboSku, tariffUsd: null };
  });
}

/**
 * Decide SKU efectivo para una tarifa con reuseIfPriceMatches.
 * No toca DB: el seed pasa el salePrice encontrado (o null si no existe).
 */
export function resolveReusableSku(params: {
  preferredSku: string;
  fallbackSku: string;
  targetPrice: number;
  existingSalePrice: number | null;
}): { sku: string; reason: "reuse" | "create_preferred" | "fallback_price_mismatch" } {
  const { preferredSku, fallbackSku, targetPrice, existingSalePrice } = params;
  if (existingSalePrice == null) {
    return { sku: preferredSku, reason: "create_preferred" };
  }
  if (Number(existingSalePrice) === Number(targetPrice)) {
    return { sku: preferredSku, reason: "reuse" };
  }
  return { sku: fallbackSku, reason: "fallback_price_mismatch" };
}

/** BOM v1: vacío — sin botellas ni acompañamientos. */
export const EMPTY_DESCORCHE_BOM: [] = [];
