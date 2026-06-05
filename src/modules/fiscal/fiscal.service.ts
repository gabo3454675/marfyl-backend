import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { UpsertFiscalProfileDto } from "./dto/upsert-fiscal-profile.dto";
import { QueryLibroDto } from "./dto/query-libro.dto";
import { CargaRapidaCompraDto } from "./dto/carga-rapida-compra.dto";
import { FiscalEngineService } from "./fiscal-engine.service";
import { FiscalCalendarService } from "./fiscal-calendar.service";
import { FiscalBackfillService } from "./fiscal-backfill.service";
import { RetencionPdfService } from "./retencion-pdf.service";
import {
  assertRifOrWarn,
  rifLastDigitFromTaxId,
} from "./helpers/fiscal-validators";
import { registrarAuditoria } from "@/common/auditoria/registrar-auditoria";
import { computeExpenseFiscal } from "./helpers/expense-fiscal.helper";
import {
  enrichLibroVentaLine,
  buildLibroVentasTxt,
  type LibroVentaRowView,
} from "./helpers/libro-ventas-export";
import { getCompanyIdFromOrganization } from "@/common/helpers/organization.helper";
import * as ExcelJS from "exceljs";
import { round2 } from "./helpers/tax-calculator";

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

@Injectable()
export class FiscalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fiscalEngine: FiscalEngineService,
    private readonly fiscalCalendar: FiscalCalendarService,
    private readonly fiscalBackfill: FiscalBackfillService,
    private readonly retencionPdf: RetencionPdfService,
  ) {}

  backfillLibroVentas(
    organizationId: number,
    options?: { year?: number; month?: number; limit?: number },
  ) {
    return this.fiscalBackfill.backfillLibroVentas(organizationId, options);
  }

  getRetencionPdf(organizationId: number, id: number) {
    return this.retencionPdf.generatePdfBuffer(organizationId, id);
  }

  private periodDefaults(query: QueryLibroDto) {
    const now = new Date();
    return {
      year: query.year ?? now.getFullYear(),
      month: query.month ?? now.getMonth() + 1,
    };
  }

  async getProfile(organizationId: number) {
    const [org, profile] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          taxId: true,
          legalName: true,
          nombre: true,
          isSpecialTaxpayer: true,
          isFormalTaxpayer: true,
        },
      }),
      this.prisma.fiscalProfile.findUnique({ where: { organizationId } }),
    ]);

    return { organization: org, profile: profile ?? null };
  }

  async upsertProfile(
    organizationId: number,
    dto: UpsertFiscalProfileDto,
    userId?: number,
  ) {
    if (dto.taxId) assertRifOrWarn(dto.taxId, "RIF");

    const digit =
      dto.rifLastDigit ?? rifLastDigitFromTaxId(dto.taxId) ?? undefined;

    const orgUpdate: {
      taxId?: string;
      legalName?: string;
      isSpecialTaxpayer?: boolean;
      isFormalTaxpayer?: boolean;
    } = {};
    if (dto.taxId !== undefined) orgUpdate.taxId = dto.taxId;
    if (dto.legalName !== undefined) orgUpdate.legalName = dto.legalName;
    if (dto.isSpecialTaxpayer !== undefined)
      orgUpdate.isSpecialTaxpayer = dto.isSpecialTaxpayer;
    if (dto.isFormalTaxpayer !== undefined)
      orgUpdate.isFormalTaxpayer = dto.isFormalTaxpayer;

    if (Object.keys(orgUpdate).length > 0) {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: orgUpdate,
      });
    }

    await this.prisma.fiscalProfile.upsert({
      where: { organizationId },
      create: {
        organizationId,
        taxId: dto.taxId,
        legalName: dto.legalName,
        taxpayerType: dto.taxpayerType,
        isWithholdingAgent: dto.isWithholdingAgent ?? false,
        isSubjectToWithholding: dto.isSubjectToWithholding ?? false,
        rifLastDigit: digit,
        controlSeriesPrefix: dto.controlSeriesPrefix ?? "01",
        nextControlSequence: dto.nextControlSequence ?? 1,
        economicActivity: dto.economicActivity,
        branches: dto.branches as object | undefined,
      },
      update: {
        taxId: dto.taxId,
        legalName: dto.legalName,
        taxpayerType: dto.taxpayerType,
        isWithholdingAgent: dto.isWithholdingAgent,
        isSubjectToWithholding: dto.isSubjectToWithholding,
        rifLastDigit: digit,
        controlSeriesPrefix: dto.controlSeriesPrefix,
        nextControlSequence: dto.nextControlSequence,
        economicActivity: dto.economicActivity,
        branches: dto.branches as object | undefined,
      },
    });

    const now = new Date();
    await this.fiscalCalendar.recalculateDeadlines(
      organizationId,
      now.getFullYear(),
      now.getMonth() + 1,
    );

    if (userId) {
      await registrarAuditoria(this.prisma, {
        usuarioId: userId,
        accion: "ACTUALIZAR_PERFIL_FISCAL",
        entidad: "fiscal_profile",
        entidadId: String(organizationId),
        valoresNuevos: dto as object,
      });
    }

    return this.getProfile(organizationId);
  }

  async getDashboard(organizationId: number, query: QueryLibroDto) {
    const { year, month } = this.periodDefaults(query);
    const [org, profile, period, ventas, compras] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { exchangeRate: true, taxId: true, nombre: true },
      }),
      this.prisma.fiscalProfile.findUnique({ where: { organizationId } }),
      this.prisma.fiscalPeriod.findUnique({
        where: { organizationId_year_month: { organizationId, year, month } },
      }),
      this.listLibroVentas(organizationId, { year, month }),
      this.listLibroCompras(organizationId, { year, month }),
    ]);

    const rate = Number(org?.exchangeRate ?? 1);
    const grossSales = ventas.totals.totalAmount;
    const debitFiscal = ventas.totals.ivaAmount;
    const creditFiscal = compras.totals.ivaAmount;
    const netIva = round2(Math.max(0, debitFiscal - creditFiscal));

    const rows = ventas.lines as LibroVentaRowView[];
    const alerts = rows
      .filter((r) => r.validationErrors.length > 0)
      .slice(0, 5)
      .map((r) => ({
        type: "error" as const,
        message: `${r.validationErrors[0]} (Op. ${r.opNumber}${r.invoiceNumber ? ` #${r.invoiceNumber}` : ""})`,
      }));

    const cal = await this.fiscalCalendar.listCalendar(
      organizationId,
      year,
      month,
    );
    const agenda = cal.deadlines.map((d) => {
      const daysLeft = Math.ceil((d.dueDate.getTime() - Date.now()) / 86400000);
      return {
        dayLabel: d.dueDate
          .toLocaleDateString("es-VE", { day: "2-digit", month: "short" })
          .toUpperCase(),
        title: d.template.name,
        urgency:
          daysLeft <= 1 ? "high" : daysLeft <= 5 ? "medium" : ("low" as const),
        compliance: d.compliance,
      };
    });

    return {
      period: {
        year,
        month,
        label: `${MONTH_NAMES[month - 1]} ${year}`,
        status: period?.status ?? "OPEN",
        statusLabel:
          period?.status === "CLOSING"
            ? "En Cierre"
            : period?.status === "CLOSED"
              ? "Cerrado"
              : "Abierto",
      },
      exchangeRate: rate,
      metrics: {
        grossSalesUsd: grossSales,
        grossSalesTrendPct: null,
        debitFiscalUsd: debitFiscal,
        debitFiscalBs: round2(debitFiscal * rate),
        creditFiscalUsd: creditFiscal,
        creditFiscalBs: round2(creditFiscal * rate),
        netIvaUsd: netIva,
        netIvaBs: round2(netIva * rate),
        salesCount: ventas.lines.length,
        purchasesCount: compras.lines.length,
      },
      agenda,
      alerts,
      profile: {
        taxId: profile?.taxId ?? org?.taxId,
        rifDigit:
          profile?.rifLastDigit ??
          rifLastDigitFromTaxId(profile?.taxId ?? org?.taxId),
      },
      calendarioMeta: {
        rifDigit: cal.rifDigit,
        terminacionIvaDay: cal.terminacionIvaDay,
        seniatVersion: cal.seniatVersion,
      },
      complianceSummary: cal.deadlines.map((d) => ({
        code: d.template.code,
        name: d.template.name,
        compliance: d.compliance,
        dueDate: d.dueDate,
      })),
    };
  }

  async listRetenciones(organizationId: number, query: QueryLibroDto) {
    const { year, month } = this.periodDefaults(query);
    return this.prisma.retencionIVA.findMany({
      where: { organizationId, periodYear: year, periodMonth: month },
      include: {
        fiscalDocument: true,
        expense: { select: { id: true, description: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async exportRetencionesTxt(
    organizationId: number,
    query: QueryLibroDto,
  ): Promise<string> {
    const rows = await this.listRetenciones(organizationId, query);
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    const lines = [
      "RETENCIONES IVA MARFYL",
      "RIF_AGENTE\tRIF_PROVEEDOR\tPERIODO\tCOMPROBANTE\tBASE\tIVA\tRETENIDO\tFECHA",
    ];
    for (const r of rows) {
      lines.push(
        [
          org?.taxId ?? "",
          r.supplierTaxId ?? "",
          `${r.periodYear}-${String(r.periodMonth).padStart(2, "0")}`,
          r.certificateNumber ?? "",
          Number(r.baseAmount).toFixed(2),
          Number(r.ivaAmount).toFixed(2),
          Number(r.withholdingAmount).toFixed(2),
          r.createdAt.toISOString().slice(0, 10),
        ].join("\t"),
      );
    }
    return lines.join("\r\n");
  }

  async getPredeclaracion(organizationId: number, query: QueryLibroDto) {
    const { year, month } = this.periodDefaults(query);
    const [ventas, compras, period] = await Promise.all([
      this.listLibroVentas(organizationId, { year, month }),
      this.listLibroCompras(organizationId, { year, month }),
      this.prisma.fiscalPeriod.findUnique({
        where: { organizationId_year_month: { organizationId, year, month } },
      }),
    ]);
    const declaracion = period
      ? await this.prisma.declaracion_IVA.findFirst({
          where: { fiscalPeriodId: period.id },
        })
      : null;

    const retenciones = await this.listRetenciones(organizationId, {
      year,
      month,
    });
    const netIva = round2(ventas.totals.ivaAmount - compras.totals.ivaAmount);

    return {
      year,
      month,
      period,
      declaracion,
      ventas: ventas.totals,
      compras: compras.totals,
      retencionesCount: retenciones.length,
      netIvaUsd: netIva,
      steps: [
        {
          id: 1,
          title: "Revisar libro de ventas",
          done: ventas.lines.length > 0,
        },
        {
          id: 2,
          title: "Revisar libro de compras",
          done: compras.lines.length > 0,
        },
        {
          id: 3,
          title: "Cuadrar retenciones",
          done: retenciones.length > 0 || compras.lines.length === 0,
        },
        { id: 4, title: "Exportar archivos", done: false },
        {
          id: 5,
          title: "Presentar en portal SENIAT",
          done: declaracion?.status === "PRESENTADO",
        },
      ],
    };
  }

  async getRetencion(organizationId: number, id: number) {
    const row = await this.prisma.retencionIVA.findFirst({
      where: { id, organizationId },
      include: { fiscalDocument: true, expense: true },
    });
    if (!row) throw new NotFoundException("Retención no encontrada");
    return row;
  }

  async closePeriod(
    organizationId: number,
    year: number,
    month: number,
    userId?: number,
  ) {
    const result = await this.fiscalEngine.closePeriod(
      organizationId,
      year,
      month,
    );
    if (userId) {
      await registrarAuditoria(this.prisma, {
        usuarioId: userId,
        accion: "CERRAR_PERIODO_FISCAL",
        entidad: "fiscal_period",
        entidadId: String(result.id),
        valoresNuevos: { year, month, integrityHash: result.integrityHash },
      });
    }
    return result;
  }

  async listLibroVentas(organizationId: number, query: QueryLibroDto) {
    const { year, month } = this.periodDefaults(query);

    const raw = await this.prisma.libroVentaLine.findMany({
      where: { organizationId, periodYear: year, periodMonth: month },
      orderBy: [{ issueDate: "asc" }, { id: "asc" }],
      include: {
        invoice: {
          select: { id: true, consecutiveNumber: true, status: true },
        },
      },
    });

    const lines = raw.map((l, i) => enrichLibroVentaLine(l, i));

    const totals = lines.reduce(
      (acc, l) => {
        acc.baseExempt += l.baseExempt;
        acc.baseReduced += 0;
        acc.baseGeneral += l.baseGeneral;
        acc.ivaAmount += l.ivaAmount;
        acc.totalAmount += l.totalAmount;
        return acc;
      },
      {
        baseExempt: 0,
        baseReduced: 0,
        baseGeneral: 0,
        ivaAmount: 0,
        totalAmount: 0,
      },
    );

    return { year, month, lines, totals };
  }

  async listLibroCompras(organizationId: number, query: QueryLibroDto) {
    const { year, month } = this.periodDefaults(query);

    const lines = await this.prisma.libroCompraLine.findMany({
      where: { organizationId, periodYear: year, periodMonth: month },
      orderBy: [{ issueDate: "asc" }, { id: "asc" }],
      include: {
        expense: { select: { id: true, description: true, amount: true } },
      },
    });

    const totals = lines.reduce(
      (acc, l) => {
        acc.baseExempt += Number(l.baseExempt);
        acc.baseReduced += Number(l.baseReduced);
        acc.baseGeneral += Number(l.baseGeneral);
        acc.ivaAmount += Number(l.ivaAmount);
        acc.withholdingIva += Number(l.withholdingIva);
        acc.totalAmount += Number(l.totalAmount);
        return acc;
      },
      {
        baseExempt: 0,
        baseReduced: 0,
        baseGeneral: 0,
        ivaAmount: 0,
        withholdingIva: 0,
        totalAmount: 0,
      },
    );

    return { year, month, lines, totals };
  }

  async cargaRapidaCompra(organizationId: number, dto: CargaRapidaCompraDto) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: dto.categoryId, organizationId },
    });
    if (!category) {
      throw new NotFoundException(`Categoría ${dto.categoryId} no encontrada`);
    }

    const profile = await this.prisma.fiscalProfile.findUnique({
      where: { organizationId },
    });
    const fiscal = computeExpenseFiscal({
      amount: dto.amount,
      baseGeneral: dto.baseGeneral,
      ivaAmount: dto.ivaAmount,
      applyWithholding: profile?.isSubjectToWithholding ?? false,
    });

    const companyId = await getCompanyIdFromOrganization(
      this.prisma,
      organizationId,
    );

    const expense = await this.prisma.expense.create({
      data: {
        companyId,
        organizationId,
        date: new Date(dto.date),
        amount: dto.amount,
        description: dto.description,
        referenceNumber: dto.referenceNumber,
        supplierInvoiceNumber: dto.referenceNumber,
        supplierControlNumber: dto.supplierControlNumber,
        supplierId: dto.supplierId,
        categoryId: dto.categoryId,
        status: "PENDING",
        baseExempt: fiscal.baseExempt,
        baseReduced: fiscal.baseReduced,
        baseGeneral: fiscal.baseGeneral,
        ivaAmount: fiscal.ivaAmount,
        withholdingIvaAmount: fiscal.withholdingIvaAmount,
      },
      include: { supplier: true, category: true },
    });

    await this.fiscalEngine.projectPurchase(organizationId, expense.id);
    return expense;
  }

  async exportLibroVentasXlsx(
    organizationId: number,
    query: QueryLibroDto,
  ): Promise<Buffer> {
    const { lines } = await this.listLibroVentas(organizationId, query);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Libro de Ventas");
    ws.addRow([
      "N° OP",
      "FECHA",
      "RIF",
      "RAZÓN SOCIAL",
      "N° FACTURA",
      "N° CONTROL",
      "VENTAS EXENTAS",
      "BASE IMPONIBLE (16%)",
      "IVA CAUSADO",
      "TOTAL",
    ]);
    for (const r of lines as LibroVentaRowView[]) {
      ws.addRow([
        r.opNumber,
        r.issueDate,
        r.customerTaxId ?? "",
        r.customerName ?? "",
        r.invoiceNumber ?? "",
        r.controlNumber ?? "",
        r.baseExempt,
        r.baseGeneral,
        r.ivaAmount,
        r.totalAmount,
      ]);
    }
    ws.addRow([]);
    ws.addRow([
      "TOTALES",
      "",
      "",
      "",
      "",
      "",
      (lines as LibroVentaRowView[]).reduce((s, r) => s + r.baseExempt, 0),
      (lines as LibroVentaRowView[]).reduce((s, r) => s + r.baseGeneral, 0),
      (lines as LibroVentaRowView[]).reduce((s, r) => s + r.ivaAmount, 0),
      (lines as LibroVentaRowView[]).reduce((s, r) => s + r.totalAmount, 0),
    ]);
    ws.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  async exportLibroVentasTxt(
    organizationId: number,
    query: QueryLibroDto,
  ): Promise<string> {
    const { lines, year, month } = await this.listLibroVentas(
      organizationId,
      query,
    );
    return buildLibroVentasTxt(lines as LibroVentaRowView[], year, month);
  }
}
