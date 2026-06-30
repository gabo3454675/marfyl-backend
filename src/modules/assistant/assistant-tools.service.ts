import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AuthService } from "@/modules/auth/auth.service";
import { InvoicesService } from "@/modules/invoices/invoices.service";
import { DashboardService } from "@/modules/dashboard/dashboard.service";
import { ProductsService } from "@/modules/products/products.service";
import { ConcertService } from "@/modules/concert/concert.service";
import { FiscalCalendarService } from "@/modules/fiscal/fiscal-calendar.service";
import { FiscalService } from "@/modules/fiscal/fiscal.service";
import { ExpensesService } from "@/modules/expenses/expenses.service";
import { CierreCajaService } from "@/modules/cierre-caja/cierre-caja.service";
import { InventoryMovementsService } from "@/modules/inventory/inventory-movements.service";
import { CustomersService } from "@/modules/customers/customers.service";
import { FiscalKnowledgeService } from "@/modules/fiscal-knowledge/fiscal-knowledge.service";
import { AssistantSecurityService } from "./assistant-security.service";
import { TenantContext } from "@/common/context/tenant.context";

export interface AssistantSwitchPayload {
  access_token: string;
  organizationId: number;
  organizationName: string;
}

export interface AssistantToolContext {
  organizationId: number;
  userId: number;
  orgName?: string;
  pendingSwitch?: AssistantSwitchPayload;
}

export interface AssistantToolResult {
  toolName: string;
  result: unknown;
  error?: string;
}

type ToolHandler = (
  args: Record<string, unknown>,
  ctx: AssistantToolContext,
) => Promise<unknown>;

const OUTFLOW_TYPES = [
  "AUTOCONSUMO",
  "MERMA_VENCIDO",
  "MERMA_DANADO",
  "USO_TALLER",
] as const;

