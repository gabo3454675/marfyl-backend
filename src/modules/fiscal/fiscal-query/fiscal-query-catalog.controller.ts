import { Controller, Get, UseGuards } from "@nestjs/common";
import { InternalAuthGuard } from "../../../common/guards/internal-auth.guard";
import { FiscalQueryService } from "./fiscal-query.service";
import type { CatalogResponse } from "./catalog/fiscal-catalog.types";

/**
 * Controlador dedicado para `GET /api/fiscal/query/catalog` (C5).
 *
 * Se mantiene en un controlador aparte del `FiscalQueryController` porque
 * aquel aplica a nivel de clase `JwtAuthGuard + OrganizationGuard +
 * FiscalRateLimitGuard` (requieren contexto de organización y usuario
 * frontend). El catálogo es metadata global de contrato que el agente
 * consulta en startup, sin organización asociada; por eso sólo exige
 * `InternalAuthGuard` (auth S2S con `X-Internal-Secret`).
 *
 * Nota: `InternalAuthGuard` también exige `X-Organization-Id` (header
 * obligatorio en `tryAuthenticateInternalAgent`). El agente envía un
 * org_id configurable en startup (ver `FISCAL_CATALOG_STARTUP_ORG_ID`).
 */
@Controller("fiscal")
@UseGuards(InternalAuthGuard)
export class FiscalQueryCatalogController {
  constructor(private readonly fiscalQueryService: FiscalQueryService) {}

  @Get("query/catalog")
  getCatalog(): CatalogResponse {
    return this.fiscalQueryService.getCatalogResponse();
  }
}
