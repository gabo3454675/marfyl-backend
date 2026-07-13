import {
  BadRequestException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { getCompanyIdFromOrganization } from "@/common/helpers/organization.helper";
import { buildMovementReason } from "@/modules/invoice-upload/invoice-upload.constants";
import {
  parseMonddyPurchasesExcel,
  type ParsedPurchaseGroup,
  type ParsedPurchaseLine,
} from "./monddy-purchases.parser";

type ProductRow = {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  costPrice: unknown;
  salePrice: unknown;
  isBundle: boolean;
  isService: boolean;
};

export interface PurchaseLinePreview {
  rowNum: number;
  sku: string;
  description: string;
  quantity: number;
  unitCostUsd: number;
  salePriceUsd: number;
  isExempt: boolean;
  productId: number | null;
  productName: string | null;
  matchMethod: "sku" | "description" | "create" | "none";
  willCreate: boolean;
}

export interface PurchaseGroupPreview {
  groupIndex: number;
  purchaseDate: string;
  invoiceRef: string;
  supplierName: string;
  totalUsd: number;
  lines: PurchaseLinePreview[];
  importKey: string;
  alreadyImported: boolean;
}

export interface PurchasesImportPreview {
  organizationId: number;
  fileName: string;
  groups: PurchaseGroupPreview[];
  totalLines: number;
  totalAmountUsd: number;
  productsToCreate: number;
  suppliersToCreate: string[];
}

@Injectable()
export class PurchasesImportService {
  private readonly logger = new Logger(PurchasesImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  private normalizeSku(sku: string): string {
    return sku.trim();
  }

  private normalizeName(name: string): string {
    return name
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  private nameSimilarity(a: string, b: string): number {
    const wa = new Set(this.normalizeName(a).split(" ").filter((w) => w.length > 2));
    const wb = new Set(this.normalizeName(b).split(" ").filter((w) => w.length > 2));
    if (wa.size === 0 || wb.size === 0) return 0;
    let shared = 0;
    for (const w of wa) if (wb.has(w)) shared += 1;
    return shared / Math.max(wa.size, wb.size);
  }

  private buildImportKey(group: ParsedPurchaseGroup): string {
    return `monddy-compra:${group.purchaseDate}:${group.supplierName}:${group.invoiceRef}:${group.groupIndex}`;
  }

  private resolveProduct(
    line: ParsedPurchaseLine,
    bySku: Map<string, ProductRow>,
    byName: Map<string, ProductRow>,
  ): { product: ProductRow | null; method: PurchaseLinePreview["matchMethod"] } {
    const skuKey = this.normalizeSku(line.sku);
    const descKey = this.normalizeName(line.description);

    const bySkuHit = bySku.get(skuKey);
    if (bySkuHit && this.nameSimilarity(bySkuHit.name, line.description) >= 0.3) {
      return { product: bySkuHit, method: "sku" };
    }

    const byDesc = byName.get(descKey);
    if (byDesc) return { product: byDesc, method: "description" };

    for (const p of byName.values()) {
      const n = this.normalizeName(p.name);
      if (n === descKey || n.includes(descKey) || descKey.includes(n)) {
        return { product: p, method: "description" };
      }
    }

    if (bySkuHit) {
      return { product: bySkuHit, method: "sku" };
    }

    return { product: null, method: "create" };
  }

  async preview(params: {
    buffer: Buffer;
    fileName: string;
    organizationId: number;
  }): Promise<PurchasesImportPreview> {
    const groups = parseMonddyPurchasesExcel(params.buffer);
    if (groups.length === 0) {
      throw new BadRequestException("No se encontraron líneas de compra en el archivo");
    }

    const products = await this.prisma.product.findMany({
      where: { organizationId: params.organizationId, isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        costPrice: true,
        salePrice: true,
        isBundle: true,
        isService: true,
      },
    });

    const bySku = new Map<string, ProductRow>();
    const byName = new Map<string, ProductRow>();
    for (const p of products) {
      if (p.sku) bySku.set(this.normalizeSku(p.sku), p);
      byName.set(this.normalizeName(p.name), p);
    }

    const existingExpenses = await this.prisma.expense.findMany({
      where: {
        organizationId: params.organizationId,
        deletedAt: null,
        OR: [
          { importKey: { startsWith: "monddy-compra:" } },
          { description: { contains: "monddy-compra:" } },
        ],
      },
      select: { importKey: true, description: true },
    });
    const importedKeys = new Set(
      existingExpenses
        .map((e) => {
          if (e.importKey) return e.importKey.trim();
          const m = e.description.match(/monddy-compra:[^|]+/);
          return m ? m[0].trim() : null;
        })
        .filter(Boolean) as string[],
    );

    const supplierNames = new Set<string>();
    let productsToCreate = 0;
    let totalLines = 0;
    let totalAmountUsd = 0;

    const previewGroups: PurchaseGroupPreview[] = groups.map((group) => {
      supplierNames.add(group.supplierName);
      const importKey = this.buildImportKey(group);
      const lines: PurchaseLinePreview[] = group.lines.map((line) => {
        const { product, method } = this.resolveProduct(line, bySku, byName);
        const willCreate = !product;
        if (willCreate) productsToCreate += 1;
        totalLines += 1;
        totalAmountUsd += line.quantity * line.unitCostUsd;
        return {
          rowNum: line.rowNum,
          sku: line.sku,
          description: line.description,
          quantity: line.quantity,
          unitCostUsd: line.unitCostUsd,
          salePriceUsd: line.salePriceUsd,
          isExempt: line.isExempt,
          productId: product?.id ?? null,
          productName: product?.name ?? null,
          matchMethod: willCreate ? "create" : method,
          willCreate,
        };
      });

      return {
        groupIndex: group.groupIndex,
        purchaseDate: group.purchaseDate,
        invoiceRef: group.invoiceRef,
        supplierName: group.supplierName,
        totalUsd: Math.round(lines.reduce((s, l) => s + l.quantity * l.unitCostUsd, 0) * 100) / 100,
        lines,
        importKey,
        alreadyImported: importedKeys.has(importKey),
      };
    });

    const newSuppliers = [...supplierNames].filter(Boolean);
    return {
      organizationId: params.organizationId,
      fileName: params.fileName,
      groups: previewGroups,
      totalLines,
      totalAmountUsd: Math.round(totalAmountUsd * 100) / 100,
      productsToCreate,
      suppliersToCreate: newSuppliers,
    };
  }

  async confirm(params: {
    buffer: Buffer;
    fileName: string;
    organizationId: number;
    userId: number;
    skipImported?: boolean;
  }) {
    const preview = await this.preview({
      buffer: params.buffer,
      fileName: params.fileName,
      organizationId: params.organizationId,
    });

    const companyId = await getCompanyIdFromOrganization(
      this.prisma,
      params.organizationId,
    );

    const category = await this.prisma.expenseCategory.findFirst({
      where: {
        organizationId: params.organizationId,
        name: { contains: "inventario", mode: "insensitive" },
      },
    });
    if (!category) {
      throw new BadRequestException(
        "No existe categoría «Inventario». Créela antes de importar compras.",
      );
    }

    const supplierCache = new Map<string, number>();
    const groups = parseMonddyPurchasesExcel(params.buffer);

    let expensesCreated = 0;
    let expensesSkipped = 0;
    let productsCreated = 0;
    const createdProductIds = new Set<number>();

    let movementsCreated = 0;
    let stockAdded = 0;

    for (const group of groups) {
      const importKey = this.buildImportKey(group);
      const groupPreview = preview.groups.find((g) => g.groupIndex === group.groupIndex);
      if (params.skipImported !== false && groupPreview?.alreadyImported) {
        expensesSkipped += 1;
        continue;
      }

      const supplierId = await this.ensureSupplier(
        params.organizationId,
        companyId,
        group.supplierName,
        supplierCache,
      );

      const validated: Array<{
        productId: number;
        productName: string;
        quantity: number;
        unitCostUsd: number;
        salePriceUsd: number;
        isExempt: boolean;
      }> = [];

      for (const line of group.lines) {
        const { productId, created } = await this.ensureProduct({
          organizationId: params.organizationId,
          companyId,
          line,
          previewLine: groupPreview?.lines.find((l) => l.rowNum === line.rowNum),
        });
        if (created && !createdProductIds.has(productId)) {
          createdProductIds.add(productId);
          productsCreated += 1;
        }
        const product = await this.prisma.product.findUnique({
          where: { id: productId },
          select: { name: true },
        });
        validated.push({
          productId,
          productName: product?.name ?? line.description,
          quantity: line.quantity,
          unitCostUsd: line.unitCostUsd,
          salePriceUsd: line.salePriceUsd,
          isExempt: line.isExempt,
        });
      }

      const totalAmount = Math.round(
        validated.reduce((s, l) => s + l.quantity * l.unitCostUsd, 0) * 100,
      ) / 100;

      await this.prisma.$transaction(
        async (tx) => {
          const expense = await tx.expense.create({
            data: {
              companyId,
              organizationId: params.organizationId,
              date: new Date(`${group.purchaseDate}T12:00:00.000Z`),
              amount: totalAmount,
              description: `Compra importada Monddy | ${importKey} | ${group.supplierName}`,
              importKey,
              categoryId: category.id,
              supplierId,
              referenceNumber: group.invoiceRef,
              supplierInvoiceNumber: group.invoiceRef,
              status: "PAID",
            },
          });

          for (const line of validated) {
            await tx.inventoryMovement.create({
              data: {
                type: "COMPRA",
                quantity: line.quantity,
                reason: buildMovementReason(expense.id),
                unitCostAtTransaction: line.unitCostUsd,
                product: { connect: { id: line.productId } },
                user: { connect: { id: params.userId } },
                tenant: { connect: { id: params.organizationId } },
              },
            });
            movementsCreated += 1;
            stockAdded += line.quantity;

            await tx.product.update({
              where: { id: line.productId },
              data: {
                stock: { increment: line.quantity },
                costPrice: line.unitCostUsd,
                ...(line.salePriceUsd > 0
                  ? {
                      salePrice: line.salePriceUsd,
                      salePriceCurrency: "USD",
                    }
                  : {}),
                isExempt: line.isExempt,
              },
            });
          }
        },
        { maxWait: 15_000, timeout: 120_000 },
      );
      expensesCreated += 1;
    }

    this.logger.log(
      `Import compras Monddy org=${params.organizationId}: gastos=${expensesCreated}, omitidos=${expensesSkipped}, productos_nuevos=${productsCreated}`,
    );

    return {
      fileName: params.fileName,
      expensesCreated,
      expensesSkipped,
      productsCreated,
      movementsCreated,
      stockAdded,
      totalAmountUsd: preview.totalAmountUsd,
      groups: preview.groups.length,
    };
  }

  private async ensureSupplier(
    organizationId: number,
    companyId: number,
    name: string,
    cache: Map<string, number>,
  ): Promise<number> {
    const key = this.normalizeName(name);
    const cached = cache.get(key);
    if (cached) return cached;

    const existing = await this.prisma.supplier.findFirst({
      where: {
        organizationId,
        name: { equals: name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existing) {
      cache.set(key, existing.id);
      return existing.id;
    }

    const created = await this.prisma.supplier.create({
      data: {
        companyId,
        organizationId,
        name: name.trim(),
      },
      select: { id: true },
    });
    cache.set(key, created.id);
    return created.id;
  }

  private async ensureProduct(params: {
    organizationId: number;
    companyId: number;
    line: ParsedPurchaseLine;
    previewLine?: PurchaseLinePreview;
  }): Promise<{ productId: number; created: boolean }> {
    if (params.previewLine?.productId) {
      return { productId: params.previewLine.productId, created: false };
    }

    const sku = this.normalizeSku(params.line.sku);
    const existing = await this.prisma.product.findFirst({
      where: { organizationId: params.organizationId, sku },
      select: { id: true },
    });
    if (existing) return { productId: existing.id, created: false };

    const created = await this.prisma.product.create({
      data: {
        companyId: params.companyId,
        organizationId: params.organizationId,
        name: params.line.description.trim(),
        sku,
        costPrice: params.line.unitCostUsd,
        salePrice:
          params.line.salePriceUsd > 0
            ? params.line.salePriceUsd
            : params.line.unitCostUsd,
        salePriceCurrency: "USD",
        isExempt: params.line.isExempt,
        stock: 0,
        minStock: 5,
      },
      select: { id: true },
    });
    return { productId: created.id, created: true };
  }
}
