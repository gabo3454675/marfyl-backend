/**
 * Stock por modalidad de venta (SaleMode).
 * DESCORCHE: nunca toca botella; solo acompañamientos BOM del servicio.
 * Combo (isBundle): siempre componentes BOM, nunca el padre.
 *
 * Invariantes BOM (TASK-005):
 * - componente isService / isBundle → no descuenta stock (rechazo)
 * - BOM de isService (descorche) no puede incluir botella/licor
 * - varias líneas → mergeBomNeeds por productId antes de chequear stock
 */

import { classifyLiquorProduct } from "@/modules/invoices/liquor-sales.util";
import {
  BomLine,
  explodeBom,
  mergeBomNeeds,
  parseBomLines,
} from "./bundle-bom";

export type SaleModeValue = "STANDARD" | "DESCORCHE" | "COMBO";

export type StockProductLike = {
  id: number;
  name: string;
  isBundle: boolean;
  isService: boolean;
  bundleComponents?: unknown;
};

export type BomStockComponentLike = {
  id: number;
  name: string;
  isBundle: boolean;
  isService: boolean;
};

export type UnstockableBomNeed = {
  productId: number;
  name: string;
  reason: "isService" | "isBundle" | "missing";
};

export function resolveSaleMode(
  raw?: string | null,
): SaleModeValue {
  if (raw === "DESCORCHE" || raw === "COMBO") return raw;
  return "STANDARD";
}

/** True si la línea descuenta el producto padre (no combo/servicio). */
export function deductsParentStock(product: {
  isBundle: boolean;
  isService: boolean;
}): boolean {
  return !product.isBundle && !product.isService;
}

/**
 * Filtra BOM dejando solo acompañamientos (excluye botellas/licores clasificados).
 * Usado en saleMode=DESCORCHE.
 */
export function accompanimentBomOnly(
  lines: BomLine[],
  nameByProductId: Map<number, string>,
): BomLine[] {
  return lines.filter((line) => {
    const name = nameByProductId.get(line.productId) ?? "";
    return classifyLiquorProduct(name) === null;
  });
}

/**
 * Receta BOM relevante para stock según producto + saleMode.
 * - isBundle: BOM completo
 * - isService + DESCORCHE: acompañamientos (sin botella)
 * - isService + STANDARD/COMBO: BOM completo (si hay)
 * - producto normal: []
 */
export function bomLinesForStock(
  product: {
    isBundle: boolean;
    isService: boolean;
    bundleComponents?: unknown;
  },
  saleMode: SaleModeValue,
  nameByProductId: Map<number, string>,
): BomLine[] {
  const comps = parseBomLines(product.bundleComponents);
  if (product.isBundle) {
    return comps;
  }
  if (product.isService) {
    if (saleMode === "DESCORCHE") {
      return accompanimentBomOnly(comps, nameByProductId);
    }
    return comps;
  }
  return [];
}

/**
 * Necesidades de stock (reserva o descuento) agregadas por productId.
 * Incluye productos normales (padre) y componentes BOM según saleMode.
 */
export function collectSaleStockNeeds(
  lines: Array<{
    productId: number;
    quantity: number;
    saleMode?: string | null;
  }>,
  productById: Map<number, StockProductLike>,
  nameByProductId: Map<number, string>,
): BomLine[] {
  const lists: BomLine[][] = [];
  for (const line of lines) {
    const product = productById.get(line.productId);
    if (!product) continue;
    const saleMode = resolveSaleMode(line.saleMode);
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    if (qty < 1) continue;

    if (deductsParentStock(product)) {
      lists.push([{ productId: product.id, quantity: qty }]);
      continue;
    }

    const bom = bomLinesForStock(product, saleMode, nameByProductId);
    lists.push(explodeBom(bom, qty));
  }
  return mergeBomNeeds(lists);
}

/** IDs de componentes BOM referenciados por productos línea (para precargar nombres/stock). */
export function collectReferencedBomProductIds(
  products: Array<{ isBundle: boolean; isService: boolean; bundleComponents?: unknown }>,
): number[] {
  const ids = new Set<number>();
  for (const p of products) {
    if (!p.isBundle && !p.isService) continue;
    for (const c of parseBomLines(p.bundleComponents)) {
      ids.add(c.productId);
    }
  }
  return [...ids];
}

/**
 * Primera necesidad de stock que apunta a isService / isBundle / inexistente.
 * Tras mergeBomNeeds, ninguna necesidad válida puede ser servicio o combo anidado.
 */
export function findUnstockableBomNeed(
  needs: BomLine[],
  productById: Map<number, BomStockComponentLike>,
): UnstockableBomNeed | null {
  for (const need of needs) {
    const child = productById.get(need.productId);
    if (!child) {
      return {
        productId: need.productId,
        name: `#${need.productId}`,
        reason: "missing",
      };
    }
    if (child.isService) {
      return {
        productId: child.id,
        name: child.name,
        reason: "isService",
      };
    }
    if (child.isBundle) {
      return {
        productId: child.id,
        name: child.name,
        reason: "isBundle",
      };
    }
  }
  return null;
}

/**
 * Invariante catálogo: BOM de isService (descorche) no incluye botella/licor.
 * Heurística vía classifyLiquorProduct (sin columna role en schema).
 */
export function findBottleInBom(
  lines: BomLine[],
  nameByProductId: Map<number, string>,
): BomLine | null {
  for (const line of lines) {
    const name = nameByProductId.get(line.productId) ?? "";
    if (classifyLiquorProduct(name) !== null) {
      return line;
    }
  }
  return null;
}

/** Mensaje operativo para rechazo de componente no descontable. */
export function unstockableBomNeedMessage(
  bad: UnstockableBomNeed,
  parentLabel = "la receta",
): string {
  if (bad.reason === "missing") {
    return `Componente de stock no encontrado: producto ${bad.productId}`;
  }
  if (bad.reason === "isService") {
    return `El componente "${bad.name}" es un servicio y no puede descontar stock de ${parentLabel}`;
  }
  return `El componente "${bad.name}" es un combo anidado; ${parentLabel} solo admite productos sueltos`;
}
