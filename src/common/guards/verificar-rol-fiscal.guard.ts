import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

/**
 * Control de acceso SAC: rol **ADMIN** o **FISCAL** en la organización activa.
 * Usuarios con `isSuperAdmin` en el JWT conservan acceso (operaciones de plataforma).
 *
 * En NestJS esto se implementa como **Guard** (se ejecuta tras JWT y con `request.user` disponible).
 * Equivale a un “middleware” de Express pero con el orden correcto respecto a Passport.
 *
 * Uso típico:
 * @UseGuards(JwtAuthGuard, OrganizationGuard, VerificarRolFiscalGuard)
 * o con el alias exportado `verificarRolFiscal`.
 */
const ROLES_FISCAL_ACCESO = new Set(['ADMIN', 'FISCAL']);

@Injectable()
export class VerificarRolFiscalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user?.isSuperAdmin === true) {
      return true;
    }

    const membership = request.activeOrganizationMembership;

    if (!membership) {
      throw new ForbiddenException(
        'No se pudo verificar el rol. Asegúrate de enviar el header x-tenant-id y tener sesión con organización activa.',
      );
    }

    const userRole = String(membership.role ?? '').toUpperCase().trim();
    if (!ROLES_FISCAL_ACCESO.has(userRole)) {
      throw new ForbiddenException(
        'Acceso denegado: se requiere rol fiscal o administrador.',
      );
    }

    return true;
  }
}

/** Alias solicitado para usar en @UseGuards(verificarRolFiscal) */
export const verificarRolFiscal = VerificarRolFiscalGuard;
