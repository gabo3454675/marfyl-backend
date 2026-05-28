import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { validateRifFormat } from './helpers/fiscal-validators';
import { FiscalRuleEngineService } from './fiscal-rule-engine.service';

export interface PreventiveValidationInput {
  organizationId: number;
  operation: 'sale' | 'purchase' | 'credit_note' | 'period_close';
  taxId?: string;
  documentDate?: Date;
  controlNumber?: string;
  amountBs?: number;
}

export interface PreventiveValidationResult {
  allowed: boolean;
  severity: 'info' | 'warning' | 'critical';
  messages: { code: string; text: string; blocks: boolean }[];
}

@Injectable()
export class FiscalValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleEngine: FiscalRuleEngineService,
  ) {}

  async validate(input: PreventiveValidationInput): Promise<PreventiveValidationResult> {
    const messages: PreventiveValidationResult['messages'] = [];

    const org = await this.prisma.organization.findUnique({
      where: { id: input.organizationId },
      include: { fiscalProfile: true },
    });
    if (!org) {
      return {
        allowed: false,
        severity: 'critical',
        messages: [{ code: 'ORG_NOT_FOUND', text: 'Organización no encontrada.', blocks: true }],
      };
    }

    const identity = this.ruleEngine.buildIdentityFromOrgProfile(org, org.fiscalProfile);
    const mode = this.ruleEngine.resolveMode(identity);
    if (mode.mode === 'DIAGNOSTIC') {
      messages.push({
        code: 'PROFILE_INCOMPLETE',
        text: 'Perfil fiscal incompleto. Complete RIF, razón social y tipo de contribuyente.',
        blocks: input.operation === 'period_close',
      });
    }

    if (input.taxId && !validateRifFormat(input.taxId)) {
      messages.push({
        code: 'INVALID_RIF',
        text: 'El RIF del tercero no cumple el formato esperado (ej. J-12345678-9).',
        blocks: true,
      });
    }

    if (input.documentDate) {
      const now = new Date();
      const maxFuture = new Date(now);
      maxFuture.setDate(maxFuture.getDate() + 1);
      if (input.documentDate > maxFuture) {
        messages.push({
          code: 'DATE_FUTURE',
          text: 'La fecha del documento no puede estar en el futuro.',
          blocks: true,
        });
      }
    }

    if (input.controlNumber && org.fiscalProfile) {
      const prefix = org.fiscalProfile.controlSeriesPrefix ?? '01';
      if (!input.controlNumber.startsWith(prefix)) {
        messages.push({
          code: 'CONTROL_SERIES',
          text: `El correlativo debe pertenecer a la serie ${prefix}.`,
          blocks: false,
        });
      }
    }

    const rateAgeDays = org.rateUpdatedAt
      ? Math.floor((Date.now() - org.rateUpdatedAt.getTime()) / 86400000)
      : null;
    if (rateAgeDays != null && rateAgeDays > 7 && (input.amountBs ?? 0) > 0) {
      messages.push({
        code: 'BCV_RATE_STALE',
        text: `La tasa BCV tiene ${rateAgeDays} días sin actualizar. Revise umbrales en Bs.`,
        blocks: false,
      });
    }

    const blocks = messages.some((m) => m.blocks);
    const severity = blocks
      ? 'critical'
      : messages.some((m) => !m.blocks)
        ? 'warning'
        : 'info';

    return {
      allowed: !blocks,
      severity,
      messages,
    };
  }
}
