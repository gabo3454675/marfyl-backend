import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  FiscalDocumentType,
  FiscalDocumentKind,
  FiscalPeriodStatus,
  LibroLineStatus,
} from "@prisma/client";
import { computeWithholdingIva } from "./helpers/tax-calculator";
import { FiscalAlertsService } from "./fiscal-alerts.service";
import * as crypto from "crypto";

@Injectable()
export class FiscalEngineService {
  private readonly logger = new Logger(FiscalEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fiscalAlerts: FiscalAlertsService,
  ) {}

  async assertPeriodOpen(organizationId: number, date: Date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const period = await this.prisma.fiscalPeriod.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
    });
    if (period?.status === FiscalPeriodStatus.CLOSED) {
      throw new ForbiddenException(
        `El período ${month}/${year} está cerrado. No se pueden registrar movimientos fiscales.`,
      );
    }
  }

  async ensureOpenPeriod(organizationId: number, date: Date) {
    await this.assertPeriodOpen(organizationId, date);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    return this.prisma.fiscalPeriod.upsert({
      where: {
        organizationId_year_month: { organizationId, year, month },
      },
      create: { organizationId, year, month },
      update: {},
    });
  }

  async projectSale(
    organizationId: number,
    invoiceId: number,
    userId?: number,
  ) {
    const existing = await this.prisma.libroVentaLine.findUnique({
      where: { invoiceId },
    });
    if (existing) return existing;

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { customer: true, organization: true },
    });
    if (!invoice) {
      this.logger.warn(`projectSale: factura ${invoiceId} no encontrada`);
      return null;
    }

    const issueDate = invoice.issueDate ?? invoice.createdAt;
    await this.ensureOpenPeriod(organizationId, issueDate);

    const periodYear = issueDate.getFullYear();
    const periodMonth = issueDate.getMonth() + 1;
    const invoiceNumber =
      invoice.fiscalInvoiceNumber ??
      (invoice.consecutiveNumber != null
        ? String(invoice.consecutiveNumber)
        : String(invoice.id));

    const totalAmount =
      Number(invoice.baseExempt) +
      Number(invoice.baseReduced) +
      Number(invoice.baseGeneral) +
      Number(invoice.ivaAmount);

    const line = await this.prisma.libroVentaLine.create({
      data: {
        organizationId,
        periodYear,
        periodMonth,
        invoiceId: invoice.id,
        issueDate,
        documentType: invoice.fiscalDocumentType ?? FiscalDocumentType.FACTURA,
        invoiceNumber,
        controlNumber: invoice.controlNumber,
        customerTaxId: invoice.customer?.taxId ?? null,
        customerName: invoice.customer?.name ?? null,
        baseExempt: invoice.baseExempt,
        baseReduced: invoice.baseReduced,
        baseGeneral: invoice.baseGeneral,
        ivaAmount: invoice.ivaAmount,
        totalAmount,
        status: LibroLineStatus.ACTIVE,
      },
    });

    if (Number(invoice.baseGeneral) > 0 && !invoice.customer?.taxId?.trim()) {
      await this.fiscalAlerts.notifyMissingCustomerRif({
        organizationId,
        organizationName: invoice.organization?.nombre ?? "Organización",
        invoiceId: invoice.id,
        userId,
      });
    }

    return line;
  }

  async voidSaleLine(organizationId: number, invoiceId: number) {
    const line = await this.prisma.libroVentaLine.findUnique({
      where: { invoiceId },
    });
    if (!line || line.organizationId !== organizationId) return null;
    return this.prisma.libroVentaLine.update({
      where: { id: line.id },
      data: { status: LibroLineStatus.VOID },
    });
  }

  async projectPurchase(organizationId: number, expenseId: number) {
    const existing = await this.prisma.libroCompraLine.findUnique({
      where: { expenseId },
    });
    if (existing) return existing;

    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, organizationId },
      include: { supplier: true },
    });
    if (!expense) {
      this.logger.warn(`projectPurchase: gasto ${expenseId} no encontrado`);
      return null;
    }

    const issueDate = expense.date;
    await this.ensureOpenPeriod(organizationId, issueDate);

    const periodYear = issueDate.getFullYear();
    const periodMonth = issueDate.getMonth() + 1;
    const totalAmount =
      Number(expense.baseExempt) +
      Number(expense.baseReduced) +
      Number(expense.baseGeneral) +
      Number(expense.ivaAmount);

    const line = await this.prisma.libroCompraLine.create({
      data: {
        organizationId,
        periodYear,
        periodMonth,
        expenseId: expense.id,
        issueDate,
        supplierTaxId: expense.supplier?.taxId ?? null,
        supplierName: expense.supplier?.name ?? null,
        invoiceNumber: expense.supplierInvoiceNumber ?? expense.referenceNumber,
        controlNumber: expense.supplierControlNumber,
        baseExempt: expense.baseExempt,
        baseReduced: expense.baseReduced,
        baseGeneral: expense.baseGeneral,
        ivaAmount: expense.ivaAmount,
        withholdingIva: expense.withholdingIvaAmount,
        totalAmount,
        status: LibroLineStatus.ACTIVE,
      },
    });

    await this.generateWithholdingIfNeeded(organizationId, expenseId);
    return line;
  }

  async generateWithholdingIfNeeded(organizationId: number, expenseId: number) {
    const profile = await this.prisma.fiscalProfile.findUnique({
      where: { organizationId },
    });
    if (!profile?.isWithholdingAgent) return null;

    const existing = await this.prisma.retencionIVA.findUnique({
      where: { expenseId },
    });
    if (existing) return existing;

    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, organizationId },
      include: { supplier: true },
    });
    if (!expense || Number(expense.ivaAmount) <= 0) return null;

    const withholdingAmount = computeWithholdingIva(Number(expense.ivaAmount));
    const issueDate = expense.date;
    const periodYear = issueDate.getFullYear();
    const periodMonth = issueDate.getMonth() + 1;
    const certificateNumber = `RET-${periodYear}${String(periodMonth).padStart(2, "0")}-${expenseId}`;

    const doc = await this.prisma.fiscalDocument.create({
      data: {
        organizationId,
        kind: FiscalDocumentKind.RETENCION_IVA,
        fileName: `${certificateNumber}.pdf`,
        storageUrl: null,
        metadata: {
          expenseId,
          supplierTaxId: expense.supplier?.taxId,
          withholdingAmount,
        },
      },
    });

    return this.prisma.retencionIVA.create({
      data: {
        organizationId,
        expenseId,
        periodYear,
        periodMonth,
        supplierTaxId: expense.supplier?.taxId,
        supplierName: expense.supplier?.name,
        baseAmount: expense.baseGeneral,
        ivaAmount: expense.ivaAmount,
        withholdingAmount,
        certificateNumber,
        fiscalDocumentId: doc.id,
      },
      include: { fiscalDocument: true },
    });
  }

  async closePeriod(organizationId: number, year: number, month: number) {
    const period = await this.prisma.fiscalPeriod.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
    });
    if (!period) {
      throw new BadRequestException("Período fiscal no encontrado");
    }
    if (period.status === FiscalPeriodStatus.CLOSED) {
      throw new BadRequestException("El período ya está cerrado");
    }

    const [ventas, compras] = await Promise.all([
      this.prisma.libroVentaLine.findMany({
        where: {
          organizationId,
          periodYear: year,
          periodMonth: month,
          status: "ACTIVE",
        },
      }),
      this.prisma.libroCompraLine.findMany({
        where: {
          organizationId,
          periodYear: year,
          periodMonth: month,
          status: "ACTIVE",
        },
      }),
    ]);

    const snapshot = { ventas, compras, closedAt: new Date().toISOString() };
    const integrityHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex");

    const totals = {
      ventasIva: ventas.reduce((s, l) => s + Number(l.ivaAmount), 0),
      comprasIva: compras.reduce((s, l) => s + Number(l.ivaAmount), 0),
      ventasTotal: ventas.reduce((s, l) => s + Number(l.totalAmount), 0),
      comprasTotal: compras.reduce((s, l) => s + Number(l.totalAmount), 0),
    };

    const updated = await this.prisma.fiscalPeriod.update({
      where: { id: period.id },
      data: {
        status: FiscalPeriodStatus.CLOSED,
        closedAt: new Date(),
        integrityHash,
      },
    });

    const existingDecl = await this.prisma.declaracion_IVA.findFirst({
      where: { fiscalPeriodId: period.id },
    });
    if (existingDecl) {
      await this.prisma.declaracion_IVA.update({
        where: { id: existingDecl.id },
        data: { status: "LISTO", totals },
      });
    } else {
      await this.prisma.declaracion_IVA.create({
        data: {
          organizationId,
          fiscalPeriodId: period.id,
          status: "LISTO",
          totals,
        },
      });
    }

    return updated;
  }
}
