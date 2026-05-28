import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { FiscalEngineService } from './fiscal-engine.service';
import { computeInvoiceTax } from './helpers/tax-calculator';

@Injectable()
export class FiscalBackfillService {
  private readonly logger = new Logger(FiscalBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fiscalEngine: FiscalEngineService,
  ) {}

  /**
   * Proyecta facturas historicas sin linea en libro de ventas.
   * Opcionalmente recalcula bases/IVA si la factura tiene totales sin desglose.
   */
  async backfillLibroVentas(
    organizationId: number,
    options?: { year?: number; month?: number; limit?: number },
  ) {
    const limit = options?.limit ?? 500;
    const where: {
      organizationId: number;
      createdAt?: { gte: Date; lt: Date };
      libroVentaLine: null;
    } = {
      organizationId,
      libroVentaLine: null,
    };

    if (options?.year && options?.month) {
      const start = new Date(options.year, options.month - 1, 1);
      const end = new Date(options.year, options.month, 1);
      where.createdAt = { gte: start, lt: end };
    }

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        items: { include: { product: { select: { isExempt: true } } } },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let projected = 0;
    let recalculated = 0;
    let skipped = 0;
    const errors: { invoiceId: number; message: string }[] = [];

    for (const inv of invoices) {
      try {
        const needsTax =
          Number(inv.ivaAmount) === 0 &&
          Number(inv.baseGeneral) === 0 &&
          Number(inv.baseExempt) === 0;

        if (needsTax && inv.items.length > 0) {
          const taxTotals = computeInvoiceTax(
            inv.items.map((it) => ({
              amount: Number(it.subtotal),
              isExempt: it.product?.isExempt,
            })),
          );
          await this.prisma.invoice.update({
            where: { id: inv.id },
            data: {
              baseExempt: taxTotals.baseExempt,
              baseReduced: taxTotals.baseReduced,
              baseGeneral: taxTotals.baseGeneral,
              ivaAmount: taxTotals.ivaAmount,
              issueDate: inv.issueDate ?? inv.createdAt,
            },
          });
          for (let i = 0; i < inv.items.length; i++) {
            const lt = taxTotals.lines[i];
            if (!lt) continue;
            await this.prisma.invoiceItem.update({
              where: { id: inv.items[i].id },
              data: {
                taxRate: lt.taxRate,
                taxableBase: lt.taxableBase,
                ivaLine: lt.ivaLine,
              },
            });
          }
          recalculated++;
        }

        const line = await this.fiscalEngine.projectSale(organizationId, inv.id);
        if (line) projected++;
        else skipped++;
      } catch (e) {
        errors.push({
          invoiceId: inv.id,
          message: e instanceof Error ? e.message : String(e),
        });
        this.logger.warn(`Backfill factura ${inv.id}: ${e}`);
      }
    }

    return {
      scanned: invoices.length,
      projected,
      recalculated,
      skipped,
      errors,
    };
  }
}
