import { Organization, Member } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      // Información de usuario autenticado (JWT Strategy o InternalAuthGuard)
      user?: {
        id: number;
        email: string;
        isSuperAdmin?: boolean;
        organizationId?: number;
        tenantId?: number;
        /** true cuando autenticó vía X-Internal-Secret (agente Python) */
        isInternalAgent?: boolean;
      };

      // Información de Organization (inyectada por OrganizationGuard)
      activeOrganizationId?: number;
      activeOrganization?: Organization;
      activeOrganizationMembership?: Member;

      // Información legacy de Company (inyectada por TenantGuard)
      activeCompanyId?: number;
      activeCompany?: any;
      activeMembership?: any;
    }
  }
}
