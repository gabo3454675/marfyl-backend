/**
 * Dirección del movimiento de stock.
 * "out" = salida (venta/consumo), "in" = entrada (compra/reposición).
 */
export type StockDirection = "in" | "out";

/** Proyección de impacto de stock de una línea de importación. */
export interface StockProjection {
  currentStock: number | null;
  stockDelta: number | null;
  finalStock: number | null;
}

/**
 * Proyecta el impacto de stock de una línea de importación (venta/compra).
 * Función pura: sin IO, sin acceso a base de datos.
 *
 * Reglas (EARS):
 * - WHEN el producto no tiene match (`matched` false), THEN devuelve null
 *   en los tres campos (sin importar `affectsStock`).
 * - WHEN el producto está matched y NO afecta stock (`affectsStock` false,
 *   servicio/combo), THEN devuelve `stockDelta = 0` y `finalStock = currentStock`.
 * - WHEN el producto está matched y afecta stock, THEN:
 *   - `currentStock` = valor recibido (si es null, usa 0)
 *   - `stockDelta` = `-quantity` ("out") o `+quantity` ("in")
 *   - `finalStock` = `currentStock + stockDelta`
 */
export function projectStock(params: {
  direction: StockDirection;
  quantity: number;
  currentStock: number | null; // null = producto sin match / desconocido
  affectsStock: boolean; // false para servicios/combos (delta 0)
  matched: boolean; // false = línea sin match de producto
}): StockProjection {
  const { direction, quantity, currentStock, affectsStock, matched } = params;

  if (!matched) {
    return { currentStock: null, stockDelta: null, finalStock: null };
  }

  if (!affectsStock) {
    return { currentStock, stockDelta: 0, finalStock: currentStock };
  }

  const effectiveCurrent = currentStock ?? 0;
  const stockDelta = direction === "out" ? -quantity : quantity;

  return {
    currentStock: effectiveCurrent,
    stockDelta,
    finalStock: effectiveCurrent + stockDelta,
  };
}
