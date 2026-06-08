import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  WALK_IN_CUSTOMER_NAME,
  WALK_IN_CUSTOMER_TAX_ID,
} from "./organization-provisioning.constants";

export type ProvisionOrganizationParams = {
  organizationId: number;
  organizationName: string;
};

/**
 * Bootstrap automático de orgs nuevas (clientes SaaS, no fundadoras).
 * Idempotente: puede llamarse más de una vez sin duplicar datos clave.
 */
@Injectable()
export class OrganizationProvisioningService {
  private readonly logger = new Logger(OrganizationProvisioningService.name);

  async provisionInTransaction(
    tx: Prisma.TransactionClient,
    params: ProvisionOrganizationParams,
  ): Promise<{ companyId: number }> {
    const { organizationId, organizationName } = params;

    const company = await this.ensureCompany(tx, organizationName);
    await this.ensureExpenseCategories(tx, organizationId, company.id);
    await this.ensureWalkInCustomer(tx, organizationId, company.id);
    await this.ensureFiscalProfile(tx, organizationId);

    this.logger.log(
      `Org ${organizationId} (${organizationName}) provisionada — company ${company.id}`,
    );

    return { companyId: company.id };
  }

  private async ensureCompany(
    tx: Prisma.TransactionClient,
    organizationName: string,
  ) {
    const existing = await tx.company.findFirst({
      where: { name: organizationName },
      select: { id: true },
    });
    if (existing) return existing;

    return tx.company.create({
      data: {
        name: organizationName,
        taxId: `J-${String(organizationIdPlaceholder(organizationName))}`,
        currency: "USD",
        isActive: true,
      },
      select: { id: true },
    });
  }

  private async ensureExpenseCategories(
    tx: Prisma.TransactionClient,
    organizationId: number,
    companyId: number,
  ) {
    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
      const exists = await tx.expenseCategory.findFirst({
        where: { organizationId, name },
        select: { id: true },
      });
      if (!exists) {
        await tx.expenseCategory.create({
          data: { companyId, organizationId, name },
        });
      }
    }
  }

  private async ensureWalkInCustomer(
    tx: Prisma.TransactionClient,
    organizationId: number,
    companyId: number,
  ) {
    const exists = await tx.customer.findFirst({
      where: { organizationId, name: WALK_IN_CUSTOMER_NAME },
      select: { id: true },
    });
    if (exists) return;

    await tx.customer.create({
      data: {
        companyId,
        organizationId,
        name: WALK_IN_CUSTOMER_NAME,
        taxId: WALK_IN_CUSTOMER_TAX_ID,
      },
    });
  }

  private async ensureFiscalProfile(
    tx: Prisma.TransactionClient,
    organizationId: number,
  ) {
    await tx.fiscalProfile.upsert({
      where: { organizationId },
      create: { organizationId },
      update: {},
    });
  }
}

function organizationIdPlaceholder(name: string): string {
  const digits = name.replace(/\D/g, "").slice(0, 8);
  if (digits.length >= 7) return `${digits.padStart(8, "0")}-0`;
  const hash = Math.abs(
    name.split("").reduce((a, c) => a + c.charCodeAt(0), 0),
  );
  return `${String(10000000 + (hash % 89999999)).slice(0, 8)}-0`;
}
