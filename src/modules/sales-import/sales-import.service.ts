import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { getCompanyIdFromOrganization } from "@/common/helpers/organization.helper";
import { InvoiceSequenceService } from "@/modules/invoices/invoice-sequence.service";
import {
  computeInvoiceTax,
  computeInvoiceTaxFromGross,
  type LineTaxInput,
} from "@/modules/fiscal/helpers/tax-calculator";
import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import {
  mergeInvoicesByLegacyKey,
  parseFastReportSalesFile,
  parseSaleDate,
  type ParsedSaleInvoice,
} from "./fastreport.parser";

export interface SalesImportPreviewResult {
  batchId: string;
  organizationId: number;
  summary: {
    files: number;
    invoices: number;
    lines: number;
    ready: number;
    warnings: number;
    errors: number;
    alreadyImported: number;
  };
  invoices: SalesImportInvoicePreview[];
}

export interface SalesImportInvoicePreview {
  legacyKey: string;
  saleDate: string;
  customer: string;
  lineCount: number;
  excelTotal: number;
  computedTotal: number;
  totalsMatch: boolean;
  status: "ready" | "warning" | "error" | "already_imported";
  issues: string[];
  lines: {
    productCode: string;
    description: string;
    quantity: number;
    lineTotal: number;
    productId?: number;
    productName?: string;
    matchBy?: "sku" | "barcode" | "name";
  }[];
}

type ProductRow = {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  salePrice: unknown;
  stock: number;
  isExempt: boolean;
  isBundle: boolean;
  isService: boolean;
};

@Injectable()
export class SalesImportService {
  private readonly logger = new Logger(SalesImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceSequence: InvoiceSequenceService,
  ) {}

  private normalizeCode(code: string): string {
    return code.trim().replace(/\s+/g, "").toUpperCase();
  }

  private stripLeadingZeros(code: string): string {
    const stripped = code.replace(/^0+/, "");
    return stripped || code;
  }

  private buildProductLookups(products: ProductRow[]) {
    const bySku = new Map<string, ProductRow>();
    const byBarcode = new Map<string, ProductRow>();
    const byName = new Map<string, ProductRow>();
    for (const p of products) {
      if (p.sku) {
        const skuKey = this.normalizeCode(p.sku);
        bySku.set(skuKey, p);
        bySku.set(this.stripLeadingZeros(skuKey), p);
      }
      if (p.barcode) {
        const bcKey = this.normalizeCode(p.barcode);
        byBarcode.set(bcKey, p);
        byBarcode.set(this.stripLeadingZeros(bcKey), p);
      }
      byName.set(p.name.trim().toUpperCase(), p);
    }
    return { bySku, byBarcode, byName };
  }

  private matchProduct(
    code: string,
    description: string,
    lookups: ReturnType<SalesImportService["buildProductLookups"]>,
  ): { product?: ProductRow; matchBy?: "sku" | "barcode" | "name" } {
    const key = this.normalizeCode(code);
    const stripped = this.stripLeadingZeros(key);

    if (lookups.bySku.has(key)) return { product: lookups.bySku.get(key), matchBy: "sku" };
    if (lookups.bySku.has(stripped)) {
      return { product: lookups.bySku.get(stripped), matchBy: "sku" };
    }
    if (lookups.byBarcode.has(key)) {
      return { product: lookups.byBarcode.get(key), matchBy: "barcode" };
    }
    if (lookups.byBarcode.has(stripped)) {
      return { product: lookups.byBarcode.get(stripped), matchBy: "barcode" };
    }

    const nameKey = description.trim().toUpperCase();
    if (nameKey && lookups.byName.has(nameKey)) {
      return { product: lookups.byName.get(nameKey), matchBy: "name" };
    }
    return {};
  }

