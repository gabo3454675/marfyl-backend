import * as ExcelJS from "exceljs";

// ---------------------------------------------------------------------------
// Interfaces públicas
// ---------------------------------------------------------------------------

export interface ParsedVariant {
  name: string;
  salePrice: number;
  unitQuantity: number;
  stockBehavior: "DEDUCT" | "NO_DEDUCT";
  customCost: number | null;
  inheritCost: boolean;
}

export interface ParsedProductWithVariants {
  sku: string;
  name: string;
  category: string;
  costPrice: number;
  salePrice: number;
  stock: number;
  isActive: boolean;
  variants: ParsedVariant[];
}

// ---------------------------------------------------------------------------
// Helpers de inferencia
// ---------------------------------------------------------------------------

/**
 * Infiere unitQuantity según el nombre de la variante:
 * - "BOTELLA" → 1
 * - "TOBO"    → 12
 * - "CAJA"    → 36  (si contiene "1/2" → 18)
 * - "SERVICIO" → 1
 * - default    → 1
 */
export function inferUnitQuantity(variantName: string): number {
  const name = variantName.toUpperCase();

  if (name.includes("1/2 CAJA")) return 18;
  if (name.includes("CAJA")) return 36;
  if (name.includes("TOBO")) return 12;
  if (name.includes("BOTELLA")) return 1;
  if (name.includes("SERVICIO")) return 1;

  return 1;
}

/**
 * Infiere stockBehavior según el nombre de la variante:
 * - Contiene "SERVICIO" → NO_DEDUCT
 * - Resto               → DEDUCT
 */
export function inferStockBehavior(
  variantName: string,
): "DEDUCT" | "NO_DEDUCT" {
  const name = variantName.toUpperCase();
  return name.includes("SERVICIO") ? "NO_DEDUCT" : "DEDUCT";
}

// ---------------------------------------------------------------------------
// Helpers numéricos
// ---------------------------------------------------------------------------

function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number") return value;
  const s = String(value).replace(",", ".").trim();
  return parseFloat(s);
}

// ---------------------------------------------------------------------------
// Parser principal
// ---------------------------------------------------------------------------

/**
 * Parsea un archivo Excel en formato MonddY (jerárquico con variantes).
 *
 * Formato esperado (sheet "0607"):
 *   Fila 1:   Título / fecha (se ignora)
 *   Fila 2:   Headers (SKU, NOMBRE DEL PRODUCTO, COSTO, PRECIO VENTA, ...)
 *   Fila 3+:  Datos
 *
 * Columnas (1-based):
 *   A(1): SKU              — si tiene valor → producto base
 *   B(2): NOMBRE DEL PRODUCTO — categoría/familia
 *   C(3): COSTO
 *   D(4): PRECIO VENTA
 *   G(7): NUMERO (stock)
 *   H(8): DESCRIPCION      — nombre real del producto / variante
 *
 * Filas SIN SKU se interpretan como variantes del último producto base.
 */
export async function parseMonddyExcel(
  source: Buffer | string,
): Promise<ParsedProductWithVariants[]> {
  const wb = new ExcelJS.Workbook();

  if (typeof source === "string") {
    await wb.xlsx.readFile(source);
  } else {
    await wb.xlsx.load(source as any);
  }

  const ws = wb.worksheets[0];
  if (!ws) {
    return [];
  }

  const products: ParsedProductWithVariants[] = [];
  let currentProduct: ParsedProductWithVariants | null = null;

  // Datos empiezan en fila 3 (fila 1 = título, fila 2 = headers)
  for (let rowNum = 3; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);

    const sku = String(row.getCell(1).value ?? "").trim();
    const category = String(row.getCell(2).value ?? "").trim();
    const costPrice = parseNumber(row.getCell(3).value);
    const salePrice = parseNumber(row.getCell(4).value);
    const stockRaw = parseNumber(row.getCell(7).value);
    const description = String(row.getCell(8).value ?? "").trim();

    const stock =
      Number.isNaN(stockRaw) || stockRaw < 0 ? 0 : Math.trunc(stockRaw);
    const cost = Number.isNaN(costPrice) ? 0 : costPrice;

    // Si tiene SKU → nuevo producto base
    if (sku) {
      const name = description || category || sku;

      // Guardar el producto anterior antes de empezar uno nuevo
      if (currentProduct) {
        products.push(currentProduct);
      }

      currentProduct = {
        sku,
        name,
        category: category || "",
        costPrice: cost,
        salePrice: Number.isNaN(salePrice) ? 0 : salePrice,
        stock,
        isActive: true,
        variants: [],
      };
      continue;
    }

    // No tiene SKU → posible variante
    if (!currentProduct) {
      // Variante huérfana sin producto base, se omite
      continue;
    }

    // Necesitamos nombre y precio válido para considerar la variante
    const variantName = description || category;
    if (!variantName || Number.isNaN(salePrice) || salePrice <= 0) {
      continue;
    }

    const variant: ParsedVariant = {
      name: variantName,
      salePrice,
      unitQuantity: inferUnitQuantity(variantName),
      stockBehavior: inferStockBehavior(variantName),
      customCost: null,
      inheritCost: true,
    };

    currentProduct.variants.push(variant);
  }

  // Guardar el último producto
  if (currentProduct) {
    products.push(currentProduct);
  }

  // Post-procesamiento: si un producto tiene variantes,
  // su salePrice debe ser el de la primera variante
  for (const product of products) {
    if (product.variants.length > 0) {
      product.salePrice = product.variants[0].salePrice;
    }
  }

  return products;
}
