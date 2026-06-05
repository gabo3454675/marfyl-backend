import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

export interface UserOrganizationSummary {
  id: number;
  nombre: string;
  slug: string;
  role: string;
}

/**
 * Seguridad del asistente: consultas de membresía SIN filtro de tenant activo.
 * El tenant isolation de Prisma filtraría Member por organizationId=activa;
 * aquí usamos SQL directo para listar solo las orgs del usuario autenticado.
 */
@Injectable()
export class AssistantSecurityService {
  constructor(private readonly prisma: PrismaService) {}

  private async fetchMemberships(
    userId: number,
  ): Promise<UserOrganizationSummary[]> {
    return this.prisma.$queryRaw<UserOrganizationSummary[]>`
      SELECT o.id, o.nombre, o.slug, m.role::text AS role
      FROM members m
      INNER JOIN organizations o ON o.id = m."organizationId"
      WHERE m."userId" = ${userId} AND m.status = 'ACTIVE'
      ORDER BY m."joinedAt" ASC
    `;
  }

  async listUserOrganizations(
    userId: number,
  ): Promise<UserOrganizationSummary[]> {
    return this.fetchMemberships(userId);
  }

  async assertMembership(
    userId: number,
    organizationId: number,
  ): Promise<void> {
    const allowed = await this.fetchMemberships(userId);
    const match = allowed.find((o) => o.id === organizationId);
    if (!match) {
      throw new ForbiddenException("No tienes acceso a esta organización");
    }
  }

  async resolveOrganizationForUser(
    userId: number,
    ref: string,
  ): Promise<UserOrganizationSummary> {
    const normalized = ref.trim().toLowerCase();
    if (!normalized)
      throw new NotFoundException("Indique el nombre o slug de la empresa");

    const allowed = await this.fetchMemberships(userId);
    const match =
      allowed.find((o) => o.slug.toLowerCase() === normalized) ??
      allowed.find((o) => o.nombre.toLowerCase() === normalized) ??
      allowed.find((o) => o.nombre.toLowerCase().includes(normalized)) ??
      allowed.find((o) => o.slug.toLowerCase().includes(normalized));

    if (!match) {
      throw new ForbiddenException(
        `No tienes acceso a "${ref}". Tus empresas: ${allowed.map((o) => o.nombre).join(", ") || "ninguna"}`,
      );
    }
    return match;
  }

  async resolveOrganizationByIdForUser(
    userId: number,
    organizationId: number,
  ): Promise<UserOrganizationSummary> {
    const allowed = await this.fetchMemberships(userId);
    const match = allowed.find((o) => o.id === organizationId);
    if (!match) {
      throw new ForbiddenException("No tienes acceso a esa organización");
    }
    return match;
  }
}