  async previewFromPaths(params: {
    organizationId: number;
    filePaths: string[];
  }): Promise<SalesImportPreviewResult> {
    const parsed: ParsedSaleInvoice[] = [];
    for (const filePath of params.filePaths) {
      const xml = readFileSync(filePath, "utf8");
      parsed.push(...parseFastReportSalesFile(xml, filePath.split("/").pop() ?? filePath));
    }
    const invoices = mergeInvoicesByLegacyKey(parsed);
    return this.buildPreview(params.organizationId, invoices, params.filePaths.length);
  }

  async previewFromBuffers(params: {
    organizationId: number;
    files: { buffer: Buffer; originalname: string }[];
  }): Promise<SalesImportPreviewResult> {
    const parsed: ParsedSaleInvoice[] = [];
    for (const file of params.files) {
      const xml = file.buffer.toString("utf8");
      parsed.push(
        ...parseFastReportSalesFile(xml, file.originalname),
      );
    }
    const invoices = mergeInvoicesByLegacyKey(parsed);
    return this.buildPreview(params.organizationId, invoices, params.files.length);
  }

  async provisionMissingProductsFromBuffers(params: {
    organizationId: number;
    files: { buffer: Buffer; originalname: string }[];
  }) {
    const parsed: ParsedSaleInvoice[] = [];
    for (const file of params.files) {
      const xml = file.buffer.toString("utf8");
      parsed.push(...parseFastReportSalesFile(xml, file.originalname));
    }
    const invoices = mergeInvoicesByLegacyKey(parsed);
    return this.provisionMissingFromInvoices(params.organizationId, invoices);
  }

  async provisionMissingProductsFromPaths(params: {
    organizationId: number;
    filePaths: string[];
  }) {
    const parsed: ParsedSaleInvoice[] = [];
    for (const filePath of params.filePaths) {
      const xml = readFileSync(filePath, "utf8");
      parsed.push(...parseFastReportSalesFile(xml, filePath.split("/").pop() ?? filePath));
    }
    const invoices = mergeInvoicesByLegacyKey(parsed);
    return this.provisionMissingFromInvoices(params.organizationId, invoices);
  }

  private async provisionMissingFromInvoices(
    organizationId: number,
    invoices: ParsedSaleInvoice[],
  ) {
    const catalog = new Map<string, { name: string; unitPrice: number }>();
    for (const inv of invoices) {
      for (const line of inv.lines) {
        const sku = line.productCode.replace(/\s/g, "");
        const unitPrice =
          line.quantity > 0 ? line.lineTotal / line.quantity : line.lineTotal;
        const name = line.description.trim() || sku;
        const prev = catalog.get(sku);
        if (!prev || unitPrice > prev.unitPrice) {
          catalog.set(sku, { name, unitPrice });
        }
      }
    }

    const existing = await this.prisma.product.findMany({
      where: { organizationId, isActive: true },
      select: { sku: true },
    });
    const existingSkus = new Set(
      existing
        .map((p) => p.sku)
        .filter(Boolean)
        .flatMap((s) => [this.normalizeCode(s!), this.normalizeCode(s!).replace(/^0+/, "")]),
    );

    const companyId = await getCompanyIdFromOrganization(
      this.prisma,
      organizationId,
    );

    const toCreate: { sku: string; name: string; unitPrice: number }[] = [];
    const seen = new Set<string>();
    for (const [sku, info] of catalog) {
      const key = this.normalizeCode(sku);
      const stripped = key.replace(/^0+/, "");
      if (existingSkus.has(key) || existingSkus.has(stripped) || seen.has(key)) continue;
      seen.add(key);
      toCreate.push({ sku, name: info.name, unitPrice: info.unitPrice });
    }

    if (toCreate.length === 0) {
      return { created: 0, skipped: catalog.size, products: [] };
    }

    let created = 0;
    const createdSkus: string[] = [];
    for (const p of toCreate) {
      try {
        await this.prisma.product.create({
          data: {
            companyId,
            organizationId,
            sku: p.sku,
            name: p.name.slice(0, 200),
            description: p.name,
            salePrice: Number(p.unitPrice.toFixed(2)),
            costPrice: 0,
            stock: 0,
            minStock: 5,
            isExempt: false,
            isActive: true,
          },
        });
        created++;
        createdSkus.push(p.sku);
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code !== "P2002") throw err;
      }
    }

