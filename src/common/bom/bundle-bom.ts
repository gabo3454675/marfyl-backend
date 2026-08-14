/**
 * BOM de combos/tobos: receta de 1 nivel (combo → productos sueltos).
 * No hay combos anidados ni grafo: el stock vive en los componentes.
 */

export type BomLine = { productId: number; quantity: number };

export function parseBomLines(raw: unknown): BomLine[] {
  if (!Array.isArray(raw)) return [];
  const merged = new Map<number, number>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as { productId?: unknown; quantity?: unknown };
    const productId = Number(o.productId);
    const quantity = Number(o.quantity);
    if (!Number.isFinite(productId) || productId <= 0) continue;
    if (!Number.isFinite(quantity) || quantity < 1) continue;
    const qty = Math.max(1, Math.floor(quantity));
    merged.set(productId, (merged.get(productId) ?? 0) + qty);
  }
  return [...merged.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

/** Componentes necesarios para `comboQty` unidades del combo (1 nivel). */
export function explodeBom(lines: BomLine[], comboQty: number): BomLine[] {
  const n = Number.isFinite(comboQty) ? Math.max(0, Math.floor(comboQty)) : 0;
  if (n === 0) return [];
  const merged = new Map<number, number>();
  for (const line of lines) {
    if (line.productId <= 0 || line.quantity < 1) continue;
    merged.set(
      line.productId,
      (merged.get(line.productId) ?? 0) + line.quantity * n,
    );
  }
  return [...merged.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

export function maxBuildable(
  lines: BomLine[],
  stockById: Map<number, number>,
): { max: number; bottleneckProductId: number | null } {
  if (lines.length === 0) {
    return { max: 0, bottleneckProductId: null };
  }
  let max = Number.POSITIVE_INFINITY;
  let bottleneckProductId: number | null = null;
  for (const line of lines) {
    const per = line.quantity > 0 ? line.quantity : 0;
    const stock = stockById.get(line.productId) ?? 0;
    const can = per > 0 ? Math.floor(Math.max(0, stock) / per) : 0;
    if (can < max) {
      max = can;
      bottleneckProductId = line.productId;
    }
  }
  return {
    max: Number.isFinite(max) ? max : 0,
    bottleneckProductId,
  };
}

/** Combos cuya receta usa el componente dado. */
export function combosUsingComponent(
  combos: { id: number; lines: BomLine[] }[],
  componentId: number,
): number[] {
  return combos
    .filter((c) => c.lines.some((l) => l.productId === componentId))
    .map((c) => c.id);
}
