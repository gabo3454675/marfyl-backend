import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { getCompanyIdFromOrganization } from '@/common/helpers/organization.helper';
import * as ExcelJS from 'exceljs';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Plantilla oficial del importador de inventario (columnas exactas).
   * A: SKU, B: NOMBRE, C: PRECIO, D: STOCK, E: DESCRIPCION, F: EXENTO.
   * Mantener sincronizado con el parser de Excel.
   */
  static readonly INVENTORY_IMPORT_HEADERS = [
    'SKU',
    'NOMBRE',
    'PRECIO',
    'STOCK',
    'DESCRIPCION',
    'EXENTO',
  ] as const;

  private static readonly HEADER_NOTES: Record<
    (typeof InventoryService.INVENTORY_IMPORT_HEADERS)[number],
    string
  > = {
    SKU: 'SKU: Obligatorio. Debe ser único por organización. Ej: ABC-001',
    NOMBRE: 'NOMBRE: Obligatorio. Nombre del producto.',
    PRECIO: 'PRECIO: Obligatorio. Solo números (ej: 10.50).',
    STOCK: 'STOCK: Obligatorio. Entero >= 0.',
    DESCRIPCION: 'DESCRIPCION: Opcional. Texto libre.',
    EXENTO: 'EXENTO: SI o NO (impuesto). Use el desplegable.',
  };

  getTemplateFormat() {
    return {
      headers: [...InventoryService.INVENTORY_IMPORT_HEADERS],
      exampleRow: {
        SKU: 'ABC-001',
        NOMBRE: 'Café 250g',
        PRECIO: 4.99,
        STOCK: 20,
        DESCRIPCION: 'Café molido, presentación 250g',
        EXENTO: 'NO',
      },
      notes: [
        'La primera fila debe contener exactamente estos headers (mismos textos).',
        'SKU es obligatorio y debe ser único por organización.',
        'PRECIO debe ser numérico (ej: 10.5). STOCK entero >= 0.',
        'EXENTO: use el desplegable (SI o NO).',
      ],
    };
  }

  /**
   * Genera un archivo Excel (.xlsx) de plantilla descargable.
   * Columnas: A: SKU, B: NOMBRE, C: PRECIO, D: STOCK, E: DESCRIPCION, F: EXENTO.
   * Incluye:
   * - Headers exactos en negrita
   * - Validación lista en F (EXENTO): "SI", "NO" para 1000 filas (dropdown)
   * - Notas en headers, anchos de columna ajustados, freeze de encabezados
   */
  async generateTemplateXlsxBuffer() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DISIS';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Inventario');

    // Columnas exactas: A: SKU, B: NOMBRE, C: PRECIO, D: STOCK, E: DESCRIPCION, F: EXENTO
    const headers = [...InventoryService.INVENTORY_IMPORT_HEADERS];
    worksheet.addRow(headers);

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 22;

    // Notas en cada header
    headers.forEach((header, idx) => {
      const cell = worksheet.getRow(1).getCell(idx + 1);
      cell.note = InventoryService.HEADER_NOTES[header];
    });

    // Fila de ejemplo
    worksheet.addRow([
      'ABC-001',
      'Café 250g',
      4.99,
      20,
      'Café molido, presentación 250g',
      'NO',
    ]);

    // Validación de datos en columna F (EXENTO): lista "SI", "NO" — por celda (evita worksheet.dataValidations sin tipos)
    const listValidation = {
      type: 'list' as const,
      allowBlank: true,
      formulae: ['"SI,NO"'],
      showErrorMessage: true,
      errorTitle: 'Valor no permitido',
      error: 'Seleccione SI o NO.',
    };
    for (let i = 2; i <= 1001; i++) {
      const cell = worksheet.getCell('F' + i);
      (cell as { dataValidation?: typeof listValidation }).dataValidation = listValidation;
    }

    // Anchos de columnas para lectura fácil
    worksheet.getColumn(1).width = 16;  // A: SKU
    worksheet.getColumn(2).width = 32;   // B: NOMBRE
    worksheet.getColumn(3).width = 14;   // C: PRECIO
    worksheet.getColumn(4).width = 12;   // D: STOCK
    worksheet.getColumn(5).width = 42;   // E: DESCRIPCION
    worksheet.getColumn(6).width = 12;   // F: EXENTO

    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    worksheet.getColumn(3).numFmt = '#,##0.00'; // PRECIO
    worksheet.getColumn(4).numFmt = '0';       // STOCK

    return workbook.xlsx.writeBuffer();
  }

  async findAll(organizationId: number) {
    // Inventario = productos por organización
    return this.prisma.product.findMany({
      where: {
        organizationId, // OBLIGATORIO: aislamiento multi-tenant
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  private normalizeHeader(s: string) {
    return String(s ?? '').trim().toLowerCase();
  }

  private parseNumber(value: any): number {
    if (value === null || value === undefined || value === '') return NaN;
    if (typeof value === 'number') return value;
    const s = String(value).trim().replace(',', '.');
    return parseFloat(s);
  }

  private parseIntSafe(value: any): number {
    if (value === null || value === undefined || value === '') return NaN;
    if (typeof value === 'number') return Math.trunc(value);
    const s = String(value).trim();
    return parseInt(s, 10);
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
      throw new BadRequestException('Archivo no válido');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException('El archivo Excel no contiene hojas');
    }

    if (worksheet.rowCount < 2) {
      throw new BadRequestException(
        'El archivo Excel debe tener al menos una fila de datos (excluyendo encabezados)',
      );
    }

    // Validar headers
    const expected = [...InventoryService.INVENTORY_IMPORT_HEADERS];
    const headerRow = worksheet.getRow(1);
    const received: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber <= expected.length) {
        received.push(String(cell.value ?? '').trim());
      }
    });

    for (let i = 0; i < expected.length; i++) {
      if (this.normalizeHeader(received[i] || '') !== this.normalizeHeader(expected[i])) {
        throw new BadRequestException(
          `Formato inválido. Header columna ${i + 1} debe ser "${expected[i]}". ` +
            `Recibido: "${received[i] || ''}".`,
        );
      }
    }

    type PreviewRow = {
      rowNumber: number;
      sku: string;
      name: string;
      price: number;
      stock: number;
      description: string | null;
      isExempt: boolean;
      action: 'create' | 'update' | 'skip';
    };

    const errors: Array<{ row: number; field?: string; message: string }> = [];
    const previewRowsRaw: Array<Omit<PreviewRow, 'action'>> = [];

    const seenSku = new Set<string>();

    // Columnas (1-based): A: SKU, B: NOMBRE, C: PRECIO, D: STOCK, E: DESCRIPCION, F: EXENTO
    const COL_SKU = 1;
    const COL_NAME = 2;
    const COL_PRICE = 3;
    const COL_STOCK = 4;
    const COL_DESC = 5;
    const COL_EXENTO = 6;

    for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
      const row = worksheet.getRow(rowNum);

      const sku = String(row.getCell(COL_SKU)?.value ?? '').trim();
      const name = String(row.getCell(COL_NAME)?.value ?? '').trim();
      const price = this.parseNumber(row.getCell(COL_PRICE)?.value);
      const stock = this.parseIntSafe(row.getCell(COL_STOCK)?.value);
      const description = String(row.getCell(COL_DESC)?.value ?? '').trim() || null;
      const exento = String(row.getCell(COL_EXENTO)?.value ?? '').trim().toUpperCase() || null;

      // Ignorar filas completamente vacías
      if (!sku && !name && (Number.isNaN(price) || price === 0) && (Number.isNaN(stock) || stock === 0) && !description) {
        continue;
      }

      if (!sku) {
        errors.push({ row: rowNum, field: 'SKU', message: 'SKU es requerido' });
        continue;
      }
      const skuKey = sku.toUpperCase();
      if (seenSku.has(skuKey)) {
        errors.push({
          row: rowNum,
          field: 'SKU',
          message: `SKU duplicado en el archivo: "${sku}"`,
        });
        continue;
      }
      seenSku.add(skuKey);

      if (!name) {
        errors.push({
          row: rowNum,
          field: 'NOMBRE',
          message: 'NOMBRE es requerido',
        });
        continue;
      }
      if (Number.isNaN(price) || price < 0) {
        errors.push({
          row: rowNum,
          field: 'PRECIO',
          message: 'PRECIO debe ser numérico y >= 0',
        });
        continue;
      }
      if (Number.isNaN(stock) || stock < 0) {
        errors.push({
          row: rowNum,
          field: 'STOCK',
          message: 'STOCK debe ser entero y >= 0',
        });
        continue;
      }
      if (exento && exento !== 'SI' && exento !== 'NO') {
        errors.push({
          row: rowNum,
          field: 'EXENTO',
          message: 'EXENTO debe ser SI o NO',
        });
        continue;
      }

      // EXENTO: "SI" -> isExempt true; "NO" o vacío -> false
      const isExempt = exento === 'SI';

      previewRowsRaw.push({
        rowNumber: rowNum,
        sku,
        name,
        price,
        stock,
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
      existing.map((e) => (e.sku ? e.sku.toUpperCase() : '')).filter(Boolean),
    );

    const preview: PreviewRow[] = previewRowsRaw.map((r) => ({
      ...r,
      action: existingSkuSet.has(r.sku.toUpperCase()) ? 'update' : 'create',
    }));

    const summary = {
      toCreate: preview.filter((p) => p.action === 'create').length,
      toUpdate: preview.filter((p) => p.action === 'update').length,
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
        message: 'El archivo contiene errores. Corrige y vuelve a intentar.',
        errors,
        summary,
      });
    }

    // Ejecutar transacción
    const companyId = await getCompanyIdFromOrganization(this.prisma, organizationId);

    const toCreate = preview.filter((p) => p.action === 'create');
    const toUpdate = preview.filter((p) => p.action === 'update');

    const result = await this.prisma.$transaction(async (tx) => {
      let createdCount = 0;
      if (toCreate.length) {
        const created = await tx.product.createMany({
          data: toCreate.map((r) => ({
            companyId,
            organizationId,
            sku: r.sku,
            name: r.name,
            description: r.description,
            salePrice: r.price as any,
            costPrice: 0 as any,
            stock: r.stock,
            minStock: 5,
            isExempt: r.isExempt,
          })),
        });
        createdCount = created.count;
      }

      // Updates por SKU (1 query por fila, dentro de la transacción)
      await Promise.all(
        toUpdate.map((r) =>
          tx.product.updateMany({
            where: { organizationId, sku: r.sku },
            data: {
              name: r.name,
              description: r.description,
              salePrice: r.price as any,
              stock: r.stock,
              isExempt: r.isExempt,
            },
          }),
        ),
      );

      return { created: createdCount, updated: toUpdate.length };
    });

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
    return this.importFromExcelWithDryRun({ file, organizationId, confirm: true });
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
      if (err?.code === 'P2003' || err?.message?.includes('Foreign key')) {
        throw new BadRequestException(
          'No se pueden eliminar productos que están referenciados en facturas. ' +
            'Elimine o edite primero las facturas que los contienen.',
        );
      }
      throw err;
    }
  }
}
