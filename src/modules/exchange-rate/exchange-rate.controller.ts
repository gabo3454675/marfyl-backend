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
    return this.sync.fetchQuotePreview("USD");
  }

  /** Cotización Euro BCV actual desde DolarApi (sin guardar). */
  @Get("euro-quote")
  @Roles("SUPER_ADMIN", "ADMIN", "MANAGER")
  getEuroQuote() {
    return this.sync.fetchQuotePreview("EUR");
  }

  /** Sincroniza las tasas USD/BCV y EUR/BCV de la organización activa. */
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
        ? `Tasas actualizadas: USD ${result.exchangeRate} y EUR ${result.euroExchangeRate} Bs.`
        : "Las tasas USD y EUR ya estaban al día; no hubo cambios.",
    };
  }

  /** Super admin: sincroniza todas las organizaciones (útil para cron manual). */
  @Post("sync-bcv-all")
  @Roles("SUPER_ADMIN")
  syncBcvAll() {
    return this.sync.syncAllOrganizations();
  }
}
