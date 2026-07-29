import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Request } from "express";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { OrganizationGuard } from "../../../common/guards/organization.guard";
import { FiscalQueryDto } from "./fiscal-query.dto";
import { FiscalQueryService } from "./fiscal-query.service";
import { FiscalRateLimitGuard } from "./rate-limit/fiscal-rate-limit.guard";

/**
 * Controlador dedicado para `POST /api/fiscal/query`.
 *
 * Se mantiene en un controlador aparte del `FiscalController` existente porque:
 * - El `FiscalController` aplica `VerificarRolFiscalGuard` a nivel de clase
 *   (ADMIN/FISCAL global), mientras que aquí el RBAC es por entrada del
 *   catálogo (cada entrada declara sus roles).
 * - Así no se modifica el comportamiento de los endpoints fiscales existentes.
 *
 * Guards:
 * - `JwtAuthGuard` (también global): auth JWT o agente interno S2S.
 * - `OrganizationGuard`: valida membresía real y propaga rol real (B1/B2).
 * - `FiscalRateLimitGuard`: rate limit in-memory por org+user (C1).
 */
@Controller("fiscal")
@UseGuards(JwtAuthGuard, OrganizationGuard, FiscalRateLimitGuard)
export class FiscalQueryController {
  constructor(private readonly fiscalQueryService: FiscalQueryService) {}

  @Post("query")
  async query(
    @Body() dto: FiscalQueryDto,
    @Req() req: Request,
  ): Promise<unknown> {
    const membership = (
      req as unknown as {
        activeOrganizationMembership?: { role: Role };
      }
    ).activeOrganizationMembership;
    const user = (req as unknown as { user?: { id?: number } }).user;
    const organizationId = (
      req as unknown as {
        activeOrganizationId?: number;
      }
    ).activeOrganizationId;

    if (!membership) {
      throw new ForbiddenException("Membresía de organización no disponible");
    }
    if (user?.id == null) {
      throw new ForbiddenException("Usuario no identificado");
    }
    if (organizationId == null) {
      throw new ForbiddenException("Organización no identificada");
    }

    const correlationId = readCorrelationId(req) ?? randomUUID();

    return this.fiscalQueryService.execute(dto, {
      organizationId,
      userId: user.id,
      role: membership.role,
      correlationId,
    });
  }
}

function readCorrelationId(req: Request): string | undefined {
  const h = req.headers as Record<string, unknown>;
  const raw =
    (h["x-correlation-id"] as string | undefined) ??
    (h["x-request-id"] as string | undefined);
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return undefined;
}
