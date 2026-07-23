import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  FloorOrderStatus,
  FloorTableAccountStatus,
  FloorPaymentMode,
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
import { getCompanyIdFromOrganization } from "@/common/helpers/organization.helper";

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

  private async assertTableAccountsEnabled(organizationId: number) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    });
    if (!["monddy", "el-rancho-de-german"].includes(organization?.slug ?? "")) {
      throw new BadRequestException("La gestión de mesas aún no está habilitada para esta organización.");
    }
  }

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

  /** Trazabilidad diaria por anfitrión: tomado, pendiente, cobrado y cancelado. */
  async pendingByUser(organizationId: number, day?: string) {
    const resolvedDay =
      day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : todayCaracas();
    const from = new Date(`${resolvedDay}T04:00:00.000Z`);
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    const orders = await this.prisma.floorOrder.findMany({
      where: { organizationId, createdAt: { gte: from, lt: to } },
      include: {
        items: true,
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    type Acc = {
      userId: number;
      fullName: string;
      taken: number;
      pending: number;
      sent: number;
      inPrep: number;
      ready: number;
      charged: number;
      cancelled: number;
      totalTakenUsd: number;
      chargedUsd: number;
      pendingUsd: number;
    };
    const map = new Map<number, Acc>();
    for (const o of orders) {
      const userId = o.createdById;
      const fullName = o.createdBy?.fullName?.trim() || `Usuario #${userId}`;
      const cur = map.get(userId) ?? {
        userId,
        fullName,
        taken: 0,
        pending: 0,
        sent: 0,
        inPrep: 0,
        ready: 0,
        charged: 0,
        cancelled: 0,
        totalTakenUsd: 0,
        chargedUsd: 0,
        pendingUsd: 0,
      };
      const amount = o.items.reduce(
        (s, i) => s + Number(i.unitPrice) * i.quantity,
        0,
      );
      cur.taken += 1;
      if (o.status !== FloorOrderStatus.CANCELLED) cur.totalTakenUsd += amount;
      if (o.status === FloorOrderStatus.SENT) cur.sent += 1;
      if (o.status === FloorOrderStatus.IN_PREP) cur.inPrep += 1;
      if (o.status === FloorOrderStatus.READY) cur.ready += 1;
      if (o.status === FloorOrderStatus.CHARGED) {
        cur.charged += 1;
        cur.chargedUsd += amount;
      } else if (o.status === FloorOrderStatus.CANCELLED) {
        cur.cancelled += 1;
      } else {
        cur.pending += 1;
        cur.pendingUsd += amount;
      }
      map.set(userId, cur);
    }
    return [...map.values()]
      .map((r) => ({
        ...r,
        totalTakenUsd: Math.round(r.totalTakenUsd * 100) / 100,
        chargedUsd: Math.round(r.chargedUsd * 100) / 100,
        pendingUsd: Math.round(r.pendingUsd * 100) / 100,
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

  async listTables(organizationId: number) {
    await this.assertTableAccountsEnabled(organizationId);
    const existing = await this.prisma.floorTable.count({ where: { organizationId } });
    if (existing === 0) {
      await this.prisma.floorTable.createMany({
        data: [1, 2, 3, 4].map((number) => ({
          organizationId,
          label: `Mesa ${number}`,
          zone: "Salón principal",
          sortOrder: number,
        })),
        skipDuplicates: true,
      });
    }
    const tables = await this.prisma.floorTable.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      include: {
        accounts: {
          where: { status: FloorTableAccountStatus.OPEN },
          include: {
            orders: {
              where: { status: { in: [FloorOrderStatus.SENT, FloorOrderStatus.IN_PREP, FloorOrderStatus.READY] } },
              include: { items: true },
            },
            payments: true,
          },
        },
      },
    });
    return tables.map((table) => {
      const account = table.accounts[0] ?? null;
      const total = account?.orders.reduce((sum, order) =>
        sum + order.items.reduce((lineSum, item) => lineSum + Number(item.unitPrice) * item.quantity, 0), 0) ?? 0;
      const paid = account?.payments.reduce((sum, payment) => sum + Number(payment.amount), 0) ?? 0;
      return {
        id: table.id, label: table.label, zone: table.zone, capacity: table.capacity,
        accountId: account?.id ?? null, status: account ? "OCCUPIED" : "FREE",
        totalUsd: Math.round(total * 100) / 100, paidUsd: Math.round(paid * 100) / 100,
        balanceUsd: Math.round(Math.max(0, total - paid) * 100) / 100,
        ordersCount: account?.orders.length ?? 0,
      };
    });
  }

  async createTable(organizationId: number, label: string, zone?: string) {
    await this.assertTableAccountsEnabled(organizationId);
    const count = await this.prisma.floorTable.count({ where: { organizationId } });
    return this.prisma.floorTable.create({
      data: { organizationId, label: label.trim(), zone: zone?.trim() || "", sortOrder: count },
    });
  }

  async recordTablePayment(
    organizationId: number,
    userId: number,
    accountId: number,
    payment: { amount: number; method: string; currency?: string; notes?: string },
  ) {
    const account = await this.prisma.floorTableAccount.findFirst({
      where: { id: accountId, organizationId, status: FloorTableAccountStatus.OPEN },
      include: { orders: { include: { items: true } }, payments: true },
    });
    if (!account) throw new NotFoundException("Cuenta de mesa abierta no encontrada");
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException("Monto inválido");
    if ((payment.currency ?? "USD") !== "USD") {
      throw new BadRequestException("Los abonos de mesa deben registrarse en USD por ahora.");
    }
    const total = account.orders.reduce((sum, order) => sum + order.items.reduce(
      (lineSum, item) => lineSum + Number(item.unitPrice) * item.quantity, 0), 0);
    const paid = account.payments.reduce((sum, item) => sum + Number(item.amount), 0);
    if (amount > total - paid + 0.01) throw new BadRequestException("El abono supera el saldo pendiente");
    return this.prisma.floorTablePayment.create({
      data: {
        accountId, amount, method: payment.method, currency: "USD",
        notes: payment.notes?.trim() || null, recordedById: userId,
      },
    });
  }

  /**
   * Factura una cuenta completa. Los abonos quedan incorporados como líneas de
   * pago de la misma factura, por lo que no se crea una venta parcial paralela.
   */
  async closeTableAccount(
    organizationId: number,
    userId: number,
    accountId: number,
    dto: { payments?: { method: string; amount: number; currency: string }[]; notes?: string },
  ) {
    const activeStatuses = [
      FloorOrderStatus.SENT,
      FloorOrderStatus.IN_PREP,
      FloorOrderStatus.READY,
    ];
    const account = await this.prisma.floorTableAccount.findFirst({
      where: { id: accountId, organizationId, status: FloorTableAccountStatus.OPEN },
      include: {
        table: true,
        orders: { where: { status: { in: activeStatuses }, chargedInvoiceId: null }, include: { items: true } },
        payments: true,
      },
    });
    if (!account || !account.orders.length) {
      throw new BadRequestException("No hay comandas activas para cerrar en esta mesa");
    }
    const total = account.orders.reduce((sum, order) => sum + order.items.reduce(
      (lineSum, item) => lineSum + Number(item.unitPrice) * item.quantity, 0), 0);
    const savedPayments = account.payments.map((payment) => ({
      method: payment.method,
      amount: Number(payment.amount),
      currency: payment.currency,
    }));
    const payments = [...savedPayments, ...(dto.payments ?? [])];
    if (!payments.length) throw new BadRequestException("Indique los pagos para cerrar la mesa");
    if (payments.some((p) => p.currency !== "USD")) {
      throw new BadRequestException("El cierre de mesa actualmente requiere pagos expresados en USD.");
    }
    const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    if (Math.abs(paid - total) > 0.01) {
      throw new BadRequestException(
        `El total pagado (${paid.toFixed(2)}) debe coincidir con el saldo de la mesa (${total.toFixed(2)}).`,
      );
    }

    const claim = await this.prisma.floorTableAccount.updateMany({
      where: {
        id: account.id,
        status: FloorTableAccountStatus.OPEN,
        openKey: `${account.tableId}:OPEN`,
      },
      data: { openKey: `${account.id}:CLOSING` },
    });
    if (claim.count !== 1) {
      throw new BadRequestException("Esta mesa ya está siendo cobrada por otra persona.");
    }

    const orderIds = account.orders.map((order) => order.id);
    try {
      const claimedOrders = await this.prisma.floorOrder.updateMany({
        where: { id: { in: orderIds }, chargedInvoiceId: null, status: { in: activeStatuses } },
        data: { chargedInvoiceId: -1 },
      });
      if (claimedOrders.count !== orderIds.length) {
        throw new BadRequestException("Una comanda de esta mesa ya fue cobrada.");
      }
      const items = account.orders.flatMap((order) =>
        order.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      );
      const releaseReserved = account.orders.flatMap((order) =>
        order.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      );
      const invoice = await this.invoices.create(
        {
          customerId: account.customerId ?? undefined,
          items,
          payments: payments.map((payment) => ({
            method: payment.method as "CASH_USD" | "CASH_BS" | "PAGO_MOVIL" | "ZELLE" | "CARD" | "CREDIT",
            amount: Number(payment.amount),
            currency: "USD" as const,
          })),
          notes: dto.notes?.trim() || `Mesa ${account.table.label} · Cuenta #${account.id}`,
        },
        organizationId,
        userId,
        { releaseReserved },
      );
      await this.prisma.$transaction([
        this.prisma.floorOrder.updateMany({
          where: { id: { in: orderIds }, chargedInvoiceId: -1 },
          data: { status: FloorOrderStatus.CHARGED, chargedInvoiceId: invoice.id, chargedAt: new Date(), isOpen: false },
        }),
        this.prisma.floorTableAccount.update({
          where: { id: account.id },
          data: { status: FloorTableAccountStatus.CLOSED, openKey: null, closedInvoiceId: invoice.id, closedAt: new Date() },
        }),
      ]);
      for (const order of account.orders) this.emit(organizationId, "comanda:updated", { ...order, status: FloorOrderStatus.CHARGED, chargedInvoiceId: invoice.id });
      return { invoice, accountId: account.id, totalUsd: total };
    } catch (error) {
      await this.prisma.floorOrder.updateMany({
        where: { id: { in: orderIds }, chargedInvoiceId: -1 },
        data: { chargedInvoiceId: null },
      });
      await this.prisma.floorTableAccount.updateMany({
        where: { id: account.id, openKey: `${account.id}:CLOSING` },
        data: { openKey: `${account.tableId}:OPEN` },
      });
      throw error;
    }
  }

  async create(
    organizationId: number,
    userId: number,
    dto: CreateFloorOrderDto,
  ) {
    if (!dto.items?.length) {
      throw new BadRequestException("La comanda debe tener al menos un ítem");
    }
    if (dto.tableId) await this.assertTableAccountsEnabled(organizationId);

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

    // --- Resolución de cliente por cédula (cuenta abierta) ---
    let resolvedCustomerId = dto.customerId ?? null;
    let resolvedCustomerName = dto.customerName?.trim() || null;

    if (dto.paymentMode === "CUENTA_ABIERTA") {
      if (dto.customerTaxId) {
        // Buscar cliente por cédula
        const customer = await this.findCustomerByTaxId(
          organizationId,
          dto.customerTaxId,
        );
        if (!customer) {
          throw new BadRequestException(
            "Cliente no encontrado. Regístrelo primero con la cédula proporcionada.",
          );
        }
        resolvedCustomerId = customer.id;
        resolvedCustomerName = customer.name;
      } else if (resolvedCustomerId) {
        // Se proporcionó customerId directamente — buscar nombre del cliente
        const customer = await this.prisma.customer.findUnique({
          where: { id: resolvedCustomerId },
          select: { name: true },
        });
        if (customer) {
          resolvedCustomerName = customer.name;
        }
      } else {
        throw new BadRequestException(
          "Para cuenta abierta se requiere identificar al cliente (cédula o ID).",
        );
      }
    }

    let tableLabel = dto.tableLabel.trim();
    let tableAccountId: number | null = null;
    let tableId: number | null = null;
    if (dto.tableId) {
      const table = await this.prisma.floorTable.findFirst({
        where: { id: dto.tableId, organizationId, isActive: true },
      });
      if (!table) throw new NotFoundException("Mesa no encontrada o inactiva");
      tableId = table.id;
      tableLabel = table.label;
      let account = await this.prisma.floorTableAccount.findFirst({
        where: { tableId: table.id, status: FloorTableAccountStatus.OPEN },
      });
      if (!account) {
        account = await this.prisma.floorTableAccount.create({
          data: {
            organizationId,
            tableId: table.id,
            customerId: resolvedCustomerId,
            customerName: resolvedCustomerName,
            openedById: userId,
            openKey: `${table.id}:OPEN`,
          },
        });
      }
      tableAccountId = account.id;
    }

    const paymentMode = dto.tableId || dto.paymentMode === "CUENTA_ABIERTA"
      ? FloorPaymentMode.CUENTA_ABIERTA
      : FloorPaymentMode.INMEDIATO;

    const isOpen = !!dto.tableId || paymentMode === FloorPaymentMode.CUENTA_ABIERTA;

    const order = await this.prisma.floorOrder.create({
      data: {
        organizationId,
        tableLabel,
        zone: dto.zone?.trim() || "",
        customerName: resolvedCustomerName,
        customerId: resolvedCustomerId,
        notes: dto.notes?.trim() || null,
        createdById: userId,
        status: FloorOrderStatus.DRAFT,
        paymentMode,
        isOpen,
        tableId,
        tableAccountId,
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
    // Bloquear cobro individual de órdenes en cuenta abierta activa
    if (order.paymentMode === "CUENTA_ABIERTA" && order.isOpen) {
      throw new BadRequestException(
        "Esta orden pertenece a una cuenta abierta. Use el cobro masivo desde el POS.",
      );
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

  /**
   * Buscar cliente por cédula (taxId) en la organización.
   * Retorna null si no existe.
   */
  async findCustomerByTaxId(organizationId: number, taxId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        organizationId,
        taxId: taxId.trim(),
      },
      select: {
        id: true,
        name: true,
        taxId: true,
        phone: true,
        email: true,
      },
    });
    return customer || null;
  }

  /**
   * Registro rápido de cliente desde la comanda.
   * Crea un Customer con los datos proporcionados.
   */
  async quickRegisterCustomer(
    organizationId: number,
    dto: { taxId: string; phone: string; firstName: string; lastName: string },
  ) {
    // Verificar si ya existe un cliente con esta cédula en la organización
    const existing = await this.findCustomerByTaxId(organizationId, dto.taxId);
    if (existing) {
      return existing;
    }

    // Obtener companyId de la organización
    const companyId = await getCompanyIdFromOrganization(this.prisma, organizationId);

    const name = `${dto.firstName} ${dto.lastName}`.trim();

    return this.prisma.customer.create({
      data: {
        name,
        taxId: dto.taxId.trim(),
        phone: dto.phone.trim(),
        companyId,
        organizationId,
      },
      select: {
        id: true,
        name: true,
        taxId: true,
        phone: true,
      },
    });
  }

  /**
   * Cobra TODAS las órdenes abiertas de un cliente en una sola factura.
   * Usa optimistic locking (sentinel chargedInvoiceId = -1) para prevenir race conditions.
   *
   * Fase 1: Obtener órdenes elegibles (solo SENT/IN_PREP/READY que reservaron stock)
   * Fase 2: Reclamar órdenes atómicamente con updateMany condicional
   * Fase 3: Crear factura (maneja su propia transacción interna)
   * Fase 4: Finalizar órdenes con invoice ID real
   * Fase 5: Rollback si falla la factura
   */
  async chargeCustomerOpenTab(
    organizationId: number,
    userId: number,
    customerId: number,
    dto: { paymentMethod?: string; payments?: { method: string; amount: number; currency: string }[]; notes?: string },
  ) {
    // FASE 1: Obtener órdenes elegibles
    // Solo órdenes activas que reservaron stock: SENT, IN_PREP, READY
    // Excluye DRAFT (nunca reservaron stock), CHARGED y CANCELLED
    const activeStatuses = [
      FloorOrderStatus.SENT,
      FloorOrderStatus.IN_PREP,
      FloorOrderStatus.READY,
    ];

    const orders = await this.prisma.floorOrder.findMany({
      where: {
        organizationId,
        customerId,
        paymentMode: "CUENTA_ABIERTA",
        isOpen: true,
        status: { in: activeStatuses },
        chargedInvoiceId: null,
      },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    });

    if (!orders.length) {
      throw new BadRequestException("No hay órdenes abiertas para este cliente");
    }

    const orderIds = orders.map((o) => o.id);

    // FASE 2: Reclamar órdenes atómicamente con updateMany condicional
    // Si otra transacción ya las cobró (chargedInvoiceId != null), count será 0 y lanzamos error
    const claimed = await this.prisma.floorOrder.updateMany({
      where: {
        id: { in: orderIds },
        // Condiciones de seguridad: solo actualizar si siguen abiertas y sin cobrar
        isOpen: true,
        chargedInvoiceId: null,
        status: { in: activeStatuses },
      },
      data: {
        // Marcamos con chargedInvoiceId = -1 como centinela: "en proceso de cobro"
        chargedInvoiceId: -1,
      },
    });

    // Verificar que se reclamaron TODAS las órdenes
    if (claimed.count !== orders.length) {
      // Hacer rollback parcial: liberar las que sí se marcaron
      await this.prisma.floorOrder.updateMany({
        where: { id: { in: orderIds }, chargedInvoiceId: -1 },
        data: { chargedInvoiceId: null },
      });
      throw new BadRequestException(
        `Solo se pudieron reclamar ${claimed.count} de ${orders.length} órdenes. Otra persona puede estar cobrando esta cuenta.`,
      );
    }

    // FASE 3: Preparar datos para la factura
    const allItems: { productId: number; quantity: number }[] = [];
    const releaseReserved: { productId: number; quantity: number }[] = [];

    for (const order of orders) {
      for (const item of order.items) {
        allItems.push({ productId: item.productId, quantity: item.quantity });
        releaseReserved.push({ productId: item.productId, quantity: item.quantity });
      }
    }

    const orderIdsStr = orders.map((o) => `#${o.id}`).join(", ");
    const customerName = orders[0]?.customerName || `cliente #${customerId}`;
    const notes =
      dto.notes?.trim() ||
      `Cuenta abierta ${customerName} — Órdenes ${orderIdsStr}`;

    // FASE 4: Crear factura (maneja su propia transacción interna)
    let invoice;
    try {
      invoice = await this.invoices.create(
        {
          customerId,
          items: allItems,
          paymentMethod: dto.paymentMethod,
          payments: dto.payments?.map(p => ({
            method: p.method as "CASH_USD" | "CASH_BS" | "PAGO_MOVIL" | "ZELLE" | "CARD" | "CREDIT",
            amount: p.amount,
            currency: p.currency as "USD" | "VES",
          })),
          notes,
        },
        organizationId,
        userId,
        { releaseReserved },
      );
    } catch (error) {
      // Rollback: si falla la factura, revertir el reclamo (devolver chargedInvoiceId a null)
      await this.prisma.floorOrder.updateMany({
        where: { id: { in: orderIds }, chargedInvoiceId: -1 },
        data: { chargedInvoiceId: null },
      });
      throw error;
    }

    // FASE 5: Finalizar órdenes como cobradas con el invoice ID real
    await this.prisma.floorOrder.updateMany({
      where: { id: { in: orderIds }, chargedInvoiceId: -1 },
      data: {
        status: FloorOrderStatus.CHARGED,
        chargedInvoiceId: invoice.id,
        chargedAt: new Date(),
        isOpen: false,
      },
    });

    // FASE 6: Emitir eventos WebSocket para cada orden actualizada
    for (const order of orders) {
      this.emit(organizationId, "comanda:updated", {
        ...order,
        status: FloorOrderStatus.CHARGED,
        chargedInvoiceId: invoice.id,
        isOpen: false,
      });
    }

    // FASE 7: Retornar resultado
    const updatedOrders = await this.prisma.floorOrder.findMany({
      where: { id: { in: orderIds } },
      include: ORDER_INCLUDE,
    });

    return { orders: updatedOrders, invoice };
  }

  /**
   * Lista todos los clientes con cuentas abiertas activas, agrupados.
   * Retorna: [{ customerId, customerName, totalUsd, ordersCount, orders: [...] }]
   */
  async openTabs(organizationId: number) {
    const orders = await this.prisma.floorOrder.findMany({
      where: {
        organizationId,
        paymentMode: "CUENTA_ABIERTA",
        isOpen: true,
        status: { notIn: [FloorOrderStatus.CHARGED, FloorOrderStatus.CANCELLED] },
      },
      include: {
        items: {
          include: { product: { select: { id: true, name: true } } },
        },
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // Agrupar por customerId
    const grouped = new Map<number, {
      customerId: number;
      customerName: string;
      totalUsd: number;
      ordersCount: number;
      orders: typeof orders;
    }>();

    for (const order of orders) {
      const key = order.customerId ?? 0;
      const orderTotal = order.items.reduce(
        (sum, item) => sum + Number(item.unitPrice) * item.quantity,
        0,
      );

      if (!grouped.has(key)) {
        grouped.set(key, {
          customerId: order.customerId ?? 0,
          customerName: order.customerName || "Sin nombre",
          totalUsd: 0,
          ordersCount: 0,
          orders: [],
        });
      }

      const group = grouped.get(key)!;
      group.totalUsd += orderTotal;
      group.ordersCount += 1;
      group.orders.push(order);
    }

    return Array.from(grouped.values());
  }

  /**
   * Detalle de todas las órdenes abiertas de un cliente específico.
   */
  async customerOpenOrders(organizationId: number, customerId: number) {
    const orders = await this.prisma.floorOrder.findMany({
      where: {
        organizationId,
        customerId,
        paymentMode: "CUENTA_ABIERTA",
        isOpen: true,
        status: { notIn: [FloorOrderStatus.CHARGED, FloorOrderStatus.CANCELLED] },
      },
      include: {
        items: {
          include: { product: { select: { id: true, name: true } } },
        },
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const totalUsd = orders.reduce((sum, order) => {
      const orderTotal = order.items.reduce(
        (itemSum, item) => itemSum + Number(item.unitPrice) * item.quantity,
        0,
      );
      return sum + orderTotal;
    }, 0);

    return {
      customerId,
      totalUsd,
      ordersCount: orders.length,
      orders,
    };
  }
}
