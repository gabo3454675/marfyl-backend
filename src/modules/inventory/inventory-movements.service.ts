import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ActivityLogService } from "@/modules/activity-log/activity-log.service";
import { PushNotificationService } from "@/modules/notifications/push-notification.service";
import { getCompanyIdFromOrganization } from "@/common/helpers/organization.helper";
import type { CreateMovementDto } from "./dto/create-movement.dto";
import { MovementType, ConsumptionReason } from "@prisma/client";

const AUTOCONSUMO_CATEGORY_NAME = "Autoconsumo y Mermas";

function defaultConsumptionReason(type: MovementType): ConsumptionReason {
  if (type === "MERMA_VENCIDO" || type === "MERMA_DANADO") return "MERMA";
  return "USO_OPERATIVO";
}

@Injectable()
export class InventoryMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly pushNotification: PushNotificationService,
  ) {}

  /**
   * Registra una salida de inventario (Autoconsumo/Merma/Uso taller).
   * - Valida stock real: bloquea si resultaría en stock negativo.
   * - Doble asiento: resta del inventario y crea gasto operativo/merma asociado.
   */
  async createOutflow(params: {
    organizationId: number;
    userId: number;
    dto: CreateMovementDto;
  }) {
    const { organizationId, userId, dto } = params;

    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        organizationId,
      },
      select: {
        id: true,
        name: true,
        stock: true,
        costPrice: true,
        minStock: true,
      },
    });

    if (!product) {
      throw new NotFoundException(
        `Producto con id ${dto.productId} no encontrado en esta organización.`,
      );
    }

    // ────────── Lógica de variante ──────────
    let effectiveQuantity = dto.quantity;
    let shouldDeductStock = true;

    if (dto.variantId) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: dto.variantId },
        select: { id: true, unitQuantity: true, stockBehavior: true },
      });

      if (!variant) {
        throw new NotFoundException(
          `Variante con id ${dto.variantId} no encontrada.`,
        );
      }

      effectiveQuantity = dto.quantity * variant.unitQuantity;

      if (variant.stockBehavior === "NO_DEDUCT") {
        shouldDeductStock = false;
      }
    }

    // Solo validar stock si se va a descontar
    if (shouldDeductStock && product.stock < effectiveQuantity) {
      throw new BadRequestException(
        `Stock insuficiente. Disponible: ${product.stock}, solicitado: ${effectiveQuantity}. No se permite stock negativo.`,
      );
    }

    const movementType = dto.type as MovementType;
    const unitCost =
      dto.unitCostAtTransaction ?? Number(product.costPrice ?? 0);
    const totalCost = dto.quantity * unitCost;
    const consumptionReason =
      dto.consumptionReason ?? defaultConsumptionReason(movementType);

    const companyId = await getCompanyIdFromOrganization(
      this.prisma,
      organizationId,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const movement = await tx.inventoryMovement.create({
        data: {
          type: movementType,
          quantity: -dto.quantity,
          reason: dto.reason ?? null,
          responsible: dto.responsible ?? null,
          unitCostAtTransaction: unitCost,
          consumptionReason,
          product: { connect: { id: dto.productId } },
          ...(dto.variantId && {
            variant: { connect: { id: dto.variantId } },
          }),
          user: { connect: { id: userId } },
          tenant: { connect: { id: organizationId } },
        },
      });

      // Solo descontar stock si no es NO_DEDUCT
      if (shouldDeductStock) {
        await tx.product.update({
          where: { id: dto.productId },
          data: { stock: { decrement: effectiveQuantity } },
        });
      }

      const category = await this.getOrCreateAutoconsumoCategory(
        tx,
        organizationId,
        companyId,
      );
      await tx.expense.create({
        data: {
          companyId,
          organizationId,
          date: new Date(),
          amount: totalCost,
          description: `Autoconsumo/Merma: ${product.name} x ${dto.quantity} (${dto.type})${dto.reason ? ` - ${dto.reason}` : ""}`,
          status: "PAID",
          categoryId: category.id,
          inventoryMovementId: movement.id,
        },
      });

      const updated = await tx.product.findUnique({
        where: { id: dto.productId },
        select: { stock: true },
      });
      return { movement, newStock: updated!.stock };
    });

    await this.activityLog.log({
      organizationId,
      userId,
      action: "AUTOCONSUMO_REGISTERED",
      entityType: "inventory_movement",
      entityId: String(result.movement.id),
      newValue: {
        productId: dto.productId,
        productName: product.name,
        quantity: dto.quantity,
        type: movementType,
        consumptionReason,
        totalCost,
      },
      summary: `Autoconsumo: ${product.name} x${dto.quantity} (${dto.type})${dto.reason ? ` - ${dto.reason}` : ""}. Costo: $${totalCost.toFixed(2)}.`,
    });

    const minStock = product.minStock ?? 5;
    if (result.newStock < minStock) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { nombre: true },
      });
      this.pushNotification
        .notifyStockBajo({
          organizationName: org?.nombre ?? "Organización",
          productName: product.name,
          productId: dto.productId,
          stockActual: result.newStock,
          minStock,
        })
        .catch(() => {});
    }

    return {
      movement: {
        id: result.movement.id,
        type: result.movement.type,
        quantity: result.movement.quantity,
        reason: result.movement.reason,
        productId: result.movement.productId,
        unitCostAtTransaction: result.movement.unitCostAtTransaction,
        consumptionReason: result.movement.consumptionReason,
        createdAt: result.movement.createdAt,
      },
      productName: product.name,
      newStock: result.newStock,
      totalCost,
    };
  }

  private async getOrCreateAutoconsumoCategory(
    tx: {
      expenseCategory: {
        findFirst: (args: any) => Promise<any>;
        create: (args: any) => Promise<any>;
      };
    },
    organizationId: number,
    companyId: number,
  ) {
    let category = await tx.expenseCategory.findFirst({
      where: {
        organizationId,
        name: AUTOCONSUMO_CATEGORY_NAME,
      },
    });
    if (!category) {
      category = await tx.expenseCategory.create({
        data: {
          companyId,
          organizationId,
          name: AUTOCONSUMO_CATEGORY_NAME,
          description:
            "Gastos por autoconsumo, mermas y uso operativo de inventario",
        },
      });
    }
    return category;
  }

  /**
   * Ajuste de stock (conteo / corrección).
   * Cambia Product.stock y registra InventoryMovement AJUSTE.
   * NO crea Invoice ni Expense → no distorsiona ventas ni compras (P&L).
   * `delta` positivo = entrada; negativo = salida. Stock resultante no puede ser < 0.
   */
  async createAdjustment(params: {
    organizationId: number;
    userId: number;
    productId: number;
    delta: number;
    reason: string;
  }) {
    const { organizationId, userId, productId, delta, reason } = params;
    if (!Number.isInteger(delta) || delta === 0) {
      throw new BadRequestException("delta debe ser un entero distinto de 0");
    }
    if (!reason?.trim()) {
      throw new BadRequestException("reason es obligatorio para ajustes");
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: {
        id: true,
        name: true,
        stock: true,
        costPrice: true,
        isBundle: true,
        isService: true,
      },
    });
    if (!product) {
      throw new NotFoundException(
        `Producto con id ${productId} no encontrado en esta organización.`,
      );
    }
    if (product.isBundle || product.isService) {
      throw new BadRequestException(
        "No se ajusta stock de combos ni servicios.",
      );
    }

    const nextStock = product.stock + delta;
    if (nextStock < 0) {
      throw new BadRequestException(
        `Ajuste dejaría stock negativo (actual ${product.stock}, delta ${delta}).`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const movement = await tx.inventoryMovement.create({
        data: {
          type: "AJUSTE",
          quantity: delta,
          reason: reason.trim(),
          unitCostAtTransaction: Number(product.costPrice ?? 0),
          product: { connect: { id: productId } },
          user: { connect: { id: userId } },
          tenant: { connect: { id: organizationId } },
        },
      });
      const updated = await tx.product.update({
        where: { id: productId },
        data: { stock: nextStock },
        select: { stock: true },
      });
      return { movement, newStock: updated.stock };
    });

    await this.activityLog.log({
      organizationId,
      userId,
      action: "INVENTORY_ADJUSTMENT",
      entityType: "inventory_movement",
      entityId: String(result.movement.id),
      newValue: {
        productId,
        productName: product.name,
        delta,
        from: product.stock,
        to: result.newStock,
        reason: reason.trim(),
      },
      summary: `Ajuste inventario: ${product.name} ${delta > 0 ? "+" : ""}${delta} (${product.stock} → ${result.newStock}). ${reason.trim()}`,
    });

    return {
      movement: {
        id: result.movement.id,
        type: result.movement.type,
        quantity: result.movement.quantity,
        reason: result.movement.reason,
        productId: result.movement.productId,
        createdAt: result.movement.createdAt,
      },
      productName: product.name,
      previousStock: product.stock,
      newStock: result.newStock,
    };
  }

  /**
   * Genera plantilla Excel para carga masiva de consumos/autoconsumo.
   * Columnas: CODIGO_PRODUCTO, CANTIDAD, MOTIVO, RESPONSABLE, FECHA, OBSERVACION
   */
  async generateConsumptionTemplateBuffer(): Promise<Buffer> {
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "MARFYL";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Consumo");

    const headers = [
      "CODIGO_PRODUCTO",
      "CANTIDAD",
      "MOTIVO",
      "RESPONSABLE",
      "FECHA",
      "OBSERVACION",
    ];
    worksheet.addRow(headers);

    // Formato de encabezados
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 22;

    // Notas en headers
    const headerNotes: Record<string, string> = {
      CODIGO_PRODUCTO:
        "SKU o código de barras del producto. Debe existir en inventario.",
      CANTIDAD: "Número entero positivo de unidades a descontar.",
      MOTIVO:
        "Tipo de movimiento: AUTOCONSUMO, MERMA_VENCIDO, MERMA_DANADO, USO_TALLER",
      RESPONSABLE:
        "Nombre de la persona a quien se le descuenta el consumo (opcional).",
      FECHA:
        "Fecha del consumo en formato AAAA-MM-DD (opcional, si se omite usa fecha actual).",
      OBSERVACION: "Detalle adicional del movimiento (opcional).",
    };
    headers.forEach((header, idx) => {
      const cell = worksheet.getRow(1).getCell(idx + 1);
      cell.note = headerNotes[header];
    });

    // Fila de ejemplo
    worksheet.addRow([
      "ABC-001",
      5,
      "AUTOCONSUMO",
      "Juan Pérez",
      "2025-01-15",
      "Uso interno oficina",
    ]);

    // Validación de datos en columna C (MOTIVO)
    const listValidation = {
      type: "list" as const,
      allowBlank: true,
      formulae: ['"AUTOCONSUMO,MERMA_VENCIDO,MERMA_DANADO,USO_TALLER"'],
      showErrorMessage: true,
      errorTitle: "Valor no permitido",
      error:
        "Seleccione AUTOCONSUMO, MERMA_VENCIDO, MERMA_DANADO o USO_TALLER.",
    };
    for (let i = 2; i <= 1001; i++) {
      const cell = worksheet.getCell("C" + i);
      (cell as any).dataValidation = listValidation;
    }

    // Anchos de columna
    worksheet.getColumn(1).width = 20; // CODIGO_PRODUCTO
    worksheet.getColumn(2).width = 12; // CANTIDAD
    worksheet.getColumn(3).width = 18; // MOTIVO
    worksheet.getColumn(4).width = 22; // RESPONSABLE
    worksheet.getColumn(5).width = 14; // FECHA
    worksheet.getColumn(6).width = 40; // OBSERVACION

    // Formato numérico
    worksheet.getColumn(2).numFmt = "0"; // CANTIDAD

    // Freeze de encabezados
    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }

  /**
   * Lista los movimientos de inventario de la organización (útil para historial).
   */
  async findByOrganization(
    organizationId: number,
    options?: { productId?: number; type?: MovementType; limit?: number },
  ) {
    const { productId, type, limit = 100 } = options ?? {};

    return this.prisma.inventoryMovement.findMany({
      where: {
        tenantId: organizationId,
        ...(productId != null && { productId }),
        ...(type != null && { type }),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 500),
      include: {
        product: { select: { id: true, name: true, sku: true } },
        user: { select: { id: true, email: true, fullName: true } },
      },
    });
  }

  /**
   * Importa consumos/autoconsumos masivamente desde Excel.
   * Soporta preview (dry-run) y confirm.
   */
  async importConsumptionsFromExcel(params: {
    file: Express.Multer.File;
    organizationId: number;
    userId: number;
    confirm?: boolean;
  }) {
    const { file, organizationId, userId, confirm = false } = params;

    if (!file?.buffer?.length) {
      throw new BadRequestException("Archivo no válido");
    }

    const ext = (file.originalname || "").toLowerCase().split(".").pop() || "";
    if (ext !== "xlsx" && ext !== "xls") {
      throw new BadRequestException("Use un archivo Excel (.xlsx, .xls).");
    }

    // Parse Excel
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as any);
    const worksheet = workbook.worksheets[0];

    if (!worksheet || worksheet.rowCount < 2) {
      throw new BadRequestException(
        "El Excel debe tener encabezados y al menos una fila de datos.",
      );
    }

    // Detectar columnas
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    const lastCol = Math.min(headerRow.cellCount || 20, 30);
    for (let c = 1; c <= lastCol; c++) {
      headers[c - 1] = String(headerRow.getCell(c).value ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    }

    const findCol = (candidates: string[]): number => {
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i] || "";
        if (!h) continue;
        for (const c of candidates) {
          if (h === c || h.includes(c)) return i;
        }
      }
      return -1;
    };

    const colCode = findCol(["codigo_producto", "codigo", "sku", "codigo de barras", "barcode"]);
    const colQty = findCol(["cantidad", "qty", "quantity"]);
    const colMotivo = findCol(["motivo", "tipo", "type"]);
    const colResponsible = findCol(["responsable", "responsible", "a nombre"]);
    const colDate = findCol(["fecha", "date"]);
    const colObs = findCol(["observacion", "observaciones", "nota", "notas", "reason"]);

    if (colCode < 0 || colQty < 0) {
      throw new BadRequestException(
        "No se encontraron columnas obligatorias. Incluya: CODIGO_PRODUCTO y CANTIDAD.",
      );
    }

    // Parse rows
    type RawRow = {
      rowNum: number;
      code: string;
      qty: number;
      motivo: string;
      responsible: string | null;
      date: string | null;
      observation: string | null;
    };
    const rawRows: RawRow[] = [];
    const parseErrors: { row: number; message: string }[] = [];

    for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
      const row = worksheet.getRow(rowNum);
      const code = String(row.getCell(colCode + 1)?.value ?? "").trim();
      const qtyNum = this.parseFlexibleNumber(row.getCell(colQty + 1)?.value);
      const motivo = colMotivo >= 0 ? String(row.getCell(colMotivo + 1)?.value ?? "").trim().toUpperCase() : "AUTOCONSUMO";
      const responsible = colResponsible >= 0 ? String(row.getCell(colResponsible + 1)?.value ?? "").trim() || null : null;
      const dateRaw = colDate >= 0 ? String(row.getCell(colDate + 1)?.value ?? "").trim() || null : null;
      const observation = colObs >= 0 ? String(row.getCell(colObs + 1)?.value ?? "").trim() || null : null;

      if (!code && (qtyNum == null || qtyNum === 0)) continue;

      if (!code) {
        parseErrors.push({ row: rowNum, message: "Falta código/SKU." });
        continue;
      }
      if (qtyNum == null || qtyNum < 1 || !Number.isFinite(qtyNum)) {
        parseErrors.push({ row: rowNum, message: `Cantidad inválida para "${code}"` });
        continue;
      }
      const qty = Math.floor(qtyNum);

      const validMotivos = ["AUTOCONSUMO", "MERMA_VENCIDO", "MERMA_DANADO", "USO_TALLER"];
      if (motivo && !validMotivos.includes(motivo)) {
        parseErrors.push({ row: rowNum, message: `Motivo inválido "${motivo}". Use: ${validMotivos.join(", ")}` });
        continue;
      }

      rawRows.push({
        rowNum,
        code,
        qty,
        motivo: motivo || "AUTOCONSUMO",
        responsible,
        date: dateRaw,
        observation,
      });
    }

    // Match products
    const products = await this.prisma.product.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, name: true, sku: true, barcode: true, stock: true, costPrice: true, isBundle: true, isService: true },
    });

    const bySku = new Map<string, (typeof products)[0]>();
    const byBarcode = new Map<string, (typeof products)[0]>();
    for (const p of products) {
      if (p.sku) bySku.set(p.sku.trim().toUpperCase(), p);
      if (p.barcode) byBarcode.set(p.barcode.trim().toUpperCase(), p);
    }

    type PreviewLine = {
      lineIndex: number;
      rowNum: number;
      originalCode: string;
      quantity: number;
      motivo: string;
      responsible: string | null;
      date: string | null;
      observation: string | null;
      productId: number | null;
      productName: string | null;
      currentStock: number | null;
      unitCost: number;
      status: "matched" | "unmatched" | "error";
      error?: string;
    };

    const resultLines: PreviewLine[] = [];
    const unmatched: { row: number; code: string; reason: string }[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const skuKey = r.code.trim().toUpperCase();
      let product = bySku.get(skuKey) ?? byBarcode.get(skuKey) ?? null;

      if (!product) {
        unmatched.push({ row: r.rowNum, code: r.code, reason: "No hay producto con ese SKU o código de barras" });
        resultLines.push({
          lineIndex: i,
          rowNum: r.rowNum,
          originalCode: r.code,
          quantity: r.qty,
          motivo: r.motivo,
          responsible: r.responsible,
          date: r.date,
          observation: r.observation,
          productId: null,
          productName: null,
          currentStock: null,
          unitCost: 0,
          status: "unmatched",
          error: "Producto no encontrado",
        });
        continue;
      }

      if (product.isBundle) {
        resultLines.push({
          lineIndex: i,
          rowNum: r.rowNum,
          originalCode: r.code,
          quantity: r.qty,
          motivo: r.motivo,
          responsible: r.responsible,
          date: r.date,
          observation: r.observation,
          productId: product.id,
          productName: product.name,
          currentStock: product.stock,
          unitCost: Number(product.costPrice ?? 0),
          status: "error",
          error: "Es un combo; use productos sueltos",
        });
        continue;
      }

      if (product.stock < r.qty) {
        resultLines.push({
          lineIndex: i,
          rowNum: r.rowNum,
          originalCode: r.code,
          quantity: r.qty,
          motivo: r.motivo,
          responsible: r.responsible,
          date: r.date,
          observation: r.observation,
          productId: product.id,
          productName: product.name,
          currentStock: product.stock,
          unitCost: Number(product.costPrice ?? 0),
          status: "error",
          error: `Stock insuficiente: ${product.stock} disponible, ${r.qty} solicitado`,
        });
        continue;
      }

      resultLines.push({
        lineIndex: i,
        rowNum: r.rowNum,
        originalCode: r.code,
        quantity: r.qty,
        motivo: r.motivo,
        responsible: r.responsible,
        date: r.date,
        observation: r.observation,
        productId: product.id,
        productName: product.name,
        currentStock: product.stock,
        unitCost: Number(product.costPrice ?? 0),
        status: "matched",
      });
    }

    const matchedLines = resultLines.filter((l) => l.status === "matched").length;
    const errorLines = resultLines.filter((l) => l.status === "error" || l.status === "unmatched").length;
    const totalCost = resultLines
      .filter((l) => l.status === "matched")
      .reduce((sum, l) => sum + l.quantity * l.unitCost, 0);

    const preview = {
      dryRun: true as const,
      fileName: file.originalname || "",
      totalLines: resultLines.length,
      matchedLines,
      errorLines,
      totalCost: Math.round(totalCost * 100) / 100,
      lines: resultLines,
      errors: parseErrors,
      unmatched,
      canConfirm: matchedLines > 0 && parseErrors.length === 0,
    };

    if (!confirm) {
      return preview;
    }

    // Confirm: execute movements
    if (!preview.canConfirm) {
      throw new BadRequestException("No se puede confirmar: hay errores en el archivo.");
    }

    const companyId = await getCompanyIdFromOrganization(this.prisma, organizationId);
    const category = await this.getOrCreateAutoconsumoCategory(
      this.prisma as any,
      organizationId,
      companyId,
    );

    let movementsCreated = 0;
    const results: { productId: number; productName: string; quantity: number; newStock: number }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const line of resultLines) {
        if (line.status !== "matched" || !line.productId) continue;

        const movementType = line.motivo as any;
        const consumptionReason = line.motivo === "MERMA_VENCIDO" || line.motivo === "MERMA_DANADO" ? "MERMA" : "USO_OPERATIVO";
        const movementDate = line.date ? new Date(line.date + "T12:00:00.000Z") : new Date();

        await tx.inventoryMovement.create({
          data: {
            type: movementType,
            quantity: -line.quantity,
            reason: line.observation ?? null,
            responsible: line.responsible ?? null,
            unitCostAtTransaction: line.unitCost,
            consumptionReason,
            createdAt: movementDate,
            product: { connect: { id: line.productId } },
            user: { connect: { id: userId } },
            tenant: { connect: { id: organizationId } },
          },
        });

        await tx.product.update({
          where: { id: line.productId },
          data: { stock: { decrement: line.quantity } },
        });

        await tx.expense.create({
          data: {
            companyId,
            organizationId,
            date: movementDate,
            amount: line.quantity * line.unitCost,
            description: `Consumo importado: ${line.productName} x ${line.quantity} (${line.motivo})${line.responsible ? ` - ${line.responsible}` : ""}`,
            status: "PAID",
            categoryId: category.id,
          },
        });

        const updated = await tx.product.findUnique({
          where: { id: line.productId },
          select: { stock: true },
        });

        results.push({
          productId: line.productId,
          productName: line.productName!,
          quantity: line.quantity,
          newStock: updated!.stock,
        });
        movementsCreated++;
      }
    });

    return {
      dryRun: false as const,
      movementsCreated,
      totalCost: preview.totalCost,
      lines: results,
    };
  }

  private parseFlexibleNumber(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const raw = String(value).trim().replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * KPIs para el dashboard de Autoconsumo: impacto económico por día, productos más consumidos, distribución por motivo.
   */
  async getAutoconsumoKpis(
    organizationId: number,
    params?: { dateFrom?: string; dateTo?: string },
  ) {
    const dateFrom = params?.dateFrom ? new Date(params.dateFrom) : undefined;
    const dateTo = params?.dateTo ? new Date(params.dateTo) : undefined;

    const where: any = {
      tenantId: organizationId,
      quantity: { lt: 0 },
      type: {
        in: ["AUTOCONSUMO", "MERMA_VENCIDO", "MERMA_DANADO", "USO_TALLER"],
      },
    };
    if (dateFrom) where.createdAt = { ...where.createdAt, gte: dateFrom };
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      where.createdAt = { ...where.createdAt, lte: end };
    }

    const movements = await this.prisma.inventoryMovement.findMany({
      where,
      select: {
        id: true,
        quantity: true,
        unitCostAtTransaction: true,
        consumptionReason: true,
        createdAt: true,
        productId: true,
        product: { select: { name: true } },
      },
    });

    const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
    const totalCost = (m: {
      quantity: number;
      unitCostAtTransaction: unknown;
    }) => Math.abs(m.quantity) * Number(m.unitCostAtTransaction ?? 0);

    const economicImpactByDay: {
      date: string;
      totalCost: number;
      count: number;
    }[] = [];
    const dayMap = new Map<string, { totalCost: number; count: number }>();
    for (const m of movements) {
      const date = toDateStr(m.createdAt);
      const cost = totalCost(m);
      const prev = dayMap.get(date) ?? { totalCost: 0, count: 0 };
      prev.totalCost += cost;
      prev.count += 1;
      dayMap.set(date, prev);
    }
    dayMap.forEach((v, date) => economicImpactByDay.push({ date, ...v }));
    economicImpactByDay.sort((a, b) => a.date.localeCompare(b.date));

    const productMap = new Map<
      number,
      { productName: string; quantity: number; totalCost: number }
    >();
    for (const m of movements) {
      const prev = productMap.get(m.productId) ?? {
        productName: m.product.name,
        quantity: 0,
        totalCost: 0,
      };
      prev.quantity += Math.abs(m.quantity);
      prev.totalCost += totalCost(m);
      productMap.set(m.productId, prev);
    }
    const topProducts = Array.from(productMap.entries())
      .map(([productId, v]) => ({ productId, ...v }))
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 15);

    const reasonMap = new Map<
      string | null,
      { count: number; totalCost: number }
    >();
    for (const m of movements) {
      const reason = m.consumptionReason ?? "SIN_CLASIFICAR";
      const prev = reasonMap.get(reason) ?? { count: 0, totalCost: 0 };
      prev.count += 1;
      prev.totalCost += totalCost(m);
      reasonMap.set(reason, prev);
    }
    const reasonDistribution = Array.from(reasonMap.entries()).map(
      ([reason, v]) => ({
        reason,
        ...v,
      }),
    );

    return {
      economicImpactByDay,
      topProducts,
      reasonDistribution,
    };
  }
}
