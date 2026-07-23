import * as ExcelJS from "exceljs";
import {
  parseMonddyExcel,
  ParsedProductWithVariants,
  inferUnitQuantity,
  inferStockBehavior,
} from "./monddy-excel.parser";

async function buildMockExcel(
  rows: Array<{
    sku?: string;
    category?: string;
    cost?: number;
    price?: number;
    stock?: number;
    description?: string;
  }>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("0607");

  // Row 1: blank / título (existe en el Excel real)
  ws.getCell("A1").value = "INVENTARIO MONDDY";
  ws.getCell("B1").value = "06/07/2026";

  // Row 2: headers
  ws.getCell("A2").value = "SKU";
  ws.getCell("B2").value = "NOMBRE DEL PRODUCTO";
  ws.getCell("C2").value = "COSTO";
  ws.getCell("D2").value = "PRECIO VENTA";
  ws.getCell("E2").value = "GANANCIA";
  ws.getCell("F2").value = "%";
  ws.getCell("G2").value = "NUMERO";
  ws.getCell("H2").value = "DESCRIPCION";
  ws.getCell("I2").value = "EXENTO";

  // Data rows starting at row 3
  rows.forEach((r, i) => {
    const rowNum = i + 3;
    if (r.sku !== undefined) ws.getCell(`A${rowNum}`).value = r.sku;
    if (r.category !== undefined) ws.getCell(`B${rowNum}`).value = r.category;
    if (r.cost !== undefined) ws.getCell(`C${rowNum}`).value = r.cost;
    if (r.price !== undefined) ws.getCell(`D${rowNum}`).value = r.price;
    if (r.stock !== undefined) ws.getCell(`G${rowNum}`).value = r.stock;
    if (r.description !== undefined)
      ws.getCell(`H${rowNum}`).value = r.description;
  });

  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

describe("MonddY Excel Parser", () => {
  describe("parseMonddyExcel", () => {
    it("parses a single product with no variants (SKU row only)", async () => {
      const buffer = await buildMockExcel([
        {
          sku: "LIC-001",
          category: "LICOR",
          cost: 10,
          price: 25,
          stock: 50,
          description: "Whisky X 12 Años 750ml",
        },
      ]);

      const result = await parseMonddyExcel(buffer);
      expect(result).toHaveLength(1);
      expect(result[0].sku).toBe("LIC-001");
      expect(result[0].name).toBe("Whisky X 12 Años 750ml");
      expect(result[0].category).toBe("LICOR");
      expect(result[0].costPrice).toBe(10);
      expect(result[0].salePrice).toBe(25);
      expect(result[0].stock).toBe(50);
      expect(result[0].isActive).toBe(true);
      expect(result[0].variants).toHaveLength(0);
    });

    it("detects variants as rows without SKU under a base product", async () => {
      const buffer = await buildMockExcel([
        {
          sku: "LIC-002",
          category: "LICOR",
          cost: 15,
          price: 30,
          stock: 20,
          description: "Ron X 12 Años 750ml",
        },
        {
          // No SKU → variant
          category: "",
          cost: undefined,
          price: 35,
          stock: 0,
          description: "BOTELLA SOLA",
        },
        {
          // No SKU → otra variant
          category: "",
          cost: undefined,
          price: 45,
          stock: 0,
          description: "SERVICIO NORMAL",
        },
      ]);

      const result = await parseMonddyExcel(buffer);
      expect(result).toHaveLength(1);
      expect(result[0].sku).toBe("LIC-002");
      expect(result[0].variants).toHaveLength(2);

      // First variant: BOTELLA SOLA
      expect(result[0].variants[0].name).toBe("BOTELLA SOLA");
      expect(result[0].variants[0].salePrice).toBe(35);
      expect(result[0].variants[0].unitQuantity).toBe(1); // BOTELLA → 1
      expect(result[0].variants[0].stockBehavior).toBe("DEDUCT");

      // Second variant: SERVICIO NORMAL
      expect(result[0].variants[1].name).toBe("SERVICIO NORMAL");
      expect(result[0].variants[1].salePrice).toBe(45);
      expect(result[0].variants[1].unitQuantity).toBe(1); // SERVICIO → 1
      expect(result[0].variants[1].stockBehavior).toBe("NO_DEDUCT"); // SERVICIO → NO_DEDUCT
    });

    it("handles multiple products each with their own variants", async () => {
      const buffer = await buildMockExcel([
        {
          sku: "CER-001",
          category: "CERVEZA",
          cost: 0.8,
          price: 1.5,
          stock: 100,
          description: "Polar Pilsen 222ml",
        },
        {
          category: "",
          cost: undefined,
          price: 2,
          stock: 0,
          description: "SERVICIO NORMAL",
        },
        {
          sku: "CER-002",
          category: "CERVEZA",
          cost: 12,
          price: 18,
          stock: 30,
          description: "Polar Pilsen Retornable",
        },
        {
          category: "",
          cost: undefined,
          price: 25,
          stock: 0,
          description: "TOBO 12 BOTELLAS",
        },
        {
          category: "",
          cost: undefined,
          price: 70,
          stock: 0,
          description: "CAJA 36 BOTELLAS",
        },
      ]);

      const result = await parseMonddyExcel(buffer);
      expect(result).toHaveLength(2);

      // Product 1
      expect(result[0].sku).toBe("CER-001");
      expect(result[0].name).toBe("Polar Pilsen 222ml");
      expect(result[0].variants).toHaveLength(1);
      expect(result[0].variants[0].name).toBe("SERVICIO NORMAL");

      // Product 2
      expect(result[1].sku).toBe("CER-002");
      expect(result[1].name).toBe("Polar Pilsen Retornable");
      expect(result[1].variants).toHaveLength(2);
      expect(result[1].variants[0].name).toBe("TOBO 12 BOTELLAS");
      expect(result[1].variants[0].unitQuantity).toBe(12); // TOBO → 12
      expect(result[1].variants[1].name).toBe("CAJA 36 BOTELLAS");
      expect(result[1].variants[1].unitQuantity).toBe(36); // CAJA → 36
    });

    it("assigns inheritCost=true and customCost=null for all variants", async () => {
      const buffer = await buildMockExcel([
        {
          sku: "LIC-003",
          category: "LICOR",
          cost: 20,
          price: 40,
          stock: 10,
          description: "Vodka X 750ml",
        },
        {
          category: "",
          cost: undefined,
          price: 45,
          stock: 0,
          description: "SERVICIO EVENTO",
        },
      ]);

      const result = await parseMonddyExcel(buffer);
      expect(result[0].variants[0].inheritCost).toBe(true);
      expect(result[0].variants[0].customCost).toBeNull();
    });

    it("sets salePrice of base product to the price of the first variant when variants exist", async () => {
      const buffer = await buildMockExcel([
        {
          sku: "LIC-004",
          category: "LICOR",
          cost: 10,
          price: 20, // Este es el precio de la fila base
          stock: 5,
          description: "Tequila X 750ml",
        },
        {
          category: "",
          cost: undefined,
          price: 25, // Primera variante: su precio debe pasar al producto base
          stock: 0,
          description: "BOTELLA SOLA",
        },
        {
          category: "",
          cost: undefined,
          price: 35,
          stock: 0,
          description: "SERVICIO NORMAL",
        },
      ]);

      const result = await parseMonddyExcel(buffer);
      // El salePrice del producto base debe tomar el precio de la primera variante (BOTELLA SOLA = 25)
      expect(result[0].salePrice).toBe(25);
    });

    it("skips rows without SKU when there is no base product yet", async () => {
      const buffer = await buildMockExcel([
        {
          // No SKU, no base product before → should be skipped
          category: "",
          cost: undefined,
          price: 10,
          stock: 0,
          description: "BOTELLA SOLA",
        },
        {
          sku: "PROD-001",
          category: "OTROS",
          cost: 5,
          price: 15,
          stock: 10,
          description: "Producto Real",
        },
      ]);

      const result = await parseMonddyExcel(buffer);
      expect(result).toHaveLength(1);
      expect(result[0].sku).toBe("PROD-001");
      expect(result[0].variants).toHaveLength(0);
    });

    it("handles errors gracefully: rows with invalid price are skipped but don't break parsing", async () => {
      const buffer = await buildMockExcel([
        {
          sku: "VALID-001",
          category: "TEST",
          cost: 10,
          price: 20,
          stock: 5,
          description: "Producto Válido",
        },
        {
          category: "",
          cost: undefined,
          price: undefined, // No price → variant inválida, se salta
          stock: 0,
          description: "SIN PRECIO",
        },
        {
          category: "",
          cost: undefined,
          price: 30,
          stock: 0,
          description: "BOTELLA SOLA",
        },
      ]);

      const result = await parseMonddyExcel(buffer);
      expect(result).toHaveLength(1);
      // La variante sin precio debe omitirse, pero la siguiente debe procesarse
      expect(result[0].variants).toHaveLength(1);
      expect(result[0].variants[0].name).toBe("BOTELLA SOLA");
    });

    it("skips rows where the base product has no valid salePrice", async () => {
      const buffer = await buildMockExcel([
        {
          sku: "BAD-PRICE",
          category: "TEST",
          cost: 10,
          price: undefined, // No price
          stock: 5,
          description: "Sin Precio",
        },
      ]);

      const result = await parseMonddyExcel(buffer);
      expect(result).toHaveLength(1);
      expect(result[0].sku).toBe("BAD-PRICE");
      // salePrice debería ser 0 porque el precio no es válido
      expect(result[0].salePrice).toBe(0);
    });
  });

  describe("inferUnitQuantity", () => {
    it("returns 12 for TOBO variants", () => {
      expect(inferUnitQuantity("TOBO 12 BOTELLAS")).toBe(12);
      expect(inferUnitQuantity("TOBO EVENTO")).toBe(12);
    });

    it("returns 36 for CAJA variants, 18 for 1/2 CAJA", () => {
      expect(inferUnitQuantity("CAJA 36 BOTELLAS")).toBe(36);
      expect(inferUnitQuantity("1/2 CAJA")).toBe(18);
    });

    it("returns 1 for BOTELLA and SERVICIO", () => {
      expect(inferUnitQuantity("BOTELLA SOLA")).toBe(1);
      expect(inferUnitQuantity("SERVICIO NORMAL")).toBe(1);
      expect(inferUnitQuantity("SERVICIO EVENTO")).toBe(1);
    });

    it("returns 1 for unknown variant names", () => {
      expect(inferUnitQuantity("LATA")).toBe(1);
      expect(inferUnitQuantity("UNITARIO")).toBe(1);
    });
  });

  describe("inferStockBehavior", () => {
    it("returns NO_DEDUCT for SERVICIO variants", () => {
      expect(inferStockBehavior("SERVICIO NORMAL")).toBe("NO_DEDUCT");
      expect(inferStockBehavior("SERVICIO EVENTO")).toBe("NO_DEDUCT");
    });

    it("returns DEDUCT for non-SERVICIO variants", () => {
      expect(inferStockBehavior("BOTELLA SOLA")).toBe("DEDUCT");
      expect(inferStockBehavior("TOBO 12 BOTELLAS")).toBe("DEDUCT");
      expect(inferStockBehavior("CAJA 36 BOTELLAS")).toBe("DEDUCT");
    });
  });
});
