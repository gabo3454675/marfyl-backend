import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { HybridService } from '../hybrid/hybrid.service';
import { EntityResolverService } from './services/entity-resolver.service';
import { VentaAdapter } from './adapters/venta.adapter';
import { ProductoAdapter } from './adapters/producto.adapter';
import { ClienteAdapter } from './adapters/cliente.adapter';
import { ventaDedupKey } from './adapters/dedup-keys';
import { isImportableStatus } from './adapters/status.mapper';
import type { ImportContext } from './types/import-context';
import type { HybridVentaInput, HybridVentaDetailInput } from './types/hybrid-input.types';
import type { ImportResult, HybridImportPreviewResult, HybridImportInvoicePreview } from './types/import-result.types';

@Injectable()
export class HybridImportService {
  private readonly logger = new Logger(HybridImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hybridService: HybridService,
    private readonly entityResolver: EntityResolverService,
    private readonly ventaAdapter: VentaAdapter,
    private readonly productoAdapter: ProductoAdapter,
    private readonly clienteAdapter: ClienteAdapter,
  ) {}

  /**
   * Preview de importación de ventas.
   * Muestra qué se importaría sin persistir nada.
   */
  async previewVentas(
    organizationId: number,
    documentos?: string[],
  ): Promise<HybridImportPreviewResult> {
    // 1. Obtener contexto de importación
    const context = await this.buildContext(organizationId);

    // 2. Obtener ventas de Hybrid
    let ventas: Array<HybridVentaInput | HybridVentaDetailInput>;
    if (documentos && documentos.length > 0) {
      // Importar documentos específicos
      ventas = [];
      for (const doc of documentos) {
        try {
          const venta = await this.hybridService.getVentaByDocumento(organizationId, doc) as HybridVentaDetailInput;
          ventas.push(venta);
        } catch (error) {
          this.logger.warn(`No se pudo obtener venta ${doc}: ${error}`);
        }
      }
    } else {
      // Importar todas las ventas recientes
      const result = await this.hybridService.getVentas(organizationId, {
        limit: '100',
      }) as { items: HybridVentaInput[] };
      ventas = result.items || [];
    }

    // 3. Verificar duplicados existentes
    const existingKeys = new Set<string>();
    for (const venta of ventas) {
      const key = ventaDedupKey(venta.documento);
      const existing = await this.prisma.invoice.findFirst({
        where: {
          organizationId,
          legacyImportKey: key,
        },
        select: { id: true },
      });
      if (existing) {
        existingKeys.add(key);
      }
    }

    // 4. Construir preview
    const previews: HybridImportInvoicePreview[] = ventas.map((venta) => {
      const key = ventaDedupKey(venta.documento);
      const isDuplicate = existingKeys.has(key);
      const isImportable = isImportableStatus(venta.status);
      const validation = this.ventaAdapter.validate({
        ...venta,
        lineas: [],
      });

      let status: HybridImportInvoicePreview['status'] = 'ready';
      const issues: string[] = [];

      if (isDuplicate) {
        status = 'already_imported';
        issues.push('Ya importada anteriormente');
      } else if (!isImportable) {
        status = 'error';
        issues.push(`Status ${venta.status_nombre} no es importable`);
      } else if (!validation.valid) {
        status = 'error';
        issues.push(...validation.errors.map((e) => e.message));
      }

      return {
        documento: venta.documento,
        fecha: venta.fecha,
        cliente: venta.cliente,
        status,
        hybridStatus: venta.status,
        marfylStatus: isImportable ? 'PAID' : 'CANCELLED',
        totalAmount: venta.neto,
        lineCount: venta.lineas?.length ?? (venta as HybridVentaInput).items ?? 0,
        issues,
        lines: [],
      };
    });

    const summary = {
      ventas: previews.length,
      lineas: previews.reduce((sum, p) => sum + p.lineCount, 0),
      ready: previews.filter((p) => p.status === 'ready').length,
      warnings: previews.filter((p) => p.status === 'warning').length,
      errors: previews.filter((p) => p.status === 'error').length,
      alreadyImported: previews.filter((p) => p.status === 'already_imported').length,
    };

    return {
      batchId: `hybrid-${Date.now()}`,
      organizationId,
      summary,
      invoices: previews,
    };
  }

