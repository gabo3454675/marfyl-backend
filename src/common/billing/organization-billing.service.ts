import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { isBillingExemptOrg, isFoundingOrgSlug } from '@/common/founding-orgs';

/**
 * Límites de suscripción por organización.
 * Fundadores (Rancho, Monddy, Davean): siempre activos sin cobro.
 * Resto de clientes: requiere plan de pago (por implementar con pasarela).
 */
@Injectable()
export class OrganizationBillingService {
  constructor(private readonly prisma: PrismaService) {}

  async assertOrganizationBillingActive(organizationId: number): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true, billingExempt: true, plan: true },
    });
    if (!org) return;
    if (isBillingExemptOrg(org)) return;
    if (org.plan === 'FREE') {
      throw new ForbiddenException(
        'Esta organización requiere un plan de suscripción activo. Contacte a MARFYL para activar el servicio.',
      );
    }
  }

  async assertCanCreateAdditionalOrganization(userId: number): Promise<void> {
    const memberships = await this.prisma.member.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { organization: { select: { slug: true, billingExempt: true } } },
    });
    const foundingCount = memberships.filter((m) =>
      isFoundingOrgSlug(m.organization.slug),
    ).length;
    if (foundingCount > 0 && memberships.every((m) => isBillingExemptOrg(m.organization))) {
      return;
    }
    throw new ForbiddenException(
      'Para añadir otra empresa debe contratar un negocio adicional en su plan MARFYL.',
    );
  }
}