@Injectable()
export class AssistantToolsService {
  private readonly logger = new Logger(AssistantToolsService.name);
  private readonly handlers = new Map<string, ToolHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly security: AssistantSecurityService,
    private readonly auth: AuthService,
    private readonly invoices: InvoicesService,
    private readonly dashboard: DashboardService,
    private readonly products: ProductsService,
    private readonly concert: ConcertService,
    private readonly fiscalCalendar: FiscalCalendarService,
    private readonly fiscal: FiscalService,
    private readonly expenses: ExpensesService,
    private readonly cierreCaja: CierreCajaService,
    private readonly inventoryMovements: InventoryMovementsService,
    private readonly customers: CustomersService,
    private readonly fiscalKnowledge: FiscalKnowledgeService,
  ) {
    this.registerHandlers();
  }

  getRegisteredToolNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ): Promise<AssistantToolResult> {
    const handler = this.handlers.get(toolName);
    if (!handler) {
      return {
        toolName,
        result: null,
        error: `Función '${toolName}' no disponible`,
      };
    }
    try {
      const result = await handler(args, ctx);
      return { toolName, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Tool ${toolName} failed: ${message}`);
      return { toolName, result: null, error: message };
    }
  }

  private async guardOrg(ctx: AssistantToolContext): Promise<void> {
    await this.security.assertMembership(ctx.userId, ctx.organizationId);
  }

  private registerHandlers() {
    this.handlers.set("list_my_organizations", (_args, ctx) =>
      this.listMyOrganizations(ctx),
    );
    this.handlers.set("switch_organization", (args, ctx) =>
      this.switchOrganization(args, ctx),
    );
    this.handlers.set("query_invoices_across_my_orgs", (_args, ctx) =>
      this.queryInvoicesAcrossMyOrgs(ctx),
    );
    this.handlers.set("search_invoices", (args, ctx) =>
      this.searchInvoices(args, ctx),
    );
    this.handlers.set("get_invoice_detail", (args, ctx) =>
      this.getInvoiceDetail(args, ctx),
    );
    this.handlers.set("modify_invoice_amount", (args, ctx) =>
      this.modifyInvoiceAmount(args, ctx),
    );
    this.handlers.set("annul_invoice", (args, ctx) =>
      this.annulInvoice(args, ctx),
    );
    this.handlers.set("check_inventory_stock", (args, ctx) =>
      this.checkInventoryStock(args, ctx),
    );
    this.handlers.set("update_product", (args, ctx) =>
      this.updateProduct(args, ctx),
    );
    this.handlers.set("register_inventory_outflow", (args, ctx) =>
      this.registerInventoryOutflow(args, ctx),
    );
    this.handlers.set("create_customer", (args, ctx) =>
      this.createCustomer(args, ctx),
    );
    this.handlers.set("search_customers", (args, ctx) =>
      this.searchCustomers(args, ctx),
    );
    this.handlers.set("get_organization_status", (_args, ctx) =>
      this.getOrganizationStatus(ctx),
    );
    this.handlers.set("get_fiscal_calendar", (args, ctx) =>
      this.getFiscalCalendar(args, ctx),
    );
    this.handlers.set("get_libro_ventas", (args, ctx) =>
      this.getLibroVentas(args, ctx),
    );
    this.handlers.set("get_libro_compras", (args, ctx) =>
      this.getLibroCompras(args, ctx),
    );
    this.handlers.set("get_fiscal_retenciones", (args, ctx) =>
      this.getFiscalRetenciones(args, ctx),
    );
    this.handlers.set("get_accounts_payable", (_args, ctx) =>
      this.getAccountsPayable(ctx),
    );
    this.handlers.set("get_cash_register_status", (_args, ctx) =>
      this.getCashRegisterStatus(ctx),
    );
    this.handlers.set("search_event_ticket", (args, ctx) =>
      this.searchEventTicket(args, ctx),
    );
    this.handlers.set("manual_qr_checkin", (args, ctx) =>
      this.manualQrCheckin(args, ctx),
    );
    this.handlers.set("search_concert_orders", (args, ctx) =>
      this.searchEventTicket(args, ctx),
    );
    this.handlers.set("search_fiscal_law", (args) =>
      this.searchFiscalLaw(args),
    );
    this.handlers.set("brave_search", (args) =>
      this.searchFiscalLaw(this.normalizeBraveSearchArgs(args)),
    );
  }

  private normalizeBraveSearchArgs(
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    const query = String(
      args.query ?? args.q ?? args.search_query ?? args.searchQuery ?? "",
    ).trim();
    return { ...args, query };
  }

  private async listMyOrganizations(ctx: AssistantToolContext) {
    const orgs = await this.security.listUserOrganizations(ctx.userId);
    return {
      activeOrganizationId: ctx.organizationId,
      activeOrganizationName: ctx.orgName,
      organizations: orgs,
    };
  }

  private async switchOrganization(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    const ref = String(args.organizationRef ?? args.tenantName ?? "").trim();
    const target = await this.security.resolveOrganizationForUser(
      ctx.userId,
      ref,
    );
    const switched = await this.auth.switchOrganization(ctx.userId, target.id);

    ctx.organizationId = target.id;
    ctx.orgName = target.nombre;
    ctx.pendingSwitch = {
      access_token: switched.access_token,
      organizationId: target.id,
      organizationName: target.nombre,
    };

    return {
      message: `Empresa activa cambiada a "${target.nombre}"`,
      organizationId: target.id,
      organizationName: target.nombre,
      slug: target.slug,
    };
  }

  private async queryInvoicesAcrossMyOrgs(ctx: AssistantToolContext) {
    const orgs = await this.security.listUserOrganizations(ctx.userId);
    const stats = await Promise.all(
      orgs.map(async (org) => {
        const [total, pending, paid] = await TenantContext.run(org.id, () =>
          Promise.all([
            this.prisma.invoice.count({ where: { organizationId: org.id } }),
            this.prisma.invoice.count({
              where: { organizationId: org.id, status: "PENDING" },
            }),
            this.prisma.invoice.count({
              where: { organizationId: org.id, status: "PAID" },
            }),
          ]),
        );
        return {
          organizationId: org.id,
          name: org.nombre,
          slug: org.slug,
          totalInvoices: total,
          pendingInvoices: pending,
          paidInvoices: paid,
          isActive: org.id === ctx.organizationId,
        };
      }),
    );
    return {
      activeOrganizationId: ctx.organizationId,
      organizations: stats.filter((s) => s.totalInvoices > 0),
      allOrganizations: stats,
    };
  }

  private async resolveInvoiceId(
    organizationId: number,
    ref: unknown,
  ): Promise<number> {
    const raw = String(ref ?? "").trim();
    if (!raw) throw new BadRequestException("invoiceId requerido");
    const digits = parseInt(raw.replace(/\D/g, ""), 10);
    if (!Number.isNaN(digits)) {
      const byId = await this.prisma.invoice.findFirst({
        where: { id: digits, organizationId },
        select: { id: true },
      });
      if (byId) return byId.id;
      const byConsecutive = await this.prisma.invoice.findFirst({
        where: { consecutiveNumber: digits, organizationId },
        select: { id: true },
      });
      if (byConsecutive) return byConsecutive.id;
    }
    throw new BadRequestException(`Factura no encontrada: ${raw}`);
  }

  private summarizeInvoice(inv: {
    id: number;
    consecutiveNumber?: number | null;
    totalAmount: unknown;
    status: string;
    createdAt: Date;
    customer?: { name?: string | null; taxId?: string | null } | null;
    controlNumber?: string | null;
  }) {
    return {
      id: inv.id,
      consecutiveNumber: inv.consecutiveNumber ?? null,
      controlNumber: inv.controlNumber ?? null,
      customer: inv.customer?.name ?? "Cliente General",
      customerTaxId: inv.customer?.taxId ?? null,
      totalAmount: Number(inv.totalAmount),
      status: inv.status,
      createdAt: inv.createdAt,
    };
  }

  private async searchInvoices(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const limit = Math.min(25, Math.max(1, Number(args.limit) || 10));
    const result = await this.invoices.findAllPaginated(ctx.organizationId, {
      search: args.searchTerm ? String(args.searchTerm) : undefined,
      status: args.status ? String(args.status) : undefined,
      limit,
      page: 1,
    });
    return {
      organizationId: ctx.organizationId,
      organizationName: ctx.orgName,
      count: result.total,
      invoices: result.data.map((inv) => this.summarizeInvoice(inv)),
    };
  }

  private async getInvoiceDetail(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const id = await this.resolveInvoiceId(ctx.organizationId, args.invoiceId);
    const invoice = await this.invoices.findOne(id, ctx.organizationId);
    return {
      ...this.summarizeInvoice(invoice),
      ivaAmount: Number(invoice.ivaAmount),
      paymentMethod: invoice.paymentMethod,
      notes: invoice.notes,
      items: invoice.items?.map((item) => ({
        product: item.product?.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        subtotal: Number(item.subtotal),
      })),
    };
  }

  private async modifyInvoiceAmount(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const id = await this.resolveInvoiceId(ctx.organizationId, args.invoiceId);
    const newAmount = Number(args.newAmount);
    const reason = String(args.reason ?? "").trim();
    if (!reason)
      throw new BadRequestException("Motivo requerido para ajustar monto");
    const result = await this.invoices.adjustAmount(
      id,
      newAmount,
      ctx.organizationId,
      ctx.userId,
      reason,
    );
    return {
      invoiceId: id,
      newAmount,
      difference: result.difference,
      creditNoteId: result.creditNote.id,
      message: "Monto ajustado con nota de crédito",
    };
  }

  private async annulInvoice(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const id = await this.resolveInvoiceId(ctx.organizationId, args.invoiceId);
    const reason = String(args.reason ?? "").trim();
    if (!reason) throw new BadRequestException("Motivo requerido para anular");
    const voided = await this.invoices.voidInvoice(
      id,
      ctx.organizationId,
      ctx.userId,
      reason,
    );
    return {
      invoiceId: id,
      status: voided.status,
      message: "Factura anulada correctamente",
    };
  }

  private async checkInventoryStock(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    if (args.lowStockOnly === true) {
      const low = await this.dashboard.getLowStock(ctx.organizationId, 5);
      return { lowStockProducts: low };
    }
    const search = args.productName ? String(args.productName) : undefined;
    if (!search) {
      const low = await this.dashboard.getLowStock(ctx.organizationId, 5);
      return {
        lowStockProducts: low,
        hint: "Indique productName para buscar un producto específico",
      };
    }
    const result = await this.products.findAllPaginated(ctx.organizationId, {
      search,
      limit: 15,
      page: 1,
    });
    return {
      count: result.total,
      products: result.data.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        stock: p.stock,
        minStock: p.minStock,
        salePrice: Number(p.salePrice),
      })),
    };
  }

  private async updateProduct(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const productId = Number(args.productId);
    if (!productId) throw new BadRequestException("productId requerido");

    const patch: Record<string, unknown> = {};
    if (args.stock !== undefined) patch.stock = Number(args.stock);
    if (args.salePrice !== undefined) patch.salePrice = Number(args.salePrice);
    if (args.minStock !== undefined) patch.minStock = Number(args.minStock);
    if (args.name !== undefined) patch.name = String(args.name);

    const updated = await this.products.update(
      productId,
      patch as any,
      ctx.organizationId,
      ctx.userId,
    );
    return {
      productId: updated.id,
      name: updated.name,
      stock: updated.stock,
      salePrice: Number(updated.salePrice),
      minStock: updated.minStock,
      message: "Producto actualizado",
    };
  }

  private async registerInventoryOutflow(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const type = String(args.type ?? "AUTOCONSUMO").toUpperCase();
    if (!OUTFLOW_TYPES.includes(type as (typeof OUTFLOW_TYPES)[number])) {
      throw new BadRequestException(
        `type debe ser: ${OUTFLOW_TYPES.join(", ")}`,
      );
    }
    return this.inventoryMovements.createOutflow({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      dto: {
        type: type as (typeof OUTFLOW_TYPES)[number],
        productId: Number(args.productId),
        quantity: Number(args.quantity),
        reason: args.reason ? String(args.reason) : undefined,
      },
    });
  }

  private async createCustomer(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const name = String(args.name ?? "").trim();
    if (!name) throw new BadRequestException("name requerido");
    const customer = await this.customers.create(
      {
        name,
        taxId: args.taxId ? String(args.taxId) : undefined,
        email: args.email ? String(args.email) : undefined,
        phone: args.phone ? String(args.phone) : undefined,
      },
      ctx.organizationId,
    );
    return {
      customerId: customer.id,
      name: customer.name,
      message: "Cliente creado",
    };
  }

  private async searchCustomers(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const term = String(args.searchTerm ?? args.searchCriteria ?? "").trim();
    if (term.length < 2)
      throw new BadRequestException(
        "searchTerm debe tener al menos 2 caracteres",
      );
    const customers = await this.prisma.customer.findMany({
      where: {
        organizationId: ctx.organizationId,
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { taxId: { contains: term, mode: "insensitive" } },
          { email: { contains: term, mode: "insensitive" } },
        ],
      },
      take: 15,
      orderBy: { createdAt: "desc" },
    });
    return { count: customers.length, customers };
  }

  private async getOrganizationStatus(ctx: AssistantToolContext) {
    await this.guardOrg(ctx);
    const [summary, lowStock] = await Promise.all([
      this.dashboard.getSummary(ctx.organizationId),
      this.dashboard.getLowStock(ctx.organizationId, 5),
    ]);
    return {
      organizationId: ctx.organizationId,
      organization: ctx.orgName,
      summary,
      lowStockCount: lowStock.length,
      lowStockPreview: lowStock.slice(0, 5),
    };
  }

  private periodArgs(args: Record<string, unknown>) {
    const now = new Date();
    return {
      year: Number(args.periodYear ?? args.year) || now.getFullYear(),
      month: Number(args.periodMonth ?? args.month) || now.getMonth() + 1,
    };
  }

  private async getFiscalCalendar(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const { year, month } = this.periodArgs(args);
    return this.fiscalCalendar.listCalendar(ctx.organizationId, year, month);
  }

  private async getLibroVentas(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const { year, month } = this.periodArgs(args);
    return this.fiscal.listLibroVentas(ctx.organizationId, { year, month });
  }

  private async getLibroCompras(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const { year, month } = this.periodArgs(args);
    return this.fiscal.listLibroCompras(ctx.organizationId, { year, month });
  }

  private async getFiscalRetenciones(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const { year, month } = this.periodArgs(args);
    return this.fiscal.listRetenciones(ctx.organizationId, { year, month });
  }

  private async getAccountsPayable(ctx: AssistantToolContext) {
    await this.guardOrg(ctx);
    const rows = await this.expenses.listAccountsPayable(ctx.organizationId);
    return {
      count: rows.length,
      accounts: rows.slice(0, 20).map((e) => ({
        id: e.id,
        description: e.description,
        supplier: e.supplier?.name,
        balanceDue: e.balanceDue,
        date: e.date,
      })),
    };
  }

  private async getCashRegisterStatus(ctx: AssistantToolContext) {
    await this.guardOrg(ctx);
    const cierre = await this.cierreCaja.getCierreAbierto(
      ctx.organizationId,
      ctx.userId,
    );
    if (!cierre)
      return {
        open: false,
        message: "No hay turno de caja abierto para este usuario",
      };
    return {
      open: true,
      fechaApertura: cierre.fechaApertura,
      ventasEfectivo: cierre.ventasEfectivo,
      ventasDigitales: cierre.ventasDigitales,
      autoconsumos: cierre.autoconsumos,
    };
  }

  private async searchEventTicket(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const term = String(args.searchCriteria ?? args.searchTerm ?? "").trim();
    return this.concert.searchOrdersByCustomer(ctx.organizationId, term);
  }

  private async manualQrCheckin(
    args: Record<string, unknown>,
    ctx: AssistantToolContext,
  ) {
    await this.guardOrg(ctx);
    const ticketId = String(args.ticketId ?? "").trim();
    if (!ticketId) throw new BadRequestException("ticketId requerido");
    return this.concert.scanTicket(ctx.organizationId, ctx.userId, ticketId);
  }

  private async searchFiscalLaw(args: Record<string, unknown>) {
    const query = String(
      args.query ?? args.q ?? args.search_query ?? "",
    ).trim();
    if (!query) throw new BadRequestException("query requerido");

    const ready = await this.fiscalKnowledge.isReady();
    if (!ready) {
      return {
        found: false,
        message:
          "La base de conocimiento fiscal aún no está cargada. Ejecute pnpm ingest:fiscal-knowledge en el servidor.",
        results: [],
      };
    }

    const ley = args.ley ? String(args.ley).trim().toUpperCase() : undefined;
    const articuloRaw = args.articulo ?? args.article;
    const articulo =
      typeof articuloRaw === "number" && Number.isFinite(articuloRaw)
        ? articuloRaw
        : typeof articuloRaw === "string" && articuloRaw.trim()
          ? Number.parseInt(articuloRaw, 10)
          : undefined;
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? args.limit
        : 5;

    const rag = await this.fiscalKnowledge.searchSemantic(query, {
      ley,
      articulo: Number.isFinite(articulo) ? articulo : undefined,
      limit,
    });
    const hits = rag.hits;
    return {
      found: hits.length > 0,
      confident: rag.confident,
      query,
      parsed: {
        ley: rag.parsed.ley,
        articulo: rag.parsed.articulo,
        embeddingQuery: rag.parsed.embeddingQuery,
      },
      leyFilter: ley ?? rag.parsed.ley ?? null,
      results: hits.map((h) => ({
        ley: h.ley,
        leyLabel: h.leyLabel,
        articulo: h.articulo,
        titulo: h.titulo,
        vectorSimilarity: Math.round(h.similarity * 1000) / 1000,
        relevance: Math.round((h.rerankScore ?? h.similarity) * 1000) / 1000,
        excerpt: h.content.slice(0, 1800),
        citation: `${h.leyLabel}, Artículo ${h.articulo}`,
      })),
      guidance:
        "Responde al cliente citando ley y artículo del fragmento recuperado. No afirmes que un artículo no existe si aparece en results. Explica en español venezolano.",
    };
  }
}
