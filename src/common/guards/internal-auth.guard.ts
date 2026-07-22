import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { tryAuthenticateInternalAgent } from "../internal-agent-auth";

/**
 * Auth service-to-service para el agente Python.
 *
 * Headers requeridos:
 * - `X-Internal-Secret` = `AGENT_SECRET` (env)
 * - `X-Organization-Id` = organizationId (> 0)
 * - `X-User-Id` = userId (opcional)
 *
 * Uso típico: preferir {@link InternalOrJwtAuthGuard} en controllers
 * (JWT frontend O agente). Este guard solo acepta auth interna.
 *
 * Extensión TASK-009: sustituir `JwtAuthGuard` por `InternalOrJwtAuthGuard`
 * en controllers de tools (products, invoices, customers, expenses, fiscal,
 * credits, suppliers, …) junto con OrganizationGuard (ya bypasea isInternalAgent).
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const ok = tryAuthenticateInternalAgent(request);
    if (!ok) {
      throw new UnauthorizedException(
        "Missing X-Internal-Secret (internal agent auth required)",
      );
    }
    return true;
  }
}
