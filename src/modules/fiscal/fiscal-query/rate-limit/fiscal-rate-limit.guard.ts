import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from "@nestjs/common";

/**
 * Rate limit in-memory para el endpoint fiscal/query (criterio C1).
 *
 * Límites:
 * - 60 req/min por organization_id
 * - 30 req/min por user_id
 *
 * Implementación: ventana deslizante de 60s usando un Map<key, number[]>
 * de timestamps. Cada request elimina timestamps expirados y verifica el cap.
 *
 * CAVEAT (MVP): el estado vive en memoria del proceso. NO funciona con
 * múltiples instancias / behind a load balancer: cada instancia llevaría
 * su propio contador y el límite efectivo sería N×el configurado. Para
 * producción multi-instancia se debe migrar a Redis (o similar). Documentado
 * en el ADR-001 Enmienda 1.
 */
@Injectable()
export class FiscalRateLimitGuard implements CanActivate {
  private readonly windowMs = 60_000;
  private readonly orgLimit = 60;
  private readonly userLimit = 30;
  private readonly orgHits = new Map<number, number[]>();
  private readonly userHits = new Map<number, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const organizationId: number | undefined = request.activeOrganizationId;
    const userId: number | undefined = request.user?.id;

    if (organizationId == null) {
      // Sin organización no se puede rate-limitar por org; el OrganizationGuard
      // ya habría fallado antes. Defensivo: dejamos pasar (el guard anterior falla).
      return true;
    }
    if (userId == null) {
      throw new HttpException(
        "No se pudo identificar al usuario para rate limit",
        429,
      );
    }

    const now = Date.now();
    if (!this.withinLimit(this.orgHits, organizationId, this.orgLimit, now)) {
      throw new HttpException(
        "Rate limit excedido para la organización (60 req/min)",
        429,
      );
    }
    if (!this.withinLimit(this.userHits, userId, this.userLimit, now)) {
      throw new HttpException(
        "Rate limit excedido para el usuario (30 req/min)",
        429,
      );
    }
    return true;
  }

  private withinLimit(
    map: Map<number, number[]>,
    key: number,
    limit: number,
    now: number,
  ): boolean {
    const cutoff = now - this.windowMs;
    const hits = (map.get(key) ?? []).filter((t) => t > cutoff);
    if (hits.length >= limit) {
      map.set(key, hits);
      return false;
    }
    hits.push(now);
    map.set(key, hits);
    return true;
  }

  /** Expone el estado para tests. */
  clear(): void {
    this.orgHits.clear();
    this.userHits.clear();
  }
}