  /**
   * Confirmar importación de ventas.
   * Persiste las ventas en la base de datos.
   */
  async confirmVentas(
    organizationId: number,
    documentos: string[],
  ): Promise<ImportResult> {
    const context = await this.buildContext(organizationId);
    const result: ImportResult = {
      imported: 0,
      skipped: [],
      errors: [],
      warnings: [],
    };

    for (const documento of documentos) {
      try {
        // 1. Obtener detalle de venta
        const venta = await this.hybridService.getVentaByDocumento(
          organizationId,
          documento,
        ) as HybridVentaDetailInput;

        // 2. Validar
        const validation = this.ventaAdapter.validate(venta);
        if (!validation.valid) {
          result.errors.push({
            key: documento,
            error: validation.errors.map((e) => e.message).join(', '),
            code: 'VALIDATION_FAILED',
          });
          continue;
        }

        // 3. Verificar duplicado
        const dedupKey = this.ventaAdapter.getDedupKey(venta);
        const existing = await this.prisma.invoice.findFirst({
          where: {
            organizationId,
            legacyImportKey: dedupKey,
          },
          select: { id: true },
        });

        if (existing) {
          result.skipped.push({
            key: documento,
            reason: 'already_imported',
          });
          continue;
        }

        // 4. Transformar
        const dto = this.ventaAdapter.transform(venta, context);

        // 5. Resolver entidades
        const customerResolution = await this.entityResolver.resolveCustomer(
          context.organizationId,
          context.companyId,
          venta.rif,
          '',
          venta.cliente,
        );

        const productResolutions = await this.entityResolver.resolveProductsBatch(
          context.organizationId,
          venta.lineas.map((l) => ({ codigo: l.codigo, nombre: l.nombre })),
        );

        // 6. Asignar IDs resueltos a los items
        for (const item of dto.items) {
          const resolution = productResolutions.get(item.sourceSkuExact);
          if (resolution?.product) {
            item.productId = resolution.product.id;
          } else {
            result.warnings.push({
              key: `${documento}:${item.sourceSkuExact}`,
              message: `Producto no encontrado: ${item.sourceSkuExact} - ${item.sourceDescription}`,
              code: 'PRODUCT_NOT_FOUND',
            });
          }
        }

        // 7. Persistir en transacción
        await this.prisma.$transaction(async (tx) => {
          const invoice = await tx.invoice.create({
            data: {
              organizationId: context.organizationId,
              companyId: context.companyId,
              customerId: customerResolution.customer?.id || null,
              sellerId: null,
              totalAmount: dto.totalAmount,
              status: dto.status,
              paymentMethod: dto.paymentMethod,
              paymentStatus: dto.paymentStatus,
              montoUsd: dto.montoUsd,
              montoBs: dto.montoBs,
              tasaReferencia: dto.tasaReferencia,
              notes: dto.notes,
              controlNumber: dto.controlNumber,
              issueDate: dto.issueDate,
              baseExempt: dto.baseExempt,
              baseGeneral: dto.baseGeneral,
              baseReduced: dto.baseReduced,
              ivaAmount: dto.ivaAmount,
              legacyImportKey: dto.legacyImportKey,
              importSource: dto.importSource,
              isLegacyImport: dto.isLegacyImport,
              items: {
                create: dto.items.map((item) => ({
                  productId: item.productId,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  subtotal: item.subtotal,
                  taxRate: item.taxRate,
                  taxableBase: item.taxableBase,
                  ivaLine: item.ivaLine,
                  sourceHash: item.sourceHash,
                  sourceLineKey: item.sourceLineKey,
                  sourceSkuExact: item.sourceSkuExact,
                  sourceDescription: item.sourceDescription,
                  sourceQuantity: item.sourceQuantity,
                  effectiveQuantity: item.effectiveQuantity,
                })),
              },
            },
          });

          // 8. Crear movimiento de inventario si está pagada
          if (dto.status === 'PAID') {
            for (const item of dto.items) {
              if (item.productId) {
                await tx.inventoryMovement.create({
                  data: {
                    type: 'VENTA',
                    quantity: -Math.abs(item.quantity),
                    productId: item.productId,
                    userId: context.userId,
                    tenantId: context.organizationId,
                    unitCostAtTransaction: 0,
                    reason: `Import Hybrid ${documento}`,
                  },
                });
              }
            }
          }
        });

        result.imported++;
        this.logger.log(`Venta importada: ${documento}`);
      } catch (error) {
        result.errors.push({
          key: documento,
          error: error instanceof Error ? error.message : 'Error desconocido',
          code: 'IMPORT_FAILED',
        });
        this.logger.error(`Error importando venta ${documento}: ${error}`);
      }
    }

    return result;
  }

  /**
   * Construye el contexto de importación para una organización.
   */
  private async buildContext(organizationId: number): Promise<ImportContext> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        slug: true,
        currencyCode: true,
        exchangeRate: true,
      },
    });

    if (!org) {
      throw new Error(`Organización ${organizationId} no encontrada`);
    }

    // Obtener company legacy (requerido por schema)
    // Company no tiene organizationId directo; buscar vía CompanyMember o usar la primera disponible
    const company = await this.prisma.company.findFirst({
      select: { id: true },
    });

    return {
      organizationId: org.id,
      companyId: company?.id || 0,
      userId: 0, // Se debe pasar desde el controller
      exchangeRate: org.exchangeRate || 1,
      currencyCode: org.currencyCode || 'USD',
      importSource: 'hybrid',
      orgSlug: org.slug,
    };
  }
}
