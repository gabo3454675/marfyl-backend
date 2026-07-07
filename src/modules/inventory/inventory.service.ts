import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { getCompanyIdFromOrganization } from "@/common/helpers/organization.helper";
import * as ExcelJS from "exceljs";

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Plantilla oficial del importador de inventario (columnas exactas).
   * A: SKU, B: NOMBRE, C: COSTO, D: PRECIO VENTA, E: GANANCIA, F: STOCK, G: DESCRIPCION, H: EXENTO.
   * Mantener sincronizado con el parser de Excel.
   */
  static readonly INVENTORY_IMPORT_HEADERS = [
    "SKU",
    "NOMBRE DEL PRODUCTO",
    "COSTO",
    "PRECIO VENTA",
    "GANANCIA",
    "STOCK",
    "DESCRIPCION",
    "EXENTO",
  ] as const;

  private static readonly HEADER_NOTES: Record<
    (typeof InventoryService.INVENTORY_IMPORT_HEADERS)[number],
    string
  > = {
    SKU: "SKU: Obligatorio. Debe ser único por organización. Ej: ABC-001",
    "NOMBRE DEL PRODUCTO": "NOMBRE DEL PRODUCTO: Obligatorio. Nombre del producto.",
    COSTO: "COSTO: Obligatorio. Solo números (ej: 10.50).",
    "PRECIO VENTA": "PRECIO VENTA: Obligatorio. Solo números (ej: 10.50).",
    GANANCIA: "GANANCIA: Obligatorio. Solo números (ej: 10.50).",
    STOCK: "STOCK: Obligatorio. Entero >= 0.",
    DESCRIPCION: "DESCRIPCION: Opcional. Texto libre.",
    EXENTO: "EXENTO: SI/NO o EXENTO/GRAVADO (impuesto). Use el desplegable.",
  };

  getTemplateFormat() {
    return {
      headers: [...InventoryService.INVENTORY_IMPORT_HEADERS],
      exampleRow: {
        SKU: "ABC-001",
        "NOMBRE DEL PRODUCTO": "Café 250g",
        COSTO: 3.5,
        "PRECIO VENTA": 4.99,
        GANANCIA: 1.49,
        STOCK: 20,
        DESCRIPCION: "Café molido, presentación 250g",
        EXENTO: "NO",
      },
      notes: [
        "La primera fila debe contener exactamente estos headers (mismos textos).",
        "SKU es obligatorio y debe ser único por organización.",
        "COSTO debe ser numérico (ej: 10.5). PRECIO VENTA debe ser numérico (ej: 10.5). GANANCIA debe ser numérico (ej: 10.5). STOCK entero >= 0.",
        "EXENTO: use SI/NO o EXENTO/GRAVADO.",
      ],
    };
  }

  /**
   * Genera un archivo Excel (.xlsx) de plantilla descargable.
   * Columnas: A–H según INVENTORY_IMPORT_HEADERS.
   * Incluye:
   * - Headers exactos en negrita
   * - Validación lista en H (EXENTO): "SI", "NO" para 1000 filas (dropdown)
   * - Notas en headers, anchos de columna ajustados, freeze de encabezados
   */
  async generateTemplateXlsxBuffer() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "DISIS";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Inventario");

    const headers = [...InventoryService.INVENTORY_IMPORT_HEADERS];
    worksheet.addRow(headers);

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 22;

    // Notas en cada header
    headers.forEach((header, idx) => {
      const cell = worksheet.getRow(1).getCell(idx + 1);
      cell.note = InventoryService.HEADER_NOTES[header];
    });

    // Fila de ejemplo
    worksheet.addRow([
      "ABC-001",
      "Café 250g",
      3.5,
      4.99,
      1.49,
      20,
      "Café molido, presentación 250g",
      "NO",
    ]);

    // Validación de datos en columna H (EXENTO): lista "SI", "NO"
    const listValidation = {
      type: "list" as const,
      allowBlank: true,
      formulae: ['"SI,NO,EXENTO,GRAVADO"'],
      showErrorMessage: true,
      errorTitle: "Valor no permitido",
      error: "Seleccione SI, NO, EXENTO o GRAVADO.",
    };
    for (let i = 2; i <= 1001; i++) {
      const cell = worksheet.getCell("H" + i);
      (cell as { dataValidation?: typeof listValidation }).dataValidation =
        listValidation;
    }

    worksheet.getColumn(1).width = 16; // A: SKU
    worksheet.getColumn(2).width = 32; // B: NOMBRE
    worksheet.getColumn(3).width = 14; // C: COSTO
    worksheet.getColumn(4).width = 14; // D: PRECIO VENTA
    worksheet.getColumn(5).width = 14; // E: GANANCIA
    worksheet.getColumn(6).width = 12; // F: STOCK
    worksheet.getColumn(7).width = 42; // G: DESCRIPCION
    worksheet.getColumn(8).width = 12; // H: EXENTO

    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    worksheet.getColumn(3).numFmt = "#,##0.00"; // COSTO
    worksheet.getColumn(4).numFmt = "#,##0.00"; // PRECIO VENTA
    worksheet.getColumn(5).numFmt = "#,##0.00"; // GANANCIA
    worksheet.getColumn(6).numFmt = "0"; // STOCK

    return workbook.xlsx.writeBuffer();
  }

  async findAll(organizationId: number) {
    // Inventario = productos por organización
    return this.prisma.product.findMany({
      where: {
        organizationId, // OBLIGATORIO: aislamiento multi-tenant
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
  }

  /**
   * Retorna el stock actual de un producto.
   * El stock siempre vive en Product.stock (no se duplica por variante).
   */
  async getStock(productId: number, organizationId: number) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true, name: true, sku: true, stock: true },
    });

    if (!product) {
      throw new NotFoundException(
        `Producto con id ${productId} no encontrado en esta organización.`,
      );
    }

    return product;
  }

  private normalizeHeader(s: string) {
    return String(s ?? "")
      .trim()
      .toLowerCase();
  }

  private parseNumber(value: any): number {
    if (value === null || value === undefined || value === "") return NaN;
    if (typeof value === "number") return value;
    const s = String(value).trim().replace(",", ".");
    return parseFloat(s);
  }

  private parseIntSafe(value: any): number {
    if (value === null || value === undefined || value === "") return NaN;
    if (typeof value === "number") return Math.trunc(value);
    const s = String(value).trim();
    return parseInt(s, 10);
  }

  private findColumnIndex(headers: string[], candidates: string[]): number {
    const normalized = headers.map((h) => this.normalizeHeader(h));
    for (const candidate of candidates) {
      const norm = this.normalizeHeader(candidate);
      const idx = normalized.findIndex(
        (h) => h === norm || h.includes(norm) || norm.includes(h),
      );
      if (idx >= 0) return idx + 1;
    }
    return -1;
  }

  /**
   * Resuelve columnas por nombre de header.
   * Soporta plantilla MARFYL (STOCK) y export MonddY (NUMERO + columna % extra).
   */
  private resolveImportColumns(received: string[]) {
    const sku = this.findColumnIndex(received, ["sku"]);
    const name = this.findColumnIndex(received, [
      "nombre del producto",
      "nombre",
    ]);
    const cost = this.findColumnIndex(received, ["costo"]);
    const salePrice = this.findColumnIndex(received, [
      "precio venta",
      "precio",
    ]);
    const profit = this.findColumnIndex(received, ["ganancia", "margen"]);
    const stock = this.findColumnIndex(received, [
      "stock",
      "numero",
      "número",
      "cantidad",
    ]);
    const description = this.findColumnIndex(received, [
      "descripcion",
      "descripción",
    ]);
    const exento = this.findColumnIndex(received, ["exento", "gravado"]);

    if (sku < 0 || name < 0 || cost < 0 || salePrice < 0 || stock < 0) {
      return null;
    }

    return {
      sku,
      name,
      cost,
      salePrice,
      profit,
      stock,
      description,
      exento,
    };
  }

  private headersMatchStandardTemplate(received: string[]): boolean {
    const expected = [...InventoryService.INVENTORY_IMPORT_HEADERS];
    if (received.length < expected.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (
        this.normalizeHeader(received[i] || "") !==
        this.normalizeHeader(expected[i])
      ) {
        return false;
      }
    }
    return true;
  }

  private parseExemptFlag(raw: string | null): boolean {
    if (!raw) return false;
    const v = raw.trim().toUpperCase();
    return v === "SI" || v === "EXENTO" || v === "S";
  }

  private validateExemptValue(raw: string | null): string | null {
    if (!raw || !raw.trim()) return null;
    const v = raw.trim().toUpperCase();
    if (["SI", "NO", "EXENTO", "GRAVADO", "S", "N"].includes(v)) return v;
    return "__INVALID__";
  }

  private toMoney(value: number): number {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  private buildProductNames(categoryName: string, productDesc: string) {
    const name = productDesc || categoryName;
    const description =
      productDesc && categoryName && productDesc !== categoryName
        ? categoryName
        : productDesc
          ? null
          : categoryName || null;
    return { name, description };
  }

  /**
   * Importación con "dry run".
   *
   * - confirm=false: valida + previsualiza (NO escribe en BD)
   * - confirm=true: ejecuta escritura solo si NO hay errores
   */
  async importFromExcelWithDryRun(params: {
    file: Express.Multer.File;
    organizationId: number;
    confirm?: boolean;
  }) {
    const { file, organizationId } = params;
    const confirm = params.confirm === true;

    if (!file || !file.buffer) {
      throw new BadRequestException("Archivo no válido");
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException("El archivo Excel no contiene hojas");
    }

    if (worksheet.rowCount < 2) {
      throw new BadRequestException(
        "El archivo Excel debe tener al menos una fila de datos (excluyendo encabezados)",
      );
    }

    // Leer todos los headers de la fila 1
    const headerRow = worksheet.getRow(1);
    const received: string[] = [];
    const maxCol = Math.max(headerRow.cellCount || 0, 20);
    for (let c = 1; c <= maxCol; c++) {
      received.push(String(headerRow.getCell(c).value ?? "").trim());
    }
    while (received.length > 0 && received[received.length - 1] === "") {
      received.pop();
    }

    const cols = this.resolveImportColumns(received);
    if (!cols) {
      const hint = this.headersMatchStandardTemplate(received)
        ? "Revise que todas las columnas obligatorias tengan datos."
        : `Headers detectados: ${received.filter(Boolean).join(" | ")}. ` +
          "Se requieren columnas reconocibles: SKU, NOMBRE, COSTO, PRECIO VENTA, STOCK o NUMERO.";
      throw new BadRequestException(`Formato inválido. ${hint}`);
    }

    type PreviewRow = {
      rowNumber: number;
      sku: string;
      name: string;
      costPrice: number;
      salePrice: number;
      profit: number;
      stock: number;
      description: string | null;
      isExempt: boolean;
      action: "create" | "update" | "skip";
    };

    const errors: Array<{ row: number; field?: string; message: string }> = [];
    const previewRowsRaw: Array<Omit<PreviewRow, "action">> = [];

    const COL_SKU = cols.sku;
    const COL_NAME = cols.name;
    const COL_COST = cols.cost;
    const COL_SALE_PRICE = cols.salePrice;
    const COL_PROFIT = cols.profit;
    const COL_STOCK = cols.stock;
    const COL_DESC = cols.description;
    const COL_EXENTO = cols.exento;

    for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
      const row = worksheet.getRow(rowNum);

      const sku = String(row.getCell(COL_SKU)?.value ?? "").trim();
      const categoryName = String(row.getCell(COL_NAME)?.value ?? "").trim();
      const productDesc =
        COL_DESC > 0
          ? String(row.getCell(COL_DESC)?.value ?? "").trim()
          : "";
      const { name, description } = this.buildProductNames(
        categoryName,
        productDesc,
      );
      const cost = this.parseNumber(row.getCell(COL_COST)?.value);
      const salePrice = this.parseNumber(row.getCell(COL_SALE_PRICE)?.value);
      const profitRaw =
        COL_PROFIT > 0
          ? this.parseNumber(row.getCell(COL_PROFIT)?.value)
          : NaN;
      const profit = Number.isNaN(profitRaw)
        ? !Number.isNaN(salePrice) && !Number.isNaN(cost)
          ? Math.round((salePrice - cost) * 100) / 100
          : NaN
        : profitRaw;
      const stock = this.parseIntSafe(row.getCell(COL_STOCK)?.value);
      const stockVal = Number.isNaN(stock) ? 0 : stock;
      const exento =
        COL_EXENTO > 0
          ? String(row.getCell(COL_EXENTO)?.value ?? "")
              .trim()
              .toUpperCase() || null
          : null;

      // Ignorar filas completamente vacías
      if (
        !sku &&
        !name &&
        (Number.isNaN(cost) || cost === 0) &&
        (Number.isNaN(salePrice) || salePrice === 0) &&
        (Number.isNaN(profit) || profit === 0) &&
        stockVal === 0 &&
        !description
      ) {
        continue;
      }

      if (!sku) {
        errors.push({ row: rowNum, field: "SKU", message: "SKU es requerido" });
        continue;
      }
      const skuKey = sku.toUpperCase();
      const existingIndex = previewRowsRaw.findIndex(
        (r) => r.sku.toUpperCase() === skuKey,
      );
      if (existingIndex >= 0) {
        // Overwrite with last occurrence — no merge
        previewRowsRaw[existingIndex] = {
          rowNumber: rowNum,
          sku,
          name,
          costPrice: cost,
          salePrice,
          profit,
          stock: stockVal,
          description,
          isExempt: this.parseExemptFlag(exento),
        };
        continue;
      }

      if (!name) {
        errors.push({
          row: rowNum,
          field: "NOMBRE DEL PRODUCTO",
          message: "NOMBRE es requerido",
        });
        continue;
      }
      if (Number.isNaN(cost) || cost < 0) {
        errors.push({
          row: rowNum,
          field: "COSTO",
          message: "COSTO debe ser numérico y >= 0",
        });
        continue;
      }
      if (Number.isNaN(salePrice) || salePrice < 0) {
        errors.push({
          row: rowNum,
          field: "PRECIO VENTA",
          message: "PRECIO VENTA debe ser numérico y >= 0",
        });
        continue;
      }
      if (Number.isNaN(profit) || profit < 0) {
        errors.push({
          row: rowNum,
          field: "GANANCIA",
          message: "GANANCIA debe ser numérico y >= 0",
        });
        continue;
      }
      if (stockVal < 0) {
        errors.push({
          row: rowNum,
          field: "STOCK",
          message: "STOCK debe ser entero y >= 0",
        });
        continue;
      }
      if (exento) {
        const exemptCheck = this.validateExemptValue(exento);
        if (exemptCheck === "__INVALID__") {
          errors.push({
            row: rowNum,
            field: "EXENTO",
            message: "EXENTO debe ser SI, NO, EXENTO o GRAVADO",
          });
          continue;
        }
      }

      // EXENTO: SI/EXENTO -> isExempt true; NO/GRAVADO o vacío -> false
      const isExempt = this.parseExemptFlag(exento);

      previewRowsRaw.push({
        rowNumber: rowNum,
        sku,
        name,
        costPrice: cost,
        salePrice,
        profit,
        stock: stockVal,
        description,
        isExempt,
      });
    }

    // Para la UX: aunque haya errores, devolvemos preview de lo parseado válido.
    const skus = previewRowsRaw.map((r) => r.sku);
    const existing = skus.length
      ? await this.prisma.product.findMany({
          where: {
            organizationId,
            sku: { in: skus },
          },
          select: { sku: true, id: true },
        })
      : [];

    const existingSkuSet = new Set(
      existing.map((e) => (e.sku ? e.sku.toUpperCase() : "")).filter(Boolean),
    );

    const preview: PreviewRow[] = previewRowsRaw.map((r) => ({
      ...r,
      action: existingSkuSet.has(r.sku.toUpperCase()) ? "update" : "create",
    }));

    const summary = {
      toCreate: preview.filter((p) => p.action === "create").length,
      toUpdate: preview.filter((p) => p.action === "update").length,
    };

    // Modo previsualización: nunca escribir
    if (!confirm) {
      return {
        confirm: false,
        preview,
        errors,
        summary,
      };
    }

    // Modo ejecución: bloquear si hay errores
    if (errors.length) {
      throw new BadRequestException({
        message: "El archivo contiene errores. Corrige y vuelve a intentar.",
        errors,
        summary,
      });
    }

    // Ejecutar transacción
    const companyId = await getCompanyIdFromOrganization(
      this.prisma,
      organizationId,
    );

    const toCreate = preview.filter((p) => p.action === "create");
    const toUpdate = preview.filter((p) => p.action === "update");

    let createdCount = 0;
    if (toCreate.length) {
      const created = await this.prisma.product.createMany({
        data: toCreate.map((r) => ({
          companyId,
          organizationId,
          sku: r.sku,
          name: r.name,
          description: r.description,
          salePrice: this.toMoney(r.salePrice),
          costPrice: this.toMoney(r.costPrice),
          stock: r.stock,
          minStock: 5,
          isExempt: r.isExempt,
        })),
      });
      createdCount = created.count;
    }

    // Updates por SKU en lotes (sin transacción única: evita timeout en Neon con ~1000 filas)
    const UPDATE_BATCH = 40;
    for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
      const batch = toUpdate.slice(i, i + UPDATE_BATCH);
      await Promise.all(
        batch.map((r) =>
          this.prisma.product.updateMany({
            where: { organizationId, sku: r.sku },
            data: {
              name: r.name,
              description: r.description,
              salePrice: this.toMoney(r.salePrice),
              costPrice: this.toMoney(r.costPrice),
              stock: r.stock,
              isExempt: r.isExempt,
            },
          }),
        ),
      );
    }

    const result = { created: createdCount, updated: toUpdate.length };

    return {
      confirm: true,
      ...result,
      summary,
    };
  }

  /**
   * Import masivo desde Excel.
   *
   * Estrategia elegida para SKUs existentes:
   * - ACTUALIZAR (upsert por SKU): el Excel se toma como “fuente de verdad”.
   *   Se actualiza name/description/salePrice y el stock queda EXACTAMENTE como el del Excel.
   *
   * Motivo: en operaciones de carga masiva es más seguro evitar acumulaciones
   * involuntarias (increment) y mantener consistencia con el archivo.
   */
  async importFromExcel(file: Express.Multer.File, organizationId: number) {
    // Mantener compatibilidad: import directo ejecuta como confirm=true.
    return this.importFromExcelWithDryRun({
      file,
      organizationId,
      confirm: true,
    });
  }

  /**
   * Elimina todos los productos y movimientos de inventario de una organización (tenant).
   * Solo debe ser llamado por un Super Admin global (SuperAdminGuard).
   * Si algún producto está referenciado en facturas (InvoiceItem), la operación falla.
   */
  async clearByTenantId(tenantId: number): Promise<{
    deletedMovements: number;
    deletedProducts: number;
  }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!org) {
      throw new BadRequestException(
        `No existe la organización con tenantId ${tenantId}.`,
      );
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const deletedMovements = await tx.inventoryMovement.deleteMany({
          where: { tenantId },
        });
        const deletedProducts = await tx.product.deleteMany({
          where: { organizationId: tenantId },
        });
        return {
          deletedMovements: deletedMovements.count,
          deletedProducts: deletedProducts.count,
        };
      });
      return result;
    } catch (err: any) {
      if (err?.code === "P2003" || err?.message?.includes("Foreign key")) {
        throw new BadRequestException(
          "No se pueden eliminar productos que están referenciados en facturas. " +
            "Elimine o edite primero las facturas que los contienen.",
        );
      }
      throw err;
    }
  }
}
