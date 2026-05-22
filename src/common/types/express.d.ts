import { Organization, Member } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      // Información de usuario autenticado (inyectada por JWT Strategy)
      user?: {
        id: number;
        email: string;
        isSuperAdmin?: boolean;
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
