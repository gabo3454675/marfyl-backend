import { Injectable, ForbiddenException } from '@nestjs/common';
import { Plan } from '@prisma/client';

export interface PlanLimits {
  maxUsers: number;
  maxProducts: number;
  maxOrganizations: number;
  hasPOSBasic: boolean;
  hasPOSFull: boolean;
  hasInventoryBasic: boolean;
  hasInventoryAdvanced: boolean;
  hasSeniatBasic: boolean;
  hasSeniatFull: boolean;
  hasReports: boolean;
  hasAIAdvanced: boolean;
  hasAPIAccess: boolean;
  hasMultiCompany: boolean;
  hasWhiteLabel: boolean;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: {
    maxUsers: -1,
    maxProducts: 100,
    maxOrganizations: 1,
    hasPOSBasic: true,
    hasPOSFull: false,
    hasInventoryBasic: true,
    hasInventoryAdvanced: false,
    hasSeniatBasic: false,
    hasSeniatFull: false,
    hasReports: false,
    hasAIAdvanced: false,
    hasAPIAccess: false,
    hasMultiCompany: false,
    hasWhiteLabel: false,
  },
  BASIC: {
    maxUsers: -1,
    maxProducts: 500,
    maxOrganizations: 1,
    hasPOSBasic: true,
    hasPOSFull: false,
    hasInventoryBasic: true,
    hasInventoryAdvanced: false,
    hasSeniatBasic: false,
    hasSeniatFull: false,
    hasReports: true,
    hasAIAdvanced: false,
    hasAPIAccess: false,
    hasMultiCompany: false,
    hasWhiteLabel: false,
  },
  PREMIUM: {
    maxUsers: -1,
    maxProducts: -1,
    maxOrganizations: 1,
    hasPOSBasic: true,
    hasPOSFull: true,
    hasInventoryBasic: true,
    hasInventoryAdvanced: true,
    hasSeniatBasic: true,
    hasSeniatFull: false,
    hasReports: true,
    hasAIAdvanced: false,
    hasAPIAccess: false,
    hasMultiCompany: false,
    hasWhiteLabel: false,
  },
  ENTERPRISE: {
    maxUsers: -1,
    maxProducts: -1,
    maxOrganizations: -1,
    hasPOSBasic: true,
    hasPOSFull: true,
    hasInventoryBasic: true,
    hasInventoryAdvanced: true,
    hasSeniatBasic: true,
    hasSeniatFull: true,
    hasReports: true,
    hasAIAdvanced: true,
    hasAPIAccess: true,
    hasMultiCompany: true,
    hasWhiteLabel: true,
  },
};

export const PLAN_PRICES: Record<Plan, number> = {
  FREE: 0,
  BASIC: 25,
  PREMIUM: 35,
  ENTERPRISE: 50,
};

export const PLAN_DISPLAY_NAMES: Record<Plan, string> = {
  FREE: 'Free',
  BASIC: 'Starter',
  PREMIUM: 'Professional',
  ENTERPRISE: 'Enterprise',
};

// User-facing plan descriptions
export const PLAN_DESCRIPTIONS: Record<Plan, string> = {
  FREE: 'Para negocios que inician',
  BASIC: 'Para pequeños comercios',
  PREMIUM: 'El más popular para pymes',
  ENTERPRISE: 'Control total',
};

@Injectable()
export class PlanLimitsService {
  getLimits(plan: Plan): PlanLimits {
    return PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE;
  }

  getPrice(plan: Plan): number {
    return PLAN_PRICES[plan] ?? 0;
  }

  getDisplayName(plan: Plan): string {
    return PLAN_DISPLAY_NAMES[plan] ?? 'Unknown';
  }

  getDescription(plan: Plan): string {
    return PLAN_DESCRIPTIONS[plan] ?? '';
  }

  getPlanName(plan: Plan): string {
    return PLAN_DISPLAY_NAMES[plan] ?? 'Unknown';
  }

  formatLimit(limit: number): string {
    return limit === -1 ? 'Ilimitado' : limit.toString();
  }

  canAddUser(plan: Plan, currentUserCount: number): boolean {
    const limits = this.getLimits(plan);
    if (limits.maxUsers === -1) return true;
    return currentUserCount < limits.maxUsers;
  }

  canAddProduct(plan: Plan, currentProductCount: number): boolean {
    const limits = this.getLimits(plan);
    if (limits.maxProducts === -1) return true;
    return currentProductCount < limits.maxProducts;
  }

  canAddOrganization(plan: Plan, currentOrgCount: number): boolean {
    const limits = this.getLimits(plan);
    if (limits.maxOrganizations === -1) return true;
    return currentOrgCount < limits.maxOrganizations;
  }

  hasFeature(plan: Plan, feature: keyof PlanLimits): boolean {
    const limits = this.getLimits(plan);
    return (limits[feature] as boolean) ?? false;
  }

  validateUserCreation(plan: Plan, currentUserCount: number): void {
    // Users are now unlimited in all plans - no validation needed
  }

  validateProductCreation(plan: Plan, currentProductCount: number): void {
    if (!this.canAddProduct(plan, currentProductCount)) {
      const limits = this.getLimits(plan);
      throw new ForbiddenException(
        `Tu plan ${this.getDisplayName(plan)} permite máximo ${limits.maxProducts} productos. Upgrade para productos ilimitados.`,
      );
    }
  }

  validateOrganizationCreation(plan: Plan, currentOrgCount: number): void {
    if (!this.canAddOrganization(plan, currentOrgCount)) {
      throw new ForbiddenException(
        `Tu plan ${this.getDisplayName(plan)} permite máximo 1 empresa. Upgrade a Enterprise para multi-empresa.`,
      );
    }
  }

  validateFeatureAccess(plan: Plan, feature: keyof PlanLimits): void {
    if (!this.hasFeature(plan, feature)) {
      throw new ForbiddenException(
        `Esta característica requiere un plan superior. Tu plan actual es ${this.getDisplayName(plan)}.`,
      );
    }
  }

  getPlanUsage(plan: Plan, currentUsers: number, currentProducts: number) {
    const limits = this.getLimits(plan);
    return {
      plan,
      planName: this.getDisplayName(plan),
      usage: {
        users: { current: currentUsers, limit: limits.maxUsers },
        products: { current: currentProducts, limit: limits.maxProducts },
      },
      features: {
        hasPOSFull: limits.hasPOSFull,
        hasInventoryAdvanced: limits.hasInventoryAdvanced,
        hasSeniatBasic: limits.hasSeniatBasic,
        hasSeniatFull: limits.hasSeniatFull,
        hasReports: limits.hasReports,
        hasAIAdvanced: limits.hasAIAdvanced,
        hasAPIAccess: limits.hasAPIAccess,
        hasMultiCompany: limits.hasMultiCompany,
      },
      canUpgrade: plan !== 'ENTERPRISE',
      upgradeTo: plan === 'FREE' ? 'BASIC' : plan === 'BASIC' ? 'PREMIUM' : 'ENTERPRISE',
    };
  }
}