import { ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * Composición reutilizable: auth interna (agente) O JWT (frontend).
 *
 * - Si `X-Internal-Secret` está presente → valida AGENT_SECRET y puebla user.
 * - Si no → mismo flujo que JwtAuthGuard (público / preview / passport-jwt).
 *
 * Piloto: DashboardController. Para el resto de tools del agente, en TASK-009
 * reemplazar `@UseGuards(JwtAuthGuard, OrganizationGuard)` por
 * `@UseGuards(InternalOrJwtAuthGuard, OrganizationGuard)`.
 *
 * Nota: JwtAuthGuard global (APP_GUARD) ya incluye el bypass interno; este
 * guard es el punto explícito y documentado para controllers.
 */
@Injectable()
export class InternalOrJwtAuthGuard extends JwtAuthGuard {
  constructor(reflector: Reflector) {
    super(reflector);
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
