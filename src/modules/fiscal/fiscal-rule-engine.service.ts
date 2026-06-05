import { Injectable } from "@nestjs/common";
import { FiscalTaxpayerType } from "@prisma/client";

export type FiscalComplianceMode = "DIAGNOSTIC" | "OPERATIONAL";
import { PrismaService } from "@/common/prisma/prisma.service";
import { rifLastDigitFromTaxId } from "./helpers/fiscal-validators";

export interface FiscalIdentitySnapshot {
  taxId: string | null;
  legalName: string | null;
  taxpayerType: FiscalTaxpayerType | null;
  isWithholdingAgent: boolean;
  isSpecialTaxpayer: boolean;
  isFormalTaxpayer: boolean;
  economicActivity: string | null;
  rifLastDigit: number | null;
  configured: boolean;
}

export interface ComplianceModeResult {
  mode: FiscalComplianceMode;
  reasons: string[];
  missingFields: string[];
}

@Injectable()
export class FiscalRuleEngineService {
  constructor(private readonly prisma: PrismaService) {}

  resolveMode(identity: FiscalIdentitySnapshot): ComplianceModeResult {
    const missing: string[] = [];
    if (!identity.taxId?.trim()) missing.push("rif");
    if (!identity.legalName?.trim()) missing.push("legalName");
    if (!identity.taxpayerType) missing.push("taxpayerType");
    if (!identity.economicActivity?.trim()) missing.push("economicActivity");

    const reasons: string[] = [];
    if (!identity.taxId?.trim()) {
      reasons.push(
        "Configure el RIF del negocio para aplicar calendario SENIAT.",
      );
    }
    if (!identity.legalName?.trim()) {
      reasons.push("Indique la razón social fiscal.");
    }
    if (!identity.taxpayerType) {
      reasons.push(
        "Seleccione el tipo de contribuyente (ordinario, especial, etc.).",
      );
    }
    if (!identity.economicActivity?.trim()) {
      reasons.push("Registre la actividad económica principal.");
    }

    const mode: FiscalComplianceMode =
      missing.length > 0 ? "DIAGNOSTIC" : "OPERATIONAL";

    return { mode, reasons, missingFields: missing };
  }

  async getActiveNormVersions(at = new Date()) {
    try {
      return await this.prisma.fiscalNormVersion.findMany({
        where: {
          status: "ACTIVE",
          validFrom: { lte: at },
          OR: [{ validTo: null }, { validTo: { gte: at } }],
        },
        include: { norm: true },
        orderBy: [{ norm: { priority: "asc" } }, { validFrom: "desc" }],
      });
    } catch {
      return [];
    }
  }

  async getApplicableCalendarRules(params: {
    rifDigit: number | null;
    at?: Date;
  }) {
    const at = params.at ?? new Date();
    const versionLabel = String(at.getFullYear());
    try {
      const rules = await this.prisma.fiscalCalendarRule.findMany({
        where: {
          isActive: true,
          version: versionLabel,
          rifDigitMin: { lte: params.rifDigit ?? 9 },
          rifDigitMax: { gte: params.rifDigit ?? 0 },
        },
        include: {
          template: true,
          normVersion: { include: { norm: true } },
        },
      });
      return rules;
    } catch {
      return [];
    }
  }

  buildIdentityFromOrgProfile(
    org: {
      taxId: string | null;
      legalName: string | null;
      isSpecialTaxpayer: boolean;
      isFormalTaxpayer: boolean;
    },
    profile: {
      taxpayerType: FiscalTaxpayerType;
      isWithholdingAgent: boolean;
      rifLastDigit: number | null;
      economicActivity: string | null;
    } | null,
  ): FiscalIdentitySnapshot {
    const taxId = org.taxId ?? null;
    const rifDigit =
      profile?.rifLastDigit ?? (taxId ? rifLastDigitFromTaxId(taxId) : null);
    const configured = Boolean(
      taxId?.trim() && org.legalName?.trim() && profile?.taxpayerType,
    );

    return {
      taxId,
      legalName: org.legalName ?? null,
      taxpayerType: profile?.taxpayerType ?? null,
      isWithholdingAgent: profile?.isWithholdingAgent ?? false,
      isSpecialTaxpayer: org.isSpecialTaxpayer,
      isFormalTaxpayer: org.isFormalTaxpayer,
      economicActivity: profile?.economicActivity ?? null,
      rifLastDigit: rifDigit,
      configured,
    };
  }
}
