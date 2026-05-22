import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ActivityLogService } from '@/modules/activity-log/activity-log.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { getCompanyIdFromOrganization } from '@/common/helpers/organization.helper';
import { v4 as uuidv4 } from 'uuid';
import * as PDFKit from 'pdfkit';
import { CreditsService } from '@/modules/credits/credits.service';

const PDFDocument = (PDFKit as any).default ?? PDFKit;
import { TasksService } from '@/modules/tasks/tasks.service';
import { TaskPriority, Product, PaymentStatus } from '@prisma/client';

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private creditsService: CreditsService,
    private tasksService: TasksService,
    private activityLog: ActivityLogService,
  ) {}

  async create(createInvoiceDto: CreateInvoiceDto, organizationId: number, sellerId: number) {
    const { items, customerId, notes, paymentMethod: paymentMethodDto, payments: paymentsDto } =
      createInvoiceDto;
    const useHybridPayments = Array.isArray(paymentsDto) && paymentsDto.length > 0;
    const isCredit =
      paymentMethodDto?.toUpperCase() === 'CREDIT' ||
      (useHybridPayments && paymentsDto!.some((p) => p.method === 'CREDIT'));

    if (!items || items.length === 0) {
      throw new BadRequestException('La factura debe tener al menos un producto');
    }
    if (isCredit && !customerId) {
      throw new BadRequestException('Para venta a crédito debe seleccionar un cliente');
    }

    const companyId = await getCompanyIdFromOrganization(this.prisma, organizationId);

    // Obtener tasa y registrar TasaHistorica fuera de una transacción interactiva
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { exchangeRate: true },
    });
    const rate = Number(org?.exchangeRate ?? 1);
    const tasa = await this.prisma.tasaHistorica.create({
      data: {
        organizationId,
        rate,
        source: 'BCV',
        effectiveAt: new Date(),
      },
    });

    const lineProductIds = items.map((item) => item.productId);
    const firstProducts = await this.prisma.product.findMany({
      where: { id: { in: lineProductIds }, organizationId },
    });
    const allIdSet = new Set<number>(lineProductIds);
    for (const p of firstProducts) {
      const comps = p.bundleComponents as unknown;
      if (Array.isArray(comps)) {
        for (const c of comps as { productId?: number }[]) {
          if (c?.productId == null) continue;
          if (p.isBundle) {
            allIdSet.add(c.productId);
          } else if (p.isService) {
            allIdSet.add(c.productId);
          }
        }
      }
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: [...allIdSet] }, organizationId },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    if (products.length !== allIdSet.size) {
      throw new NotFoundException('Uno o más productos no fueron encontrados');
    }

    let totalAmount = 0;
    const invoiceItemsData: {
      productId: number;
      quantity: number;
      unitPrice: number;
      subtotal: number;
    }[] = [];
    const stockUpdates: ReturnType<PrismaService['product']['update']>[] = [];

    for (const item of items) {
      const product = productById.get(item.productId);
      if (!product) {
        throw new NotFoundException(`Producto con ID ${item.productId} no encontrado`);
      }

      const unitPrice = Number(product.salePrice);
      const subtotal = unitPrice * item.quantity;
      totalAmount += subtotal;

      invoiceItemsData.push({
        productId: product.id,
        quantity: item.quantity,
        unitPrice,
        subtotal,
      });

      const compsUnknown = product.bundleComponents as unknown;
      const compsList =
        Array.isArray(compsUnknown) && compsUnknown.length > 0
          ? (compsUnknown as { productId: number; quantity: number }[])
          : null;

      if (product.isBundle) {
        if (!compsList) {
          throw new BadRequestException(`El combo "${product.name}" no tiene componentes configurados`);
        }
        this.applyInvoiceBundleComponents(
          compsList,
          item.quantity,
          product.name,
          'combo',
          productById,
          stockUpdates,
        );
      } else if (product.isService) {
        if (compsList) {
          this.applyInvoiceBundleComponents(
            compsList,
            item.quantity,
            product.name,
            'servicio',
            productById,
            stockUpdates,
          );
        }
      } else {
        if (product.stock < item.quantity) {
          throw new BadRequestException(
            `Stock insuficiente para ${product.name}. Disponible: ${product.stock}, Solicitado: ${item.quantity}`,
          );
        }
        stockUpdates.push(
          this.prisma.product.update({
            where: { id: product.id },
            data: { stock: { decrement: item.quantity } },
          }),
        );
      }
    }

    if (isCredit) {
      const credit = await this.creditsService.getOrCreateCredit(customerId!, organizationId);
      const available = Number(credit.limitAmount) - Number(credit.currentBalance);
      if (credit.status !== 'ACTIVE') {
        throw new BadRequestException('El crédito del cliente está suspendido');
      }
      if (available < totalAmount) {
        throw new BadRequestException(
          `Límite de crédito insuficiente. Disponible: $${available.toFixed(
            2,
          )}, Total: $${totalAmount.toFixed(2)}`,
        );
      }
    }

    let paymentMethod: string;
    let montoUsd: number;
    let montoBs: number;
    const tasaReferencia = rate;
    const paymentLinesData: { method: string; amount: number; currency: string }[] = [];

    if (useHybridPayments && paymentsDto!.length > 0) {
      let sumUsd = 0;
      let sumBs = 0;
      for (const p of paymentsDto!) {
        if (p.currency === 'USD') {
          sumUsd += p.amount;
        } else {
          sumBs += p.amount;
        }
        paymentLinesData.push({
          method: p.method,
          amount: p.amount,
          currency: p.currency,
        });
      }
      const totalInUsd = sumUsd + sumBs / rate;
      if (Math.abs(totalInUsd - totalAmount) > 0.02) {
        throw new BadRequestException(
          `La suma de los pagos ($${totalInUsd.toFixed(
            2,
          )} USD eq.) no coincide con el total de la factura ($${totalAmount.toFixed(2)}).`,
        );
      }
      montoUsd = sumUsd;
      montoBs = sumBs;
      paymentMethod = paymentLinesData.length === 1 ? paymentLinesData[0].method : 'MIXED';
    } else {
      paymentMethod = isCredit
        ? 'CREDIT'
        : paymentMethodDto &&
            ['CASH', 'ZELLE', 'CARD', 'CREDIT'].includes(String(paymentMethodDto).toUpperCase())
          ? String(paymentMethodDto).toUpperCase()
          : 'CASH';
      montoUsd = totalAmount;
      montoBs = 0;
      paymentLinesData.push({
        method:
          paymentMethod === 'CASH'
            ? 'CASH_USD'
            : paymentMethod === 'ZELLE'
              ? 'ZELLE'
              : paymentMethod === 'CARD'
                ? 'CARD'
                : 'CREDIT',
        amount: totalAmount,
        currency: 'USD',
      });
    }

    const paymentStatus = isCredit ? PaymentStatus.pending_credit : PaymentStatus.paid;

    // Número consecutivo por organización (cada rancho/empresa tiene su propia secuencia 1, 2, 3...)
    const nextConsecutive =
      (await this.prisma.invoice.count({ where: { organizationId } })) + 1;

    const mapToMetodo = (method: string): string => {
      const m = method.toUpperCase();
      if (m === 'CASH_USD' || m === 'CASH_BS') return 'EFECTIVO';
      if (m === 'PAGO_MOVIL') return 'PAGO_MOVIL';
      if (m === 'ZELLE') return 'ZELLE';
      if (m === 'CARD' || m === 'CREDIT') return 'PUNTO';
      return 'EFECTIVO';
    };

    // Ejecutamos actualización de stock e inserción de factura en una sola transacción "batch"
    // El array devuelve [resultadoUpdate1, ..., resultadoUpdateN, facturaCreada]; la factura es el último elemento
    const results = await this.prisma.$transaction([
      ...stockUpdates,
      this.prisma.invoice.create({
        data: {
          companyId,
          organizationId,
          customerId: customerId || null,
          sellerId,
          totalAmount,
          status: 'PAID',
          paymentMethod,
          paymentStatus,
          montoUsd,
          montoBs,
          tasaReferencia,
          notes: notes || null,
          publicToken: uuidv4(),
          tasaHistoricaId: tasa.id,
          consecutiveNumber: nextConsecutive,
          items: { create: invoiceItemsData },
          paymentLines: {
            create: paymentLinesData.map((p) => ({
              method: p.method as any,
              amount: p.amount,
              currency: p.currency as any,
            })),
          },
          pagos: {
            create: paymentLinesData.map((p) => ({
              moneda: p.currency,
              metodo: mapToMetodo(p.method),
              monto: p.amount,
              tasaCambio: tasaReferencia,
              tenantId: organizationId,
            })),
          },
        },
        include: {
          items: { include: { product: true } },
          customer: true,
          paymentLines: true,
          pagos: true,
        },
      }),
    ]);
    const invoice = results[results.length - 1] as {
      id: number;
      totalAmount: unknown;
      customer: { name?: string | null } | null;
    };

    if (isCredit && customerId && invoice) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { exchangeRate: true },
      });
      const exchangeRate = Number(org?.exchangeRate ?? 1);
      const amountBs = Number(invoice.totalAmount) * exchangeRate;

      await this.creditsService.chargeForInvoice(
        customerId,
        organizationId,
        invoice.id,
        Number(invoice.totalAmount),
        amountBs,
        exchangeRate,
      );

      const credit = await this.creditsService.getOrCreateCredit(customerId, organizationId);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (credit.creditDueDays ?? 30));
      const customerName = invoice.customer?.name ?? 'Cliente';

      await this.tasksService.create(
        {
          title: `Cobro: Factura #${nextConsecutive} - ${customerName}`,
          description: `Monto adeudado: $${Number(invoice.totalAmount).toFixed(2)}. Factura a crédito.`,
          assignedToId: sellerId,
          invoiceId: invoice.id,
          priority: TaskPriority.HIGH,
          category: 'COBRANZA',
          dueDate: dueDate.toISOString(),
        },
        organizationId,
        sellerId,
      );
    }

    return this.prisma.invoice.findUnique({
      where: { id: invoice.id },
      include: {
        items: { include: { product: true } },
        customer: true,
        paymentLines: true,
      },
    })!;
  }

  /**
   * Descuenta inventario de los productos hijos (misma lógica para combo y servicio con «receta»).
   */
  private applyInvoiceBundleComponents(
    comps: { productId: number; quantity: number }[],
    lineQty: number,
    parentName: string,
    kind: 'combo' | 'servicio',
    productById: Map<number, Product>,
    stockUpdates: ReturnType<PrismaService['product']['update']>[],
  ) {
    for (const comp of comps) {
      const child = productById.get(comp.productId);
      if (!child) {
        throw new NotFoundException(
          kind === 'combo'
            ? `Componente de combo no encontrado: producto ${comp.productId}`
            : `Producto incluido en el servicio no encontrado: ${comp.productId}`,
        );
      }
      const need = lineQty * (comp.quantity ?? 1);
      if (child.stock < need) {
        throw new BadRequestException(
          `Stock insuficiente para "${child.name}" (${kind === 'combo' ? 'componente del combo' : 'incluido en el servicio'}) "${parentName}". Disponible: ${child.stock}, requerido: ${need}`,
        );
      }
      stockUpdates.push(
        this.prisma.product.update({
          where: { id: child.id },
          data: { stock: { decrement: need } },
        }),
      );
    }
  }

  async findAll(organizationId: number) {
    return this.prisma.invoice.findMany({
      where: {
        organizationId,
      },
      include: {
        items: { include: { product: true } },
        customer: true,
        paymentLines: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Historial de facturas por rango de fechas: resumen diario y lista detallada.
   * Un usuario solo puede consultar la organización activa (x-tenant-id); un superadmin puede pasar companyId/organizationId para otra org.
   * Consulta optimizada con índice (organizationId, createdAt).
   */
  async getHistory(
    activeOrganizationId: number,
    userId: number,
    startDate: string,
    endDate: string,
    requestedOrganizationId?: number,
  ) {
    const orgId = await this.resolveHistoryOrganizationId(
      activeOrganizationId,
      userId,
      requestedOrganizationId,
    );

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException('startDate no puede ser posterior a endDate');
    }
    const startOfRange = new Date(start);
    startOfRange.setUTCHours(0, 0, 0, 0);
    const endOfRange = new Date(end);
    endOfRange.setUTCHours(23, 59, 59, 999);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        createdAt: {
          gte: startOfRange,
          lte: endOfRange,
        },
      },
      include: {
        items: { include: { product: true } },
        customer: true,
        paymentLines: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const dailySummary = this.buildDailySummary(invoices);
    return {
      organizationId: orgId,
      startDate: startOfRange.toISOString(),
      endDate: endOfRange.toISOString(),
      dailySummary,
      invoices,
    };
  }

  /**
   * Determina la organización a consultar: la activa o la solicitada si el usuario es superadmin.
   */
  private async resolveHistoryOrganizationId(
    activeOrganizationId: number,
    userId: number,
    requestedOrganizationId?: number,
  ): Promise<number> {
    if (requestedOrganizationId == null || requestedOrganizationId === activeOrganizationId) {
      return activeOrganizationId;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException(
        'Solo puedes consultar el historial de la organización activa (x-tenant-id)',
      );
    }
    const org = await this.prisma.organization.findUnique({
      where: { id: requestedOrganizationId },
      select: { id: true },
    });
    if (!org) {
      throw new NotFoundException(
        `Organización con ID ${requestedOrganizationId} no encontrada`,
      );
    }
    return requestedOrganizationId;
  }

  /**
   * Agrupa facturas por día: total ventas y total por método de pago.
   * Sin IVA/IGTF: solo cobro real (multimoneda).
   */
  private buildDailySummary(
    invoices: Array<{
      totalAmount: unknown;
      paymentMethod: string;
      paymentLines?: Array<{ method: string; amount: unknown; currency: string }>;
      createdAt: Date;
    }>,
  ): Array<{
    date: string;
    totalSales: number;
    byPaymentMethod: Record<string, number>;
  }> {
    const byDate = new Map<string, { totalSales: number; byPaymentMethod: Record<string, number> }>();

    for (const inv of invoices) {
      const total = this.toNum(inv.totalAmount);
      const dateKey = new Date(inv.createdAt).toISOString().slice(0, 10);
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, { totalSales: 0, byPaymentMethod: {} });
      }
      const day = byDate.get(dateKey)!;
      day.totalSales += total;
      if (inv.paymentLines && inv.paymentLines.length > 0) {
        for (const line of inv.paymentLines) {
          const key = `${line.method}_${line.currency}`;
          day.byPaymentMethod[key] = (day.byPaymentMethod[key] ?? 0) + this.toNum(line.amount);
        }
      } else {
        const method = (inv.paymentMethod || 'CASH').toUpperCase();
        day.byPaymentMethod[method] = (day.byPaymentMethod[method] ?? 0) + total;
      }
    }

    return Array.from(byDate.entries())
      .map(([date, data]) => ({
        date,
        totalSales: Math.round(data.totalSales * 100) / 100,
        byPaymentMethod: data.byPaymentMethod,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Obtiene facturas marcadas como pagadas por clientes (para notificaciones)
   */
  async getClientMarkedAsPaid(organizationId: number, limit: number = 10) {
    return this.prisma.invoice.findMany({
      where: {
        organizationId,
        markedAsPaidByClient: true,
      },
      include: {
        customer: true,
        company: true,
      },
      orderBy: {
        markedAsPaidAt: 'desc',
      },
      take: limit,
    });
  }

  /**
   * Borra todo el historial de ventas/facturación de la organización actual.
   * Solo super_admin. Para dejar el sistema en cero durante el desarrollo.
   */
  async clearTestData(organizationId: number, userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException(
        'Solo el Super Admin puede borrar el historial de ventas',
      );
    }

    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId },
      select: { id: true },
    });
    const invoiceIds = invoices.map((i) => i.id);
    if (invoiceIds.length === 0) {
      return { message: 'No hay facturas para eliminar', deleted: 0 };
    }

    await this.prisma.$transaction([
      this.prisma.task.updateMany({
        where: { invoiceId: { in: invoiceIds } },
        data: { invoiceId: null },
      }),
      this.prisma.invoiceItem.deleteMany({
        where: { invoiceId: { in: invoiceIds } },
      }),
      this.prisma.invoice.deleteMany({ where: { organizationId } }),
    ]);

    return {
      message: 'Historial de ventas/facturación eliminado correctamente',
      deleted: invoiceIds.length,
    };
  }

  /**
   * Elimina una factura. Solo permitido para super_admin.
   */
  async remove(id: number, organizationId: number, userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Solo el Super Admin puede eliminar facturas');
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      include: { customer: { select: { name: true } } },
    });
    if (!invoice) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`);
    }

    await this.activityLog.log({
      organizationId,
      userId,
      action: 'INVOICE_DELETED',
      entityType: 'invoice',
      entityId: String(id),
      newValue: {
        totalAmount: Number(invoice.totalAmount),
        paymentMethod: invoice.paymentMethod,
        status: invoice.status,
      },
      summary: `Factura #${(invoice as { consecutiveNumber?: number }).consecutiveNumber ?? id} eliminada. Total: $${Number(invoice.totalAmount).toFixed(2)}. Cliente: ${(invoice.customer as { name?: string })?.name ?? 'N/A'}.`,
    });

    await this.prisma.$transaction([
      this.prisma.task.updateMany({
        where: { invoiceId: id },
        data: { invoiceId: null },
      }),
      this.prisma.invoiceItem.deleteMany({ where: { invoiceId: id } }),
      this.prisma.invoice.delete({ where: { id } }),
    ]);

    return { message: 'Factura eliminada correctamente' };
  }

  async findOne(id: number, organizationId: number) {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id,
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
      },
      select: {
        id: true,
        companyId: true,
        organizationId: true,
        customerId: true,
        sellerId: true,
        totalAmount: true,
        status: true,
        paymentMethod: true,
        montoUsd: true,
        montoBs: true,
        tasaReferencia: true,
        notes: true,
        pdfUrl: true,
        publicToken: true,
        createdAt: true,
        items: { include: { product: true } },
        customer: true,
        company: true,
        seller: true,
        paymentLines: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`);
    }

    return invoice;
  }

  /**
   * Obtiene una factura por su token público (sin autenticación)
   * Incrementa el contador de vistas automáticamente
   */
  async findByPublicToken(token: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: {
        publicToken: token,
      },
      select: {
        id: true,
        companyId: true,
        organizationId: true,
        customerId: true,
        sellerId: true,
        totalAmount: true,
        status: true,
        paymentMethod: true,
        montoUsd: true,
        montoBs: true,
        tasaReferencia: true,
        notes: true,
        pdfUrl: true,
        publicToken: true,
        markedAsPaidByClient: true,
        markedAsPaidAt: true,
        markedAsPaidBy: true,
        viewCount: true,
        lastViewedAt: true,
        createdAt: true,
        items: { include: { product: true } },
        customer: true,
        company: true,
        paymentLines: true,
        organization: {
          select: { id: true, nombre: true, slug: true, plan: true },
        },
        seller: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Factura no encontrada o enlace inválido');
    }

    // Incrementar contador de vistas de forma asíncrona (no bloquea la respuesta)
    this.incrementViewCount(invoice.id).catch((err) => {
      console.error('Error al incrementar contador de vistas:', err);
    });

    return invoice;
  }

  /**
   * Incrementa el contador de vistas de una factura
   */
  private async incrementViewCount(invoiceId: number) {
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        viewCount: {
          increment: 1,
        },
        lastViewedAt: new Date(),
      },
    });
  }

  /**
   * Marca una factura como pagada desde el link público
   * @param token Token público de la factura
   * @param markedBy Nombre/email de quien marca como pagada (opcional)
   */
  async markAsPaidByClient(token: string, markedBy?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { publicToken: token },
      include: {
        organization: true,
        seller: true,
        customer: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Factura no encontrada o enlace inválido');
    }

    if (invoice.markedAsPaidByClient) {
      throw new BadRequestException('Esta factura ya fue marcada como pagada');
    }

    // Actualizar la factura
    const updatedInvoice = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        markedAsPaidByClient: true,
        markedAsPaidAt: new Date(),
        markedAsPaidBy: markedBy || invoice.customer?.name || 'Cliente',
        status: 'PAID', // También actualizar el status general
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        customer: true,
        company: true,
        organization: true,
        seller: true,
      },
    });

    // Aquí podrías agregar lógica para enviar notificaciones
    // Por ejemplo: enviar email al vendedor, crear notificación en el sistema, etc.

    return updatedInvoice;
  }

  /** Convierte Prisma Decimal o cualquier valor a number de forma segura. */
  private toNum(v: unknown): number {
    if (v == null) return 0;
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'object' && typeof (v as any).toNumber === 'function') return (v as any).toNumber();
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Genera el PDF de la factura en memoria (Buffer). Usa PDFKit - sin Puppeteer/Chromium.
   * Compatible con AWS: no escribe archivos en disco, solo fuentes estándar (Helvetica).
   * Usa moneda y tasa de la organización del tenant.
   */
  async generatePDF(id: number, organizationId: number): Promise<Buffer> {
    const invoice = await this.findOne(id, organizationId);
    const orgId = invoice.organizationId ?? organizationId;
    let org: { nombre: string; exchangeRate: unknown; currencyCode: string | null; currencySymbol: string | null } | null = null;
    if (orgId != null && typeof orgId === 'number') {
      org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { nombre: true, exchangeRate: true, currencyCode: true, currencySymbol: true },
      });
    }
    const currencySymbol = org?.currencySymbol ?? '$';
    const currencyCode = org?.currencyCode ?? 'USD';
    const exchangeRate = this.toNum(org?.exchangeRate ?? 1);
    const orgName = org?.nombre ?? (invoice.company as any)?.name ?? 'Organización';

    const formatMoney = (value: number) => `${currencySymbol} ${value.toFixed(2)}`;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => {
        try {
          resolve(Buffer.concat(buffers));
        } catch (e) {
          reject(e);
        }
      });
      doc.on('error', (err) => {
        try {
          (doc as any).destroy?.();
        } catch (_) {}
        reject(err);
      });

      try {
        doc.font('Helvetica');
        const primary = '#1e40af';
        const text = '#1f2937';
        const border = '#e5e7eb';

        const company = invoice.company as { name?: string; taxId?: string; address?: string } | null;
        doc.fontSize(20).fillColor(primary).text('disis', 50, 50);
        doc.fontSize(10).fillColor(text).text(String(orgName ?? '').slice(0, 80), 50, 72);
        if (company?.taxId) doc.text(`RIF: ${String(company.taxId).slice(0, 30)}`, 50, 85);
        if (company?.address) doc.text(String(company.address).slice(0, 80), 50, 98);

        // Documento de venta (derecha) — alineado con ticket térmico "venta"
        doc.fontSize(16).fillColor(primary).text('VENTA', 350, 50, { align: 'right' });
        let dateStr = '';
        try {
          dateStr = new Date(invoice.createdAt).toLocaleDateString('es-VE', { year: 'numeric', month: 'long', day: 'numeric' });
        } catch {
          dateStr = new Date(invoice.createdAt).toISOString().slice(0, 10);
        }
        const displayNumber = (invoice as { consecutiveNumber?: number }).consecutiveNumber ?? invoice.id;
        doc.fontSize(10).fillColor(text)
          .text(`#${displayNumber}`, 500, 72, { align: 'right' })
          .text(dateStr, 500, 85, { align: 'right' });

        // Separador
        const sepY = 115;
        doc.moveTo(50, sepY).lineTo(550, sepY).strokeColor(border).lineWidth(1).stroke();

        // Cliente
        const clientY = sepY + 15;
        doc.fontSize(11).fillColor(primary).text('CLIENTE', 50, clientY);
        const customerName = invoice.customer?.name ?? 'Cliente General';
        const customerDoc = invoice.customer?.taxId ?? 'N/A';
        doc.fontSize(10).fillColor(text)
          .text(`Nombre: ${customerName}`, 50, clientY + 14)
          .text(`Documento: ${customerDoc}`, 50, clientY + 28);

        // Tabla: Código | Descripción | Cant. | P. Unit. | Total
        const tableTop = clientY + 55;
        let y = tableTop;
        doc.fontSize(9).fillColor(primary);
        doc.text('Código', 50, y, { width: 55 });
        doc.text('Descripción', 108, y, { width: 200 });
        doc.text('Cant.', 310, y, { width: 45, align: 'right' });
        doc.text('P. Unit.', 358, y, { width: 75, align: 'right' });
        doc.text('Total', 436, y, { width: 115, align: 'right' });
        y += 12;
        doc.moveTo(50, y).lineTo(550, y).strokeColor(border).stroke();
        y += 10;

        const items = Array.isArray(invoice.items) ? invoice.items : [];
        for (const item of items) {
          if (y > 700) {
            doc.addPage();
            y = 50;
            doc.font('Helvetica').fontSize(9).fillColor(text);
          }
          const product = item.product as { sku?: string; barcode?: string; id?: number; name?: string } | null;
          const codigo = product?.sku ?? product?.barcode ?? String(product?.id ?? '');
          const desc = String(product?.name ?? 'Producto').slice(0, 50);
          doc.text((codigo || '-').slice(0, 12), 50, y, { width: 55 });
          doc.text(desc, 108, y, { width: 200 });
          doc.text(String(Number(item.quantity) || 0), 310, y, { width: 45, align: 'right' });
          doc.text(formatMoney(this.toNum(item.unitPrice)), 358, y, { width: 75, align: 'right' });
          doc.text(formatMoney(this.toNum(item.subtotal)), 436, y, { width: 115, align: 'right' });
          y += 22;
        }

        y += 5;
        doc.moveTo(50, y).lineTo(550, y).strokeColor(border).stroke();
        y += 18;

        const subtotalVal = this.toNum(invoice.totalAmount);
        const taxVal = 0;
        const totalVal = subtotalVal + taxVal;
        const tx = 350;

        doc.fontSize(10).fillColor(text);
        doc.text('Subtotal:', tx, y, { width: 90, align: 'right' }).text(formatMoney(subtotalVal), 440, y, { width: 110, align: 'right' });
        y += 14;
        doc.text('Impuestos:', tx, y, { width: 90, align: 'right' }).text(formatMoney(taxVal), 440, y, { width: 110, align: 'right' });
        y += 20;
        doc.moveTo(tx, y).lineTo(550, y).strokeColor(primary).lineWidth(1.5).stroke();
        y += 10;
        doc.fontSize(12).font('Helvetica-Bold').fillColor(primary);
        doc.text('TOTAL:', tx, y, { width: 90, align: 'right' }).text(formatMoney(totalVal), 440, y, { width: 110, align: 'right' });

        // Pie
        const footerY = 750;
        doc.font('Helvetica').fontSize(9).fillColor(text).text('Gracias por su compra', 50, footerY, { align: 'center', width: 500 });
        let footer = '';
        try {
          footer = `Generado ${new Date().toLocaleDateString('es-VE', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
        } catch {
          footer = `Generado ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
        }
        if (currencyCode === 'USD' && exchangeRate !== 1) footer += ` · 1 USD = ${exchangeRate.toFixed(2)} Bs.`;
        doc.fontSize(8).fillColor('#9ca3af').text(footer, 50, footerY + 12, { align: 'center', width: 500 });

        doc.end();
      } catch (err) {
        try {
          (doc as any).destroy?.();
        } catch (_) {}
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
