import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { RolesGuard } from "@/common/guards/roles.guard";
import { Roles } from "@/common/decorators/roles.decorator";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { ActiveUser } from "@/common/decorators/active-user.decorator";
import { ExchangeRateSyncService } from "./exchange-rate-sync.service";

@Controller("tenants/exchange-rate")
@UseGuards(JwtAuthGuard, OrganizationGuard, RolesGuard)
export class ExchangeRateController {
  constructor(private readonly sync: ExchangeRateSyncService) {}

  /** Cotización Dólar BCV actual desde DolarApi (sin guardar). */
  @Get("bcv-quote")
  @Roles("SUPER_ADMIN", "ADMIN", "MANAGER")
  getBcvQuote() {
    return this.sync.fetchQuotePreview();
  }

  /** Sincroniza la tasa Dólar BCV de la organización activa desde DolarApi. */
  @Post("sync-bcv")
  @Roles("SUPER_ADMIN", "ADMIN")
  async syncBcvForOrganization(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    const result = await this.sync.syncOrganization(organizationId, user.id);
    return {
      ...result,
      message: result.updated
        ? `Tasa Dólar BCV actualizada a ${result.exchangeRate} Bs por USD (${result.source})`
        : "La tasa Dólar BCV ya estaba al día; no hubo cambios.",
    };
  }

  /** Super admin: sincroniza todas las organizaciones (útil para cron manual). */
  @Post("sync-bcv-all")
  @Roles("SUPER_ADMIN")
  syncBcvAll() {
    return this.sync.syncAllOrganizations();
  }
}
