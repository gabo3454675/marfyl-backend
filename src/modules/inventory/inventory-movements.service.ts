import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ActivityLogService } from '@/modules/activity-log/activity-log.service';
import { PushNotificationService } from '@/modules/notifications/push-notification.service';
import { getCompanyIdFromOrganization } from '@/common/helpers/organization.helper';
import type { CreateMovementDto } from './dto/create-movement.dto';
import { MovementType, ConsumptionReason } from '@prisma/client';

const AUTOCONSUMO_CATEGORY_NAME = 'Autoconsumo y Mermas';

function defaultConsumptionReason(type: MovementType): ConsumptionReason {
  if (type === 'MERMA_VENCIDO' || type === 'MERMA_DANADO') return 'MERMA';
  return 'USO_OPERATIVO';
}

@Injectable()
export class InventoryMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
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
    /** Cabecera `x-disis-dispatch-secret`; obligatoria si `dto.stockAlreadyAdjusted === true`. */
    disisDispatchSecretHeader?: string;
  }) {
    const { organizationId, userId, dto } = params;

    if (dto.stockAlreadyAdjusted === true) {
      const expected = this.configService.get<string>('DISIS_DISPATCH_SHARED_SECRET')?.trim();
      if (!expected) {
        throw new BadRequestException(
          'stockAlreadyAdjusted requiere configurar DISIS_DISPATCH_SHARED_SECRET en el servidor.',
        );
      }
      if (params.disisDispatchSecretHeader !== expected) {
        throw new ForbiddenException(
          'Cabecera x-disis-dispatch-secret inválida o ausente para stockAlreadyAdjusted.',
        );
      }
    }

    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        organizationId,
      },
      select: { id: true, name: true, stock: true, costPrice: true, minStock: true },
    });

    if (!product) {
      throw new NotFoundException(
        `Producto con id ${dto.productId} no encontrado en esta organización.`,
      );
    }

    if (!dto.stockAlreadyAdjusted && product.stock < dto.quantity) {
      throw new BadRequestException(
        `Stock insuficiente. Disponible: ${product.stock}, solicitado: ${dto.quantity}. No se permite stock negativo.`,
      );
    }

    const movementType = dto.type as MovementType;
    const unitCost = dto.unitCostAtTransaction ?? Number(product.costPrice ?? 0);
    const totalCost = dto.quantity * unitCost;
    const consumptionReason = dto.consumptionReason ?? defaultConsumptionReason(movementType);

    const companyId = await getCompanyIdFromOrganization(this.prisma, organizationId);

    const result = await this.prisma.$transaction(async (tx) => {
      const movement = await tx.inventoryMovement.create({
        data: {
          type: movementType,
          quantity: -dto.quantity,
          reason: dto.reason ?? null,
          productId: dto.productId,
          userId,
          tenantId: organizationId,
          unitCostAtTransaction: unitCost,
          consumptionReason,
        },
      });

      if (!dto.stockAlreadyAdjusted) {
        await tx.product.update({
          where: { id: dto.productId },
          data: { stock: { decrement: dto.quantity } },
        });
      }

      const category = await this.getOrCreateAutoconsumoCategory(tx, organizationId, companyId);
      const disisNote = dto.stockAlreadyAdjusted ? ' [stock ya descontado vía DISIS]' : '';
      await tx.expense.create({
        data: {
          companyId,
          organizationId,
          date: new Date(),
          amount: totalCost,
          description: `Autoconsumo/Merma: ${product.name} x ${dto.quantity} (${dto.type})${dto.reason ? ` - ${dto.reason}` : ''}${disisNote}`,
          status: 'PAID',
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
      action: 'AUTOCONSUMO_REGISTERED',
      entityType: 'inventory_movement',
      entityId: String(result.movement.id),
      newValue: {
        productId: dto.productId,
        productName: product.name,
        quantity: dto.quantity,
        type: movementType,
        consumptionReason,
        totalCost,
      },
      summary: `Autoconsumo: ${product.name} x${dto.quantity} (${dto.type})${dto.reason ? ` - ${dto.reason}` : ''}. Costo: $${totalCost.toFixed(2)}.`,
    });

    const minStock = product.minStock ?? 5;
    if (result.newStock < minStock) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { nombre: true },
      });
      this.pushNotification
        .notifyStockBajo({
          organizationName: org?.nombre ?? 'Organización',
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
    tx: { expenseCategory: { findFirst: (args: any) => Promise<any>; create: (args: any) => Promise<any> } },
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
          description: 'Gastos por autoconsumo, mermas y uso operativo de inventario',
        },
      });
    }
    return category;
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
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
      include: {
        product: { select: { id: true, name: true, sku: true } },
        user: { select: { id: true, email: true, fullName: true } },
      },
    });
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
      type: { in: ['AUTOCONSUMO', 'MERMA_VENCIDO', 'MERMA_DANADO', 'USO_TALLER'] },
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
    const totalCost = (m: { quantity: number; unitCostAtTransaction: unknown }) =>
      Math.abs(m.quantity) * Number(m.unitCostAtTransaction ?? 0);

    const economicImpactByDay: { date: string; totalCost: number; count: number }[] = [];
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

    const productMap = new Map<number, { productName: string; quantity: number; totalCost: number }>();
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

    const reasonMap = new Map<string | null, { count: number; totalCost: number }>();
    for (const m of movements) {
      const reason = m.consumptionReason ?? 'SIN_CLASIFICAR';
      const prev = reasonMap.get(reason) ?? { count: 0, totalCost: 0 };
      prev.count += 1;
      prev.totalCost += totalCost(m);
      reasonMap.set(reason, prev);
    }
    const reasonDistribution = Array.from(reasonMap.entries()).map(([reason, v]) => ({
      reason,
      ...v,
    }));

    return {
      economicImpactByDay,
      topProducts,
      reasonDistribution,
    };
  }
}
