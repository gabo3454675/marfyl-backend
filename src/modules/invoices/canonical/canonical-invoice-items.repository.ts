import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

export type CanonicalInvoiceItemRow = {
  id: number;
  invoiceId: number;
  productId: number | null;
  variantId: number | null;
  quantity: number | null;
  unitPrice: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  taxRate: number;
  taxableBase: Prisma.Decimal;
  ivaLine: Prisma.Decimal;
  recordClass: string;
  lineageStatus: string;
  sourceHash: string | null;
  sourceLineKey: string | null;
  sourceSkuExact: string | null;
  sourceDescription: string | null;
  sourceQuantity: Prisma.Decimal | null;
  sourceDetailedQuantity: Prisma.Decimal | null;
  effectiveQuantity: Prisma.Decimal | null;
  product_sku: string | null;
  product_name: string | null;
  display_name: string | null;
  display_sku: string | null;
  display_quantity: Prisma.Decimal | null;
  sku_group_key: string | null;
};

/**
 * Lectura canónica ACTIVE-only vía vista invoice_items_canonical.
 * Exige organizationId (join invoices) para aislamiento multi-tenant.
 */
@Injectable()
export class CanonicalInvoiceItemsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByInvoiceId(
    organizationId: number,
    invoiceId: number,
  ): Promise<CanonicalInvoiceItemRow[]> {
    return this.prisma.$queryRaw<CanonicalInvoiceItemRow[]>`
      SELECT c.*
      FROM invoice_items_canonical c
      INNER JOIN invoices i ON i.id = c."invoiceId"
      WHERE i."organizationId" = ${organizationId}
        AND c."invoiceId" = ${invoiceId}
      ORDER BY c.id ASC
    `;
  }

  async findByOrganizationAndDateRange(
    organizationId: number,
    from: Date,
    toExclusive?: Date,
  ): Promise<CanonicalInvoiceItemRow[]> {
    const toFilter = toExclusive
      ? Prisma.sql`AND i."issueDate" < ${toExclusive}`
      : Prisma.empty;

    return this.prisma.$queryRaw<CanonicalInvoiceItemRow[]>`
      SELECT c.*
      FROM invoice_items_canonical c
      INNER JOIN invoices i ON i.id = c."invoiceId"
      WHERE i."organizationId" = ${organizationId}
        AND i.status = 'PAID'
        AND i."deletedAt" IS NULL
        AND i."issueDate" >= ${from}
        ${toFilter}
      ORDER BY c.id ASC
    `;
  }
}
