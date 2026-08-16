import { Injectable, BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ActivityLogService } from "@/modules/activity-log/activity-log.service";
import { getCompanyIdFromOrganization } from "@/common/helpers/organization.helper";
import type { ConfirmInvoiceUploadDto } from "./dto/confirm-invoice.dto";
import { buildMovementReason } from "./invoice-upload.constants";
import { num } from "@/common/helpers/number.helper";
import { computeExpenseFiscal } from "@/modules/fiscal/helpers/expense-fiscal.helper";
import { round2 } from "@/modules/fiscal/helpers/tax-calculator";
import * as ExcelJS from "exceljs";
import pdfParse from "pdf-parse";
import { ReceiptScanService } from "@/modules/expenses/receipt-scan.service";

@Injectable()
export class InvoiceUploadService {
  private readonly logger = new Logger(InvoiceUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly receiptScan: ReceiptScanService,
  ) {}

  async preview(params: {
    file: Express.Multer.File;
    organizationId: number;
    supplierId?: number;
  }) {
    const { file, organizationId } = params;

    // ── 1. Validate file ──────────────────────────────────────────────
    if (!file?.buffer?.length) {
      throw new BadRequestException("Archivo no válido");
    }

    const ext = (file.originalname || "").toLowerCase().split(".").pop() || "";
    const mime = (file.mimetype || "").toLowerCase();
    const isExcel = ext === "xlsx" || ext === "xls";
    const isPdf = ext === "pdf" || mime === "application/pdf";
    const isImage =
      mime.startsWith("image/") ||
      ["jpg", "jpeg", "png", "webp"].includes(ext);

    if (!isExcel && !isPdf && !isImage) {
      throw new BadRequestException(
        "Usa una foto (JPEG/PNG), un PDF o un Excel (.xlsx).",
      );
    }

    if (isImage) {
      return this.previewFromOcr(file, organizationId);
    }

    // ── 2. Load active products ───────────────────────────────────────
    const products = await this.prisma.product.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        costPrice: true,
        salePrice: true,
        stock: true,
        isBundle: true,
        isService: true,
      },
    });

    // ── 3. Build lookup maps ──────────────────────────────────────────
    const bySku = new Map<string, (typeof products)[0]>();
    const byBarcode = new Map<string, (typeof products)[0]>();
    for (const p of products) {
      if (p.sku) bySku.set(this.normalizeSkuKey(p.sku), p);
      if (p.barcode) byBarcode.set(this.normalizeSkuKey(p.barcode), p);
    }

    // ── 4. Parse the file ─────────────────────────────────────────────
    type RawRow = {
      rowNum?: number;
      line?: number;
      code: string;
      qty: number;
      unitCost: number | null;
    };
    const rawRows: RawRow[] = [];
    const parseErrors: { row?: number; line?: number; message: string }[] = [];

    if (isExcel) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as any);
      const worksheet = workbook.worksheets[0];
      if (!worksheet || worksheet.rowCount < 2) {
        throw new BadRequestException(
          "El Excel debe tener encabezados y al menos una fila de datos.",
        );
      }

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

      const colCode = findCol([
        "sku_o_codigo_barras",
        "sku",
        "codigo",
        "codigo de barras",
        "barcode",
        "ref",
      ]);
      const colQty = findCol([
        "cantidad",
        "qty",
        "quantity",
        "uds",
        "unidades",
      ]);
      const colCost = findCol([
        "costo_unitario_usd",
        "costo",
        "costo unitario",
        "precio costo",
        "unit cost",
        "p. costo",
      ]);

      if (colCode < 0 || colQty < 0) {
        throw new BadRequestException(
          "No se encontraron columnas obligatorias. Incluya encabezados reconocibles: código/SKU y CANTIDAD.",
        );
      }

      for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
        const row = worksheet.getRow(rowNum);
        const code = String(row.getCell(colCode + 1)?.value ?? "").trim();
        const qtyNum = this.parseFlexibleNumber(
          row.getCell(colQty + 1)?.value,
        );
        const costCell =
          colCost >= 0 ? row.getCell(colCost + 1)?.value : null;
        const unitCost =
          costCell != null && String(costCell).trim() !== ""
            ? this.parseFlexibleNumber(costCell)
            : null;

        if (!code && (qtyNum == null || qtyNum === 0)) continue;

        if (!code) {
          parseErrors.push({
            row: rowNum,
            message: "Falta código/SKU en una fila con cantidad.",
          });
          continue;
        }
        if (qtyNum == null || qtyNum < 1 || !Number.isFinite(qtyNum)) {
          parseErrors.push({
            row: rowNum,
            message: `Cantidad inválida para "${code}"`,
          });
          continue;
        }
        const qty = Math.floor(qtyNum);
        if (Math.abs(qtyNum - qty) > 0.0001) {
          parseErrors.push({
            row: rowNum,
            message: `La cantidad debe ser entera para "${code}"`,
          });
          continue;
        }

        rawRows.push({
          rowNum,
          code,
          qty,
          unitCost: unitCost != null && unitCost >= 0 ? unitCost : null,
        });
      }
    } else {
      // PDF parsing
      const buf = Buffer.isBuffer(file.buffer)
        ? file.buffer
        : Buffer.from(file.buffer);
      const pdfData = await pdfParse(buf);
      const text = pdfData.text || "";

      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      let lineNo = 0;
      for (const line of lines) {
        lineNo++;
        const tabParts = line
          .split("\t")
          .map((p) => p.trim())
          .filter(Boolean);
        let parts: string[];
        if (tabParts.length >= 3) {
          parts = tabParts;
        } else {
          parts = line.split(/\s+/).filter(Boolean);
        }
        if (parts.length < 3) continue;

        const code = parts[0];
        if (!/^[\w.\-]+$/i.test(code) || code.length > 80) continue;

        const qtyNum = this.parseFlexibleNumber(parts[1]);
        const unitCost = this.parseFlexibleNumber(parts[2]);
        if (qtyNum == null || qtyNum < 1) continue;
        const qty = Math.floor(qtyNum);
        if (Math.abs(qtyNum - qty) > 0.0001) continue;
        if (unitCost == null || unitCost < 0) continue;

        rawRows.push({ line: lineNo, code, qty, unitCost });
      }

      if (rawRows.length === 0 && parseErrors.length === 0) {
        this.logger.log("PDF sin líneas de texto; intentando OCR de páginas");
        return this.previewFromOcr(file, organizationId);
      }
    }

    // ── 5. Match products (cascading: SKU → barcode → fuzzy name) ─────
    type PreviewLine = {
      lineIndex: number;
      originalCode: string;
      originalName: string;
      quantity: number;
      unitCost: number;
      productId: number | null;
      productName: string | null;
      productSku: string | null;
      salePrice: number | null;
      currentStock: number | null;
      currentCostPrice: number | null;
      matchType: "sku" | "barcode" | "name_exact" | "name_fuzzy" | null;
      matchConfidence: number;
      status: "matched" | "unmatched" | "error";
      error?: string;
      lineTotal: number;
    };

    const resultLines: PreviewLine[] = [];
    const unmatched: {
      row?: number;
      line?: number;
      code: string;
      reason: string;
    }[] = [];
    let totalAmount = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];

      // Validate required fields — mark as error if missing
      if (!r.code || r.qty < 1) {
        resultLines.push({
          lineIndex: i,
          originalCode: r.code || "",
          originalName: "",
          quantity: r.qty || 0,
          unitCost: r.unitCost ?? 0,
          productId: null,
          productName: null,
          productSku: null,
          salePrice: null,
          currentStock: null,
          currentCostPrice: null,
          matchType: null,
          matchConfidence: 0,
          status: "error",
          error: "Código o cantidad faltante",
          lineTotal: 0,
        });
        continue;
      }

      // ── 5a. Exact SKU match ──
      const skuKey = this.normalizeSkuKey(r.code);
      let product = bySku.get(skuKey) ?? null;
      let matchType: PreviewLine["matchType"] = product ? "sku" : null;
      let matchConfidence = product ? 100 : 0;

      // ── 5b. Exact barcode match ──
      if (!product) {
        product = byBarcode.get(skuKey) ?? null;
        if (product) {
          matchType = "barcode";
          matchConfidence = 100;
        }
      }

      // ── 5c. Fuzzy name match ──
      if (!product && r.code) {
        const codeNorm = this.normalizeFuzzy(r.code);
        if (codeNorm.length >= 8) {
          let bestScore = 0;
          for (const p of products) {
            if (p.isBundle || p.isService) continue;
            const nameNorm = this.normalizeFuzzy(p.name);
            let score = 0;
            if (nameNorm === codeNorm) {
              score = 100;
            } else if (nameNorm.includes(codeNorm) || codeNorm.includes(nameNorm)) {
              score = Math.min(nameNorm.length, codeNorm.length);
            }
            if (score > bestScore) {
              bestScore = score;
              product = p;
            }
          }
          if (product && bestScore >= 8) {
            matchType = bestScore === 100 ? "name_exact" : "name_fuzzy";
            matchConfidence = bestScore === 100 ? 95 : Math.min(90, Math.max(70, Math.round((bestScore / Math.max(codeNorm.length, this.normalizeFuzzy(product.name).length)) * 100)));
          } else {
            product = null;
          }
        }
      }

      // ── 5d. No match ──
      if (!product) {
        unmatched.push({
          row: r.rowNum,
          line: r.line,
          code: r.code,
          reason: "No hay producto con ese SKU, código de barras o nombre",
        });
        resultLines.push({
          lineIndex: i,
          originalCode: r.code,
          originalName: "",
          quantity: r.qty,
          unitCost: r.unitCost ?? 0,
          productId: null,
          productName: null,
          productSku: null,
          salePrice: null,
          currentStock: null,
          currentCostPrice: null,
          matchType: null,
          matchConfidence: 0,
          status: "unmatched",
          lineTotal: r.qty * (r.unitCost ?? 0),
        });
        continue;
      }

      // ── 5e. Check bundle / service ──
      if (product.isBundle) {
        unmatched.push({
          row: r.rowNum,
          line: r.line,
          code: r.code,
          reason: "Es un combo; cargue los productos sueltos",
        });
        resultLines.push({
          lineIndex: i,
          originalCode: r.code,
          originalName: product.name,
          quantity: r.qty,
          unitCost: r.unitCost ?? 0,
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          salePrice: num(product.salePrice),
          currentStock: num(product.stock),
          currentCostPrice: num(product.costPrice),
          matchType,
          matchConfidence,
          status: "error",
          error: "Es un combo; cargue los productos sueltos",
          lineTotal: r.qty * (r.unitCost ?? 0),
        });
        continue;
      }
      if (product.isService) {
        unmatched.push({
          row: r.rowNum,
          line: r.line,
          code: r.code,
          reason: "Es un servicio (sin inventario)",
        });
        resultLines.push({
          lineIndex: i,
          originalCode: r.code,
          originalName: product.name,
          quantity: r.qty,
          unitCost: r.unitCost ?? 0,
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          salePrice: num(product.salePrice),
          currentStock: num(product.stock),
          currentCostPrice: num(product.costPrice),
          matchType,
          matchConfidence,
          status: "error",
          error: "Es un servicio (sin inventario)",
          lineTotal: r.qty * (r.unitCost ?? 0),
        });
        continue;
      }

      // ── 5f. Enrich matched line ──
      const unitCost = r.unitCost != null && r.unitCost >= 0
        ? r.unitCost
        : num(product.costPrice);
      const lineTotal = r.qty * unitCost;
      totalAmount += lineTotal;

      resultLines.push({
        lineIndex: i,
        originalCode: r.code,
        originalName: product.name,
        quantity: r.qty,
        unitCost,
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        salePrice: num(product.salePrice),
        currentStock: num(product.stock),
        currentCostPrice: num(product.costPrice),
        matchType,
        matchConfidence,
        status: "matched",
        lineTotal: Math.round(lineTotal * 100) / 100,
      });
    }

    totalAmount = Math.round(totalAmount * 100) / 100;

    const matchedLines = resultLines.filter((l) => l.status === "matched").length;
    const unmatchedLines = resultLines.filter(
      (l) => l.status === "unmatched" || l.status === "error",
    ).length;
    const hasBlockingErrors = parseErrors.length > 0;

    return {
      dryRun: true as const,
      fileName: file.originalname || "",
      fileType: isExcel ? ("excel" as const) : ("pdf" as const),
      totalLines: resultLines.length,
      matchedLines,
      unmatchedLines,
      totalAmount,
      lines: resultLines,
      errors: parseErrors,
      unmatched,
      canConfirm: matchedLines > 0 && !hasBlockingErrors,
    };
  }

  private async previewFromOcr(
    file: Express.Multer.File,
    organizationId: number,
  ) {
    const scan = await this.receiptScan.matchLinesToCatalog(
      organizationId,
      await this.receiptScan.scanReceiptFile(file),
    );

    const productIds = scan.lines
      .map((l) => l.matchedProductId)
      .filter((id): id is number => id != null);
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { organizationId, id: { in: productIds } },
          select: {
            id: true,
            name: true,
            sku: true,
            costPrice: true,
            salePrice: true,
            stock: true,
            isBundle: true,
            isService: true,
          },
        })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));

    const resultLines = scan.lines.map((line, i) => {
      const qty = Math.max(1, line.quantity || 1);
      const unitCost =
        line.unitCostUsd != null && line.unitCostUsd >= 0
          ? line.unitCostUsd
          : line.lineTotalUsd != null && qty > 0
            ? line.lineTotalUsd / qty
            : 0;
      const product = line.matchedProductId
        ? byId.get(line.matchedProductId)
        : undefined;
      const blocked =
        product && (product.isBundle || product.isService)
          ? product.isBundle
            ? "Es un combo; cargue los productos sueltos"
            : "Es un servicio (sin inventario)"
          : null;
      const matched = !!product && !blocked;
      const lineTotal = Math.round(qty * unitCost * 100) / 100;
      return {
        lineIndex: i,
        originalCode: line.name,
        originalName: line.name,
        quantity: qty,
        unitCost,
        productId: matched ? product.id : null,
        productName: matched ? product.name : null,
        productSku: matched ? product.sku : null,
        salePrice: matched ? num(product.salePrice) : null,
        currentStock: matched ? num(product.stock) : null,
        currentCostPrice: matched ? num(product.costPrice) : null,
        matchType: matched
          ? ("name_fuzzy" as const)
          : null,
        matchConfidence: matched ? 75 : 0,
        status: (blocked ? "error" : matched ? "matched" : "unmatched") as
          | "matched"
          | "unmatched"
          | "error",
        error: blocked || undefined,
        lineTotal,
      };
    });

    const matchedLines = resultLines.filter((l) => l.status === "matched").length;
    const unmatchedLines = resultLines.length - matchedLines;
    const totalAmount = Math.round(
      resultLines
        .filter((l) => l.status === "matched")
        .reduce((s, l) => s + l.lineTotal, 0) * 100,
    ) / 100;

    const suggestedSupplierId = await this.suggestSupplierId(
      organizationId,
      scan.vendorTaxId,
      scan.vendorName,
    );

    const warnings = [...(scan.warnings ?? [])];
    if (scan.vendorName) warnings.unshift(`Proveedor leído: ${scan.vendorName}`);

    return {
      dryRun: true as const,
      fileName: file.originalname || "",
      fileType: "photo" as const,
      totalLines: resultLines.length,
      matchedLines,
      unmatchedLines,
      totalAmount,
      lines: resultLines,
      errors: [],
      unmatched: resultLines
        .filter((l) => l.status !== "matched")
        .map((l) => ({
          line: l.lineIndex + 1,
          code: l.originalName,
          reason: l.error || "Revisa el nombre; no está en el catálogo",
        })),
      canConfirm: matchedLines > 0,
      vendorName: scan.vendorName,
      vendorTaxId: scan.vendorTaxId,
      documentNumber: scan.documentNumber,
      issueDate: scan.issueDate,
      suggestedSupplierId,
      warnings,
    };
  }

  private async suggestSupplierId(
    organizationId: number,
    taxId: string | null,
    name: string | null,
  ): Promise<number | null> {
    const rif = taxId?.replace(/[\s.-]/g, "").toUpperCase();
    if (rif && rif.length >= 5) {
      const byRif = await this.prisma.supplier.findFirst({
        where: {
          organizationId,
          taxId: { contains: rif.slice(-8), mode: "insensitive" },
        },
        select: { id: true },
      });
      if (byRif) return byRif.id;
    }
    const n = name?.trim();
    if (n && n.length >= 4) {
      const byName = await this.prisma.supplier.findFirst({
        where: {
          organizationId,
          name: { contains: n.slice(0, 24), mode: "insensitive" },
        },
        select: { id: true },
      });
      if (byName) return byName.id;
    }
    return null;
  }

  async confirm(params: {
    organizationId: number;
    userId: number;
    dto: ConfirmInvoiceUploadDto;
  }) {
    const { organizationId, userId, dto } = params;

    // ── 1. Validate input ────────────────────────────────────────────
    if (!dto.lines?.length) {
      throw new BadRequestException("No hay líneas para procesar");
    }

    // ── 2. Get companyId ─────────────────────────────────────────────
    const companyId = await getCompanyIdFromOrganization(
      this.prisma,
      organizationId,
    );

    // ── 3. Pre-validate all products before the transaction ──────────
    type ValidatedLine = {
      productId: number;
      productName: string;
      quantity: number;
      unitCost: number;
      isExempt: boolean;
    };
    const validatedLines: ValidatedLine[] = [];

    for (const line of dto.lines) {
      const product = await this.prisma.product.findFirst({
        where: { id: line.productId, organizationId },
      });
      if (!product) {
        throw new NotFoundException(
          `Producto ${line.productId} no encontrado en la organización`,
        );
      }
      if (product.isBundle) {
        throw new BadRequestException(
          `No se puede cargar inventario sobre el combo "${product.name}" (ID ${line.productId}). Use los productos sueltos.`,
        );
      }
      if (product.isService) {
        throw new BadRequestException(
          `No se puede cargar inventario sobre el servicio "${product.name}" (ID ${line.productId}).`,
        );
      }
      validatedLines.push({
        productId: product.id,
        productName: product.name,
        quantity: line.quantity,
        unitCost: line.unitCostUsd ?? num(product.costPrice),
        isExempt: product.isExempt,
      });
    }

    // ── 4. Resolve inventory category (only needed when creating expense) ──
    let inventoryCategoryId: number | null = null;
    if (dto.createExpense !== false) {
      const cat = await this.prisma.expenseCategory.findFirst({
        where: {
          organizationId,
          name: { contains: "inventario", mode: "insensitive" },
        },
      });
      if (!cat) {
        throw new BadRequestException(
          "No existe una categoría de gasto de inventario. Cree una categoría llamada «Inventario».",
        );
      }
      inventoryCategoryId = cat.id;
    }

    // ── 5. Calculate totalAmount ─────────────────────────────────────
    const totalAmount = Math.round(
      validatedLines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0) * 100,
    ) / 100;

    // ── 5b. Calculate fiscal breakdown (IVA incluido en el monto bruto) ──
    // Los montos de la factura YA incluyen IVA (16%). Nunca se suma IVA adicional:
    // se desglosa el bruto con base = round2(monto/1.16), iva = round2(monto - base).
    const fiscalTotals = validatedLines.reduce(
      (acc, l) => {
        const fiscal = computeExpenseFiscal({
          amount: l.quantity * l.unitCost,
          isExempt: l.isExempt,
        });
        acc.baseExempt += fiscal.baseExempt;
        acc.baseGeneral += fiscal.baseGeneral;
        acc.ivaAmount += fiscal.ivaAmount;
        return acc;
      },
      { baseExempt: 0, baseGeneral: 0, ivaAmount: 0 },
    );
    const baseExempt = round2(fiscalTotals.baseExempt);
    const baseGeneral = round2(fiscalTotals.baseGeneral);
    const ivaAmount = round2(fiscalTotals.ivaAmount);

    // ── 6. Execute in transaction ────────────────────────────────────
    const expenseDate = dto.date ?? new Date().toISOString().split("T")[0];

    const txnResult = await this.prisma.$transaction(async (tx) => {
      let expenseId: number | null = null;
      let movementsCreated = 0;
      let productsUpdated = 0;

      if (dto.createExpense !== false && inventoryCategoryId != null) {
        // ── 6a. Create Expense ──────────────────────────────────────
        const expense = await tx.expense.create({
          data: {
            companyId,
            organizationId,
            date: new Date(expenseDate),
            amount: totalAmount,
            baseExempt,
            baseGeneral,
            ivaAmount,
            description: dto.description || "Compra de inventario importada",
            categoryId: inventoryCategoryId,
            supplierId: dto.supplierId ?? undefined,
            referenceNumber: dto.referenceNumber ?? undefined,
            supplierInvoiceNumber: dto.referenceNumber ?? undefined,
            status: "PENDING",
          },
        });
        expenseId = expense.id;

        // ── 6b. Create InventoryMovements + update Products ────────
        for (const line of validatedLines) {
          await tx.inventoryMovement.create({
            data: {
              type: "COMPRA",
              quantity: line.quantity,
              reason: buildMovementReason(expenseId),
              unitCostAtTransaction: line.unitCost,
              product: { connect: { id: line.productId } },
              user: { connect: { id: userId } },
              tenant: { connect: { id: organizationId } },
            },
          });
          movementsCreated++;

          await tx.product.update({
            where: { id: line.productId },
            data: {
              stock: { increment: line.quantity },
              ...(line.unitCost != null ? { costPrice: line.unitCost } : {}),
            },
          });
          productsUpdated++;
        }

        // ── 6c. Handle initial payment if provided ────────────────
        if (dto.initialPayment != null && dto.initialPayment > 0) {
          if (dto.initialPayment > totalAmount + 0.01) {
            throw new BadRequestException(
              "El abono inicial no puede superar el monto del gasto.",
            );
          }
          await tx.expensePayment.create({
            data: {
              organizationId,
              expenseId,
              amount: dto.initialPayment,
              notes: "Abono al registrar la compra importada",
            },
          });
          await tx.expense.update({
            where: { id: expenseId },
            data: {
              status:
                dto.initialPayment >= totalAmount - 0.01 ? "PAID" : "PENDING",
            },
          });
        }
      } else {
        // ── 6d. No expense — directly create movements + update ───
        for (const line of validatedLines) {
          await tx.inventoryMovement.create({
            data: {
              type: "COMPRA",
              quantity: line.quantity,
              reason: "Entrada por compra importada",
              unitCostAtTransaction: line.unitCost,
              product: { connect: { id: line.productId } },
              user: { connect: { id: userId } },
              tenant: { connect: { id: organizationId } },
            },
          });
          movementsCreated++;

          await tx.product.update({
            where: { id: line.productId },
            data: {
              stock: { increment: line.quantity },
              ...(line.unitCost != null ? { costPrice: line.unitCost } : {}),
            },
          });
          productsUpdated++;
        }
      }

      // ── 6e. Fetch final stock for each product ──────────────────
      const linesWithStock = await Promise.all(
        validatedLines.map(async (line) => {
          const product = await tx.product.findFirst({
            where: { id: line.productId },
            select: { stock: true },
          });
          return {
            productId: line.productId,
            productName: line.productName,
            quantityAdded: line.quantity,
            newStock: num(product?.stock),
            unitCost: line.unitCost,
          };
        }),
      );

      return { expenseId, movementsCreated, productsUpdated, linesWithStock };
    });

    // ── 7. Register ActivityLog ──────────────────────────────────────
    await this.activityLog.log({
      organizationId,
      userId,
      action: "INVOICE_UPLOADED",
      entityType: "INVOICE_UPLOAD",
      entityId: String(txnResult.expenseId ?? 0),
      newValue: {
        expenseId: txnResult.expenseId,
        totalAmount,
        linesCount: validatedLines.length,
      },
      summary: `Compra importada: ${validatedLines.length} producto(s), total $${totalAmount}`,
    });

    // ── 8. Return result ─────────────────────────────────────────────
    return {
      dryRun: false as const,
      movementsCreated: txnResult.movementsCreated,
      productsUpdated: txnResult.productsUpdated,
      expenseId: txnResult.expenseId,
      totalAmount,
      lines: txnResult.linesWithStock,
    };
  }

  async searchProducts(organizationId: number, query: string, limit = 20) {
    if (!query || query.trim().length < 2) {
      return [];
    }

    const searchTerm = query.trim();
    const safeLimit = Math.min(Math.max(limit, 1), 50);

    const products = await this.prisma.product.findMany({
      where: {
        organizationId,
        isActive: true,
        OR: [
          { name: { contains: searchTerm, mode: "insensitive" } },
          { sku: { contains: searchTerm, mode: "insensitive" } },
          { barcode: { contains: searchTerm, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        costPrice: true,
        salePrice: true,
        stock: true,
        isBundle: true,
        isService: true,
      },
      take: safeLimit,
      orderBy: { name: "asc" },
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      costPrice: Number(p.costPrice),
      salePrice: Number(p.salePrice),
      stock: p.stock,
      isBundle: p.isBundle,
      isService: p.isService,
    }));
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private normalizeSkuKey(s: string): string {
    return s.trim().toUpperCase();
  }

  private parseFlexibleNumber(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const raw = String(value).trim().replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }

  private normalizeFuzzy(s: string): string {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}
