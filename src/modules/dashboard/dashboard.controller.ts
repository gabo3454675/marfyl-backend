import { Controller, Get, UseGuards, UseInterceptors } from "@nestjs/common";
import { CacheTTL } from "@nestjs/cache-manager";
import { DashboardService } from "./dashboard.service";
import { InternalOrJwtAuthGuard } from "@/common/guards/internal-or-jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { PermissionsGuard } from "@/common/guards/permissions.guard";
import { Permissions } from "@/common/decorators/permissions.decorator";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { HttpCacheTenantInterceptor } from "@/common/interceptors/http-cache-tenant.interceptor";

/**
 * Piloto TASK-003c: InternalOrJwtAuthGuard acepta agente (X-Internal-Secret)
 * o JWT frontend. Extender el mismo patrón en TASK-009 a products, invoices,
 * customers, expenses, fiscal, credits, suppliers, etc.
 */
@Controller("dashboard")
@UseGuards(InternalOrJwtAuthGuard, OrganizationGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get("summary")
  @UseInterceptors(HttpCacheTenantInterceptor)
  @CacheTTL(30)
  async getSummary(@ActiveOrganization() organizationId: number) {
    return this.dashboardService.getSummary(organizationId);
  }

  @Get("pending-invoices")
  @UseInterceptors(HttpCacheTenantInterceptor)
  @CacheTTL(15)
  async getPendingInvoices(@ActiveOrganization() organizationId: number) {
    return this.dashboardService.getPendingInvoices(organizationId);
  }

  @Get("low-stock")
  @UseInterceptors(HttpCacheTenantInterceptor)
  @CacheTTL(15)
  async getLowStock(@ActiveOrganization() organizationId: number) {
    return this.dashboardService.getLowStock(organizationId, 5);
  }

  @Get("health")
  @UseGuards(PermissionsGuard)
  @Permissions("canViewFinancialCharts")
  @UseInterceptors(HttpCacheTenantInterceptor)
  @CacheTTL(60)
  async getHealth(@ActiveOrganization() organizationId: number) {
    return this.dashboardService.getHealth(organizationId);
  }

  @Get("diagnosis")
  @UseGuards(PermissionsGuard)
  @Permissions("canViewFinancialCharts")
  @UseInterceptors(HttpCacheTenantInterceptor)
  @CacheTTL(60)
  async getDiagnosis(@ActiveOrganization() organizationId: number) {
    return this.dashboardService.getDiagnosis(organizationId);
  }

  @Get("strategy")
  @UseGuards(PermissionsGuard)
  @Permissions("canViewFinancialCharts")
  @UseInterceptors(HttpCacheTenantInterceptor)
  @CacheTTL(60)
  async getStrategy(@ActiveOrganization() organizationId: number) {
    return this.dashboardService.getStrategy(organizationId);
  }
}
