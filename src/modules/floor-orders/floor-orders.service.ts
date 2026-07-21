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

function availableStock(p: { stock: number; reservedStock: number }): number {
  return Math.max(0, p.stock - p.reservedStock);
}

function inferStation(name: string): FloorStation {
  if (classifyLiquorProduct(name)) return FloorStation.BAR;
  const u = name.toUpperCase();
  if (
    /HAMBUR|PIZZA|PERRO|HOT.?DOG|AREPA|SANDWICH|COMBO COMIDA|PLATO|ALMUERZO|CENA|COMIDA|TEQUE|EMPANA|PAPAS|NUGGET|POLLO|CARNE|PASTA/.test(
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
    opts: { status?: string; day?: string } = {},
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

    return this.prisma.floorOrder.findMany({
      where: {
        organizationId,
        status: { in: statuses },
        createdAt: {
          gte: new Date(`${day}T04:00:00.000Z`), // aprox inicio Caracas UTC-4
          lt: new Date(
            new Date(`${day}T04:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000,
          ),
        },
      },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
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
