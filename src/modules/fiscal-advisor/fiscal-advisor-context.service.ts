import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import type {
  PerfilEmpresa,
  ResumenOperativo,
} from "./fiscal-audit.rules";

@Injectable()
export class FiscalAdvisorContextService {
  constructor(private readonly prisma: PrismaService) {}

  async buildForOrganization(
    organizationId: number,
  ): Promise<{ perfilEmpresa: PerfilEmpresa; resumenOperativo: ResumenOperativo }> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: {
        taxId: true,
        legalName: true,
        nombre: true,
        isSpecialTaxpayer: true,
        isFormalTaxpayer: true,
        fiscalProfile: {
          select: { economicActivity: true, taxpayerType: true },
        },
      },
    });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [invoiceAgg, igtfAgg, cashUsdAgg, sinMaquina, lastIva] =
      await Promise.all([
        this.prisma.invoice.aggregate({
          where: {
            organizationId,
            deletedAt: null,
            createdAt: { gte: monthStart },
            status: { not: "CANCELLED" },
          },
          _sum: { totalAmount: true },
        }),
        this.prisma.invoice.aggregate({
          where: {
            organizationId,
            deletedAt: null,
            createdAt: { gte: monthStart },
            status: { not: "CANCELLED" },
          },
          _sum: { igtfAmount: true },
        }),
        this.prisma.invoicePaymentLine.aggregate({
          where: {
            invoice: {
              organizationId,
              deletedAt: null,
              createdAt: { gte: monthStart },
              status: { not: "CANCELLED" },
            },
            method: "CASH_USD",
          },
          _sum: { amount: true },
        }),
        this.prisma.invoice.count({
          where: {
            organizationId,
            deletedAt: null,
            createdAt: { gte: monthStart },
            status: { not: "CANCELLED" },
            OR: [{ fiscalInvoiceNumber: null }, { fiscalInvoiceNumber: "" }],
          },
        }),
        this.prisma.declaracion_IVA.findFirst({
          where: {
            organizationId,
            deleted_at: null,
          },
          orderBy: { created_at: "desc" },
          select: { created_at: true },
        }),
      ]);

    const tipoFacturacion =
      org?.fiscalProfile?.taxpayerType === "ESPECIAL"
        ? "Contribuyente Especial"
        : org?.isFormalTaxpayer
          ? "Máquina Fiscal"
          : "Formato Libre";

    return {
      perfilEmpresa: {
        RIF: org?.taxId?.trim() || "Sin RIF registrado",
        esEspecial: Boolean(org?.isSpecialTaxpayer),
        actividadPrincipal:
          org?.fiscalProfile?.economicActivity?.trim() ||
          org?.legalName?.trim() ||
          org?.nombre ||
          "Actividad comercial",
        tipoFacturacion,
      },
      resumenOperativo: {
        totalFacturadoMes: Number(invoiceAgg._sum.totalAmount ?? 0),
        pagosDivisasEfectivo: Number(cashUsdAgg._sum.amount ?? 0),
        igtfRecaudado: Number(igtfAgg._sum.igtfAmount ?? 0),
        ultimaDeclaracionIVA: lastIva?.created_at ?? null,
        facturasSinMaquinaFiscal: sinMaquina,
      },
    };
  }
}