    return {
      created,
      skipped: catalog.size - created,
      products: createdSkus,
    };
  }

  private async buildPreview(
    organizationId: number,
    invoices: ParsedSaleInvoice[],
    fileCount = 0,
  ): Promise<SalesImportPreviewResult> {
    const products = await this.prisma.product.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        salePrice: true,
        stock: true,
        isExempt: true,
        isBundle: true,
        isService: true,
      },
    });
    const lookups = this.buildProductLookups(products);

    let imported = new Set<string>();
    try {
      const existing = await this.prisma.invoice.findMany({
        where: {
          organizationId,
          legacyImportKey: { in: invoices.map((i) => i.legacyKey) },
        },
        select: { legacyImportKey: true },
      });
      imported = new Set(
        existing.map((e) => e.legacyImportKey!).filter(Boolean),
      );
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "P2022") throw err;
      this.logger.warn(
        "Columna legacyImportKey no existe aún — ejecute la migración antes de confirmar",
      );
    }

    const previewInvoices: SalesImportInvoicePreview[] = [];
    let ready = 0;
    let warnings = 0;
    let errors = 0;
    let alreadyImported = 0;
    let lineCount = 0;

    for (const inv of invoices) {
      const issues: string[] = [];
      if (imported.has(inv.legacyKey)) {
        alreadyImported++;
        previewInvoices.push({
          legacyKey: inv.legacyKey,
          saleDate: inv.saleDate,
          customer: inv.customer,
          lineCount: inv.lines.length,
          excelTotal: 0,
          computedTotal: 0,
          totalsMatch: true,
          status: "already_imported",
          issues: ["Ya importada"],
          lines: [],
        });
        continue;
      }

      const linePreviews = inv.lines.map((line) => {
        const { product, matchBy } = this.matchProduct(
          line.productCode,
          line.description,
          lookups,
        );
        return {
          productCode: line.productCode,
          description: line.description,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
          productId: product?.id,
          productName: product?.name,
          matchBy,
        };
      });

      const excelSubtotal = Number(
        linePreviews.reduce((s, l) => s + l.lineTotal, 0).toFixed(2),
      );
      lineCount += linePreviews.length;

      const taxInputs: LineTaxInput[] = [];
      for (const lp of linePreviews) {
        if (!lp.productId) {
          issues.push(`Producto no encontrado: ${lp.productCode} (${lp.description})`);
          continue;
        }
        const product = products.find((p) => p.id === lp.productId)!;
        if (product.isBundle) issues.push(`Combo no soportado en import: ${product.name}`);
        const unitPrice =
          lp.quantity > 0 ? Number((lp.lineTotal / lp.quantity).toFixed(4)) : 0;
        taxInputs.push({
          amount: unitPrice * lp.quantity,
          isExempt: product.isExempt,
        });
      }

      const computedTax =
        taxInputs.length > 0 ? computeInvoiceTax(taxInputs) : null;
      const computedSubtotal = computedTax
        ? Number(computedTax.subtotal.toFixed(2))
        : 0;
      const computedTotal = computedTax
        ? Number(computedTax.totalWithTax.toFixed(2))
        : 0;
      const headerTotal = inv.headerTotalNet;
      const totalsMatch =
        taxInputs.length === linePreviews.length &&
        (headerTotal != null
          ? Math.abs(computedTotal - headerTotal) <= 0.05
          : Math.abs(excelSubtotal - computedSubtotal) <= 0.05);

      if (issues.some((i) => i.includes("no encontrado"))) {
        errors++;
        previewInvoices.push({
          legacyKey: inv.legacyKey,
          saleDate: inv.saleDate,
          customer: inv.customer,
          lineCount: linePreviews.length,
          excelTotal: excelSubtotal,
          computedTotal,
          totalsMatch,
          status: "error",
          issues,
          lines: linePreviews,
        });
        continue;
      }

      if (!totalsMatch || issues.length > 0) {
        warnings++;
        previewInvoices.push({
          legacyKey: inv.legacyKey,
          saleDate: inv.saleDate,
          customer: inv.customer,
          lineCount: linePreviews.length,
          excelTotal: excelSubtotal,
          computedTotal,
          totalsMatch,
          status: "warning",
          issues: totalsMatch
            ? issues
            : [
                ...issues,
                headerTotal != null
                  ? `Total encabezado ${headerTotal} vs calculado ${computedTotal}`
                  : `Subtotal Excel ${excelSubtotal} vs calculado ${computedSubtotal}`,
              ],
          lines: linePreviews,
        });
        continue;
      }

      ready++;
      previewInvoices.push({
        legacyKey: inv.legacyKey,
        saleDate: inv.saleDate,
        customer: inv.customer,
        lineCount: linePreviews.length,
        excelTotal: excelSubtotal,
        computedTotal,
        totalsMatch,
        status: "ready",
        issues,
        lines: linePreviews,
      });
    }

    const batchId = randomBytes(16).toString("hex");
    await this.savePreviewBatch(batchId, organizationId, invoices, previewInvoices);

    return {
      batchId,
      organizationId,
      summary: {
        files: fileCount,
        invoices: invoices.length,
        lines: lineCount,
        ready,
        warnings,
        errors,
        alreadyImported,
      },
      invoices: previewInvoices,
    };
  }

  private async savePreviewBatch(
    batchId: string,
    organizationId: number,
    invoices: ParsedSaleInvoice[],
    preview: SalesImportInvoicePreview[],
  ) {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.prisma.salesImportPreviewBatch.create({
      data: {
        id: batchId,
        organizationId,
        payload: { sources: invoices, preview } as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
    });
    await this.prisma.salesImportPreviewBatch.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }

  private async loadPreviewBatch(
    batchId: string,
    organizationId: number,
  ): Promise<{
    sources: ParsedSaleInvoice[];
    preview: SalesImportInvoicePreview[];
  }> {
    const row = await this.prisma.salesImportPreviewBatch.findFirst({
      where: {
        id: batchId,
        organizationId,
        expiresAt: { gt: new Date() },
      },
    });
    if (!row) {
      throw new BadRequestException(
        "Preview expirado o inválido. Ejecute preview de nuevo.",
      );
    }
    const payload = row.payload as unknown;
    if (Array.isArray(payload)) {
      const sources = payload as ParsedSaleInvoice[];
      const preview = await this.buildPreview(organizationId, sources);
      return { sources, preview: preview.invoices };
    }
    const stored = payload as {
      sources: ParsedSaleInvoice[];
      preview: SalesImportInvoicePreview[];
    };
    if (!stored?.sources?.length || !stored?.preview?.length) {
      throw new BadRequestException("Preview corrupto. Ejecute preview de nuevo.");
    }
    return stored;
  }

  async confirm(params: {
    organizationId: number;
    userId: number;
    batchId: string;
    allowWarnings?: boolean;
    skipStockValidation?: boolean;
    skipFiscalProjection?: boolean;
  }) {
    const { sources: cachedInvoices, preview: previewInvoices } =
      await this.loadPreviewBatch(params.batchId, params.organizationId);

    const toImport = previewInvoices.filter((inv) => {
      if (inv.status === "already_imported") return false;
      if (inv.status === "error") return false;
      if (inv.status === "warning" && !params.allowWarnings) return false;
      return inv.status === "ready" || inv.status === "warning";
    });

    if (toImport.length === 0) {
      throw new BadRequestException("No hay facturas listas para importar.");
    }

    const products = await this.prisma.product.findMany({
      where: { organizationId: params.organizationId, isActive: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    const companyId = await getCompanyIdFromOrganization(
      this.prisma,
      params.organizationId,
    );

    let walkInCustomer = await this.prisma.customer.findFirst({
      where: {
        organizationId: params.organizationId,
        name: { contains: "CLIENTE NATURAL CONTADO", mode: "insensitive" },
      },
    });
    if (!walkInCustomer) {
      walkInCustomer = await this.prisma.customer.create({
        data: {
          companyId,
          organizationId: params.organizationId,
          name: "CLIENTE NATURAL CONTADO",
          taxId: "V00000000",
        },
      });
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: params.organizationId },
      select: { exchangeRate: true },
    });
    const rate = Number(org?.exchangeRate ?? 1);

    const imported: { legacyKey: string; invoiceId: number }[] = [];
    const failed: { legacyKey: string; error: string }[] = [];

    for (const invPreview of toImport) {
      const source = cachedInvoices.find((i) => i.legacyKey === invPreview.legacyKey);
      if (!source) continue;

      try {
        const invoiceId = await this.importSingleInvoice({
          organizationId: params.organizationId,
          companyId,
          sellerId: params.userId,
          customerId: walkInCustomer.id,
          source,
          invPreview,
          productById,
          rate,
          skipStockValidation: params.skipStockValidation ?? false,
          useLegacyHeaderTotal: true,
        });
        imported.push({ legacyKey: invPreview.legacyKey, invoiceId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ legacyKey: invPreview.legacyKey, error: message });
        this.logger.error(`Import failed ${invPreview.legacyKey}: ${message}`);
      }
    }

    await this.prisma.salesImportPreviewBatch.delete({
      where: { id: params.batchId },
    }).catch(() => undefined);

    return {
      imported: imported.length,
      failed: failed.length,
      invoices: imported,
      errors: failed,
    };
  }

  private async importSingleInvoice(params: {
    organizationId: number;
    companyId: number;
    sellerId: number;
    customerId: number;
    source: ParsedSaleInvoice;
    invPreview: SalesImportInvoicePreview;
    productById: Map<number, ProductRow>;
    rate: number;
    skipStockValidation: boolean;
    useLegacyHeaderTotal?: boolean;
  }) {
    const issueDate = parseSaleDate(params.source.saleDate);
    const taxLineInputs: LineTaxInput[] = [];
    const invoiceItemsData: {
      productId: number;
      quantity: number;
      unitPrice: number;
      subtotal: number;
      taxRate: number;
      taxableBase: number;
      ivaLine: number;
    }[] = [];
    const stockDecrements: { productId: number; quantity: number }[] = [];

    for (const line of params.invPreview.lines) {
      if (!line.productId) throw new BadRequestException(`Línea sin producto: ${line.productCode}`);
      const product = params.productById.get(line.productId);
      if (!product) throw new NotFoundException(`Producto ${line.productId} no encontrado`);

      const unitPrice =
        line.quantity > 0
          ? Number((line.lineTotal / line.quantity).toFixed(4))
          : Number(product.salePrice);
      const subtotal = Number((unitPrice * line.quantity).toFixed(2));

      taxLineInputs.push({ amount: subtotal, isExempt: product.isExempt });
      invoiceItemsData.push({
        productId: product.id,
        quantity: line.quantity,
        unitPrice,
        subtotal,
        taxRate: product.isExempt ? 0 : 16,
        taxableBase: 0,
        ivaLine: 0,
      });

      if (!product.isBundle && !product.isService) {
        if (!params.skipStockValidation && product.stock < line.quantity) {
          throw new BadRequestException(
            `Stock insuficiente ${product.name}: ${product.stock} < ${line.quantity}`,
          );
        }
        stockDecrements.push({ productId: product.id, quantity: line.quantity });
      }
    }

    const taxTotals = computeInvoiceTax(taxLineInputs);
    for (let i = 0; i < invoiceItemsData.length; i++) {
      const lt = taxTotals.lines[i];
      invoiceItemsData[i].taxRate = lt.taxRate;
      invoiceItemsData[i].taxableBase = lt.taxableBase;
      invoiceItemsData[i].ivaLine = lt.ivaLine;
    }

    const excelSubtotal = Number(
      invoiceItemsData.reduce((s, i) => s + i.subtotal, 0).toFixed(2),
    );
    let totalAmount = taxTotals.totalWithTax;
    let baseExempt = taxTotals.baseExempt;
    let baseGeneral = taxTotals.baseGeneral;
    let baseReduced = taxTotals.baseReduced;
    let ivaAmount = taxTotals.ivaAmount;

    const header = params.source.headerTotalNet;
    const headerRounded =
      header != null ? Number(header.toFixed(2)) : null;
    const legacyGrossMode =
      params.useLegacyHeaderTotal &&
      (headerRounded != null
        ? Math.abs(headerRounded - excelSubtotal) <= 0.15
        : taxTotals.totalWithTax - excelSubtotal > 0.05);

    if (legacyGrossMode) {
      const grossTax = computeInvoiceTaxFromGross(taxLineInputs);
      for (let i = 0; i < invoiceItemsData.length; i++) {
        const lt = grossTax.lines[i];
        invoiceItemsData[i].taxRate = lt.taxRate;
        invoiceItemsData[i].taxableBase = lt.taxableBase;
        invoiceItemsData[i].ivaLine = lt.ivaLine;
      }
      totalAmount =
        headerRounded != null ? headerRounded : grossTax.totalWithTax;
      baseExempt = grossTax.baseExempt;
      baseGeneral = grossTax.baseGeneral;
      baseReduced = grossTax.baseReduced;
      ivaAmount = grossTax.ivaAmount;
    } else if (
      headerRounded != null &&
      Math.abs(headerRounded - taxTotals.totalWithTax) <= 0.05
    ) {
      totalAmount = headerRounded;
    }

    return this.prisma.$transaction(async (tx) => {
      const nextConsecutive = await this.invoiceSequence.allocateNext(
        params.organizationId,
        tx,
      );

      const tasa = await tx.tasaHistorica.create({
        data: {
          organizationId: params.organizationId,
          rate: params.rate,
          source: "BCV",
          effectiveAt: issueDate,
        },
      });

      for (const dec of stockDecrements) {
        await tx.product.update({
          where: { id: dec.productId },
          data: { stock: { decrement: dec.quantity } },
        });
      }

      const invoice = await tx.invoice.create({
        data: {
          companyId: params.companyId,
          organizationId: params.organizationId,
          customerId: params.customerId,
          sellerId: params.sellerId,
          totalAmount,
          status: "PAID",
          paymentMethod: "CASH",
          paymentStatus: "paid",
          montoUsd: totalAmount,
          montoBs: 0,
          tasaReferencia: params.rate,
          notes: `Importación POS legacy ${params.source.legacyKey}`,
          publicToken: randomBytes(32).toString("hex"),
          tasaHistoricaId: tasa.id,
          consecutiveNumber: nextConsecutive,
          controlNumber: params.source.documentNumber,
          fiscalInvoiceNumber: params.source.documentNumber,
          issueDate,
          createdAt: issueDate,
          updatedAt: issueDate,
          baseExempt,
          baseReduced,
          baseGeneral,
          ivaAmount,
          legacyImportKey: params.source.legacyKey,
          importSource: "fastreport",
          isLegacyImport: true,
          items: { create: invoiceItemsData },
          paymentLines: {
            create: [
              {
                method: "CASH_USD",
                amount: totalAmount,
                currency: "USD",
              },
            ],
          },
          pagos: {
            create: [
              {
                moneda: "USD",
                metodo: "EFECTIVO",
                monto: totalAmount,
                tasaCambio: params.rate,
                tenantId: params.organizationId,
              },
            ],
          },
        },
      });

      return invoice.id;
    });
  }
}
