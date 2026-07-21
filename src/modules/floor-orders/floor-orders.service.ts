import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  FloorOrderStatus,
  FloorStation,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { InvoicesService } from "@/modules/invoices/invoices.service";
import { WebSocketService } from "@/services/websocket";
import { classifyLiquorProduct } from "@/modules/invoices/liquor-sales.util";
import {
  ChargeFloorOrderDto,
  CreateFloorOrderDto,
} from "./dto/floor-order.dto";

function todayCaracas(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Rango inclusive YYYY-MM-DD (Caracas). Por defecto el mes actual. */
function resolveHistoryRange(
  month?: string,
  from?: string,
  to?: string,
): { from: string; to: string } {
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from) && to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { from, to };
  }
  const ym =
    month && /^\d{4}-\d{2}$/.test(month)
      ? month
      : todayCaracas().slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(lastDay).padStart(2, "0")}`,
  };
}

function availableStock(p: { stock: number; reservedStock: number }): number {
  return Math.max(0, p.stock - p.reservedStock);
}

function inferStation(name: string): FloorStation {
  if (classifyLiquorProduct(name)) return FloorStation.BAR;
  const u = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  // Bebidas no alcohólicas / barra
  if (
    /\bREFRESCO\b|\bJUGO\b|\bGASEOSA\b|\bPEPSI\b|\bCOCA\b|\b7UP\b|\bAGUA\b|\bCAFE\b|\bTE\b|\bMALTA\b|\bMALTIN\b|\bENERGIZANTE\b|\bGATORADE\b|\bSODA\b|\bTRAGO\b|\bCOCTEL\b|\bCOCKTAIL\b|\bMOJITO\b|\bCUBA\b/.test(
      u,
    )
  ) {
    return FloorStation.BAR;
  }
  if (
    /HAMBUR|PIZZA|PERRO|HOT.?DOG|AREPA|SANDWICH|COMBO COMIDA|PLATO|ALMUERZO|CENA|COMIDA|TEQUE|EMPANA|PAPAS|NUGGET|POLLO|CARNE|PASTA|PARRILLA|ASADO|SOPAS?|ENSALADA|TACO|SHAWARMA|YUKA|YUCA|PATACON|TEQUENO|EMPANADA|CHICKEN|WINGS|COSTILLA|CHULETA|PESCADO|MARISCO|CAMARON/.test(
      u,
    )
  ) {
    return FloorStation.KITCHEN;
  }
  return FloorStation.OTHER;
}

const ORDER_INCLUDE = {
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          imageUrl: true,
          stock: true,
          reservedStock: true,
          salePrice: true,
        },
      },
    },
  },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.FloorOrderInclude;

@Injectable()
export class FloorOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly ws: WebSocketService,
  ) {}

  private emit(organizationId: number, event: string, order: unknown) {
    try {
      this.ws.emitToOrg(organizationId, event, order);
    } catch {
      // WS opcional: no romper el flujo si el socket no está listo
    }
  }

  async list(
    organizationId: number,
    opts: { status?: string; day?: string; station?: string } = {},
  ) {
    const day =
      opts.day && /^\d{4}-\d{2}-\d{2}$/.test(opts.day)
        ? opts.day
        : todayCaracas();

    const statusFilter =
      opts.status &&
      Object.values(FloorOrderStatus).includes(opts.status as FloorOrderStatus)
        ? (opts.status as FloorOrderStatus)
        : undefined;

    const statuses = statusFilter
      ? [statusFilter]
      : [
          FloorOrderStatus.SENT,
          FloorOrderStatus.IN_PREP,
          FloorOrderStatus.READY,
        ];

    const stationFilter =
      opts.station &&
      Object.values(FloorStation).includes(opts.station as FloorStation)
        ? (opts.station as FloorStation)
        : undefined;

    const orders = await this.prisma.floorOrder.findMany({
      where: {
        organizationId,
        status: { in: statuses },
        createdAt: {
          gte: new Date(`${day}T04:00:00.000Z`), // aprox inicio Caracas UTC-4
          lt: new Date(
            new Date(`${day}T04:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000,
          ),
        },
        ...(stationFilter
          ? { items: { some: { station: stationFilter } } }
          : {}),
      },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: "asc" },
    });

    if (!stationFilter) return orders;

    // En vista cocina/barra: solo ítems de esa estación (pedidos mixtos se parten visualmente)
    return orders.map((o) => ({
      ...o,
      items: o.items.filter((i) => i.station === stationFilter),
    }));
  }

  /**
   * Pendientes abiertos agrupados por quien tomó el pedido (supervisión).
   */
  async pendingByUser(organizationId: number, day?: string) {
    const orders = await this.list(organizationId, { day });
    type Acc = {
      userId: number;
      fullName: string;
      pending: number;
      sent: number;
      inPrep: number;
      ready: number;
      totalUsd: number;
    };
    const map = new Map<number, Acc>();
    for (const o of orders) {
      const userId = o.createdById;
      const fullName = o.createdBy?.fullName?.trim() || `Usuario #${userId}`;
      const cur = map.get(userId) ?? {
        userId,
        fullName,
        pending: 0,
        sent: 0,
        inPrep: 0,
        ready: 0,
        totalUsd: 0,
      };
      cur.pending += 1;
      if (o.status === FloorOrderStatus.SENT) cur.sent += 1;
      if (o.status === FloorOrderStatus.IN_PREP) cur.inPrep += 1;
      if (o.status === FloorOrderStatus.READY) cur.ready += 1;
      cur.totalUsd += o.items.reduce(
        (s, i) => s + Number(i.unitPrice) * i.quantity,
        0,
      );
      map.set(userId, cur);
    }
    return [...map.values()]
      .map((r) => ({
        ...r,
        totalUsd: Math.round(r.totalUsd * 100) / 100,
      }))
      .sort((a, b) => b.pending - a.pending || a.fullName.localeCompare(b.fullName));
  }

  /**
   * Historial de comandas cobradas (auditoría por anfitrión / mes).
   * Anfitrión sin permiso de supervisión: solo ve las suyas.
   */
  async history(
    organizationId: number,
    opts: {
      from?: string;
      to?: string;
      month?: string;
      createdById?: number;
      viewerUserId: number;
      seeAll: boolean;
    },
  ) {
    const { from, to } = resolveHistoryRange(opts.month, opts.from, opts.to);
    const fromDate = new Date(`${from}T04:00:00.000Z`);
    const toExclusive = new Date(
      new Date(`${to}T04:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000,
    );

    let createdById: number | undefined;
    if (!opts.seeAll) {
      createdById = opts.viewerUserId;
    } else if (opts.createdById && Number.isFinite(opts.createdById)) {
      createdById = opts.createdById;
    }

    const orders = await this.prisma.floorOrder.findMany({
      where: {
        organizationId,
        status: FloorOrderStatus.CHARGED,
        chargedAt: { gte: fromDate, lt: toExclusive },
        ...(createdById ? { createdById } : {}),
      },
      include: {
        ...ORDER_INCLUDE,
        chargedInvoice: {
          select: { id: true, consecutiveNumber: true, totalAmount: true },
        },
      },
      orderBy: { chargedAt: "desc" },
      take: 500,
    });

    type UserAcc = {
      userId: number;
      fullName: string;
      orders: number;
      totalUsd: number;
    };
    const byUserMap = new Map<number, UserAcc>();
    let totalUsd = 0;

    const lines = orders.map((o) => {
      const amount = o.items.reduce(
        (s, i) => s + Number(i.unitPrice) * i.quantity,
        0,
      );
      totalUsd += amount;
      const userId = o.createdById;
      const fullName = o.createdBy?.fullName?.trim() || `Usuario #${userId}`;
      const cur = byUserMap.get(userId) ?? {
        userId,
        fullName,
        orders: 0,
        totalUsd: 0,
      };
      cur.orders += 1;
      cur.totalUsd += amount;
      byUserMap.set(userId, cur);

      return {
        id: o.id,
        tableLabel: o.tableLabel,
        customerName: o.customerName,
        status: o.status,
        notes: o.notes,
        createdAt: o.createdAt,
        sentAt: o.sentAt,
        chargedAt: o.chargedAt,
        chargedInvoiceId: o.chargedInvoiceId,
        invoiceConsecutive: o.chargedInvoice?.consecutiveNumber ?? null,
        totalUsd: Math.round(amount * 100) / 100,
        createdBy: o.createdBy
          ? { id: o.createdBy.id, fullName: o.createdBy.fullName }
          : { id: userId, fullName },
        items: o.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          name: i.product?.name ?? `Producto ${i.productId}`,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          station: i.station,
        })),
      };
    });

    const byUser = [...byUserMap.values()]
      .map((r) => ({
        ...r,
        totalUsd: Math.round(r.totalUsd * 100) / 100,
      }))
      .sort((a, b) => b.totalUsd - a.totalUsd || b.orders - a.orders);

    return {
      from,
      to,
      seeAll: opts.seeAll,
      scopedToUserId: createdById ?? null,
      summary: {
        orders: lines.length,
        totalUsd: Math.round(totalUsd * 100) / 100,
        byUser,
      },
      orders: lines,
    };
  }

  async getOne(organizationId: number, id: number) {
    const order = await this.prisma.floorOrder.findFirst({
      where: { id, organizationId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException("Comanda no encontrada");
    return order;
  }

  async create(
    organizationId: number,
    userId: number,
    dto: CreateFloorOrderDto,
  ) {
    if (!dto.items?.length) {
      throw new BadRequestException("La comanda debe tener al menos un ítem");
    }

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        organizationId,
        isActive: true,
      },
    });
    if (products.length !== new Set(productIds).size) {
      throw new NotFoundException("Uno o más productos no existen o están inactivos");
    }
    const byId = new Map(products.map((p) => [p.id, p]));

    const order = await this.prisma.floorOrder.create({
      data: {
        organizationId,
        tableLabel: dto.tableLabel.trim(),
        customerName: dto.customerName?.trim() || null,
        customerId: dto.customerId ?? null,
        notes: dto.notes?.trim() || null,
        createdById: userId,
        status: FloorOrderStatus.DRAFT,
        items: {
          create: dto.items.map((item) => {
            const p = byId.get(item.productId)!;
            return {
              productId: p.id,
              quantity: item.quantity,
              unitPrice: p.salePrice,
              notes: item.notes?.trim() || null,
              station: inferStation(p.name),
            };
          }),
        },
      },
      include: ORDER_INCLUDE,
    });

    if (dto.sendNow) {
      return this.send(organizationId, order.id);
    }

    this.emit(organizationId, "comanda:created", order);
    return order;
  }

  async send(organizationId: number, id: number) {
    const order = await this.prisma.floorOrder.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException("Comanda no encontrada");
    if (
      order.status !== FloorOrderStatus.DRAFT &&
      order.status !== FloorOrderStatus.SENT
    ) {
      throw new BadRequestException(
        `No se puede enviar una comanda en estado ${order.status}`,
      );
    }
    if (order.status === FloorOrderStatus.SENT) {
      return this.getOne(organizationId, id);
    }

    const productIds = order.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, organizationId },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // Agregar cantidades por producto (varias líneas)
    const needByProduct = new Map<number, number>();
    for (const item of order.items) {
      needByProduct.set(
        item.productId,
        (needByProduct.get(item.productId) ?? 0) + item.quantity,
      );
    }

    for (const [productId, qty] of needByProduct) {
      const p = byId.get(productId);
      if (!p) throw new NotFoundException(`Producto ${productId} no encontrado`);
      if (p.isBundle || p.isService) {
        throw new BadRequestException(
          `El producto "${p.name}" es combo/servicio; use el POS para cobro directo`,
        );
      }
      const avail = availableStock(p);
      if (avail < qty) {
        throw new BadRequestException(
          `Stock insuficiente para ${p.name}. Disponible: ${avail}, solicitado: ${qty}`,
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const [productId, qty] of needByProduct) {
        const p = await tx.product.findUnique({ where: { id: productId } });
        if (!p || availableStock(p) < qty) {
          throw new BadRequestException(
            `Stock insuficiente al reservar (producto ${productId})`,
          );
        }
        await tx.product.update({
          where: { id: productId },
          data: { reservedStock: { increment: qty } },
        });
      }
      return tx.floorOrder.update({
        where: { id },
        data: {
          status: FloorOrderStatus.SENT,
          sentAt: new Date(),
        },
        include: ORDER_INCLUDE,
      });
    });

    this.emit(organizationId, "comanda:created", updated);
    this.emit(organizationId, "comanda:updated", updated);
    return updated;
  }

  async updateStatus(
    organizationId: number,
    id: number,
    status: "IN_PREP" | "READY",
  ) {
    const order = await this.prisma.floorOrder.findFirst({
      where: { id, organizationId },
    });
    if (!order) throw new NotFoundException("Comanda no encontrada");

    const allowed: Record<string, FloorOrderStatus[]> = {
      IN_PREP: [FloorOrderStatus.SENT, FloorOrderStatus.IN_PREP],
      READY: [
        FloorOrderStatus.SENT,
        FloorOrderStatus.IN_PREP,
        FloorOrderStatus.READY,
      ],
    };
    if (!allowed[status].includes(order.status)) {
      throw new BadRequestException(
        `No se puede pasar de ${order.status} a ${status}`,
      );
    }

    const updated = await this.prisma.floorOrder.update({
      where: { id },
      data: { status: status as FloorOrderStatus },
      include: ORDER_INCLUDE,
    });
    this.emit(organizationId, "comanda:updated", updated);
    return updated;
  }

  async cancel(organizationId: number, id: number) {
    const order = await this.prisma.floorOrder.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException("Comanda no encontrada");
    if (
      order.status === FloorOrderStatus.CHARGED ||
      order.status === FloorOrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `No se puede cancelar una comanda ${order.status}`,
      );
    }

    const shouldRelease =
      order.status === FloorOrderStatus.SENT ||
      order.status === FloorOrderStatus.IN_PREP ||
      order.status === FloorOrderStatus.READY;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (shouldRelease) {
        const needByProduct = new Map<number, number>();
        for (const item of order.items) {
          needByProduct.set(
            item.productId,
            (needByProduct.get(item.productId) ?? 0) + item.quantity,
          );
        }
        for (const [productId, qty] of needByProduct) {
          await tx.product.update({
            where: { id: productId },
            data: { reservedStock: { decrement: qty } },
          });
          // Evitar reservedStock negativo
          await tx.$executeRaw`
            UPDATE products
            SET "reservedStock" = GREATEST("reservedStock", 0)
            WHERE id = ${productId}
          `;
        }
      }
      return tx.floorOrder.update({
        where: { id },
        data: {
          status: FloorOrderStatus.CANCELLED,
          cancelledAt: new Date(),
        },
        include: ORDER_INCLUDE,
      });
    });

    this.emit(organizationId, "comanda:updated", updated);
    return updated;
  }

  async charge(
    organizationId: number,
    userId: number,
    id: number,
    dto: ChargeFloorOrderDto,
  ) {
    const order = await this.prisma.floorOrder.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException("Comanda no encontrada");
    if (
      order.status !== FloorOrderStatus.READY &&
      order.status !== FloorOrderStatus.SENT &&
      order.status !== FloorOrderStatus.IN_PREP
    ) {
      throw new BadRequestException(
        `Solo se pueden cobrar comandas activas (estado actual: ${order.status})`,
      );
    }
    if (order.chargedInvoiceId) {
      throw new BadRequestException("Esta comanda ya fue cobrada");
    }

    const releaseReserved = order.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
    }));

    const guest =
      order.customerName?.trim() ||
      (order.customerId ? `cliente #${order.customerId}` : null);
    const notes =
      dto.notes?.trim() ||
      `Comanda #${order.id} · ${order.tableLabel}${guest ? ` · ${guest}` : ""}${order.notes ? ` · ${order.notes}` : ""}`;

    const invoice = await this.invoices.create(
      {
        customerId: dto.customerId ?? order.customerId ?? undefined,
        items: order.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
        paymentMethod: dto.paymentMethod,
        payments: dto.payments,
        notes,
      },
      organizationId,
      userId,
      { releaseReserved },
    );

    const updated = await this.prisma.floorOrder.update({
      where: { id },
      data: {
        status: FloorOrderStatus.CHARGED,
        chargedInvoiceId: invoice.id,
        chargedAt: new Date(),
      },
      include: ORDER_INCLUDE,
    });

    this.emit(organizationId, "comanda:updated", updated);
    return { order: updated, invoice };
  }
}
