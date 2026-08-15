import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { RolesGuard } from "@/common/guards/roles.guard";
import { Roles } from "@/common/decorators/roles.decorator";
import { Role } from "@prisma/client";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { HybridService } from "./hybrid.service";

/**
 * Proxy de solo lectura hacia Hybrid.
 * Org identity: siempre @ActiveOrganization() — nunca desde query del cliente.
 */
@Controller("hybrid")
@UseGuards(JwtAuthGuard, OrganizationGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
export class HybridController {
  constructor(private readonly hybridService: HybridService) {}

  /**
   * Diagnóstico de conexión Hybrid POS (solo SUPER_ADMIN + org Monddy).
   * No expone token.
   */
  @Get("connection")
  @Roles(Role.SUPER_ADMIN)
  connection(@ActiveOrganization() organizationId: number) {
    return this.hybridService.getConnectionStatus(organizationId);
  }

  @Get("health")
  health(@ActiveOrganization() organizationId: number) {
    return this.hybridService.getHealth(organizationId);
  }

  @Get("catalogos")
  catalogos(@ActiveOrganization() organizationId: number) {
    return this.hybridService.getCatalogos(organizationId);
  }

  @Get("catalogos/:grupo")
  catalogoByGrupo(
    @ActiveOrganization() organizationId: number,
    @Param("grupo") grupo: string,
  ) {
    return this.hybridService.getCatalogoByGrupo(organizationId, grupo);
  }

  @Get("monedas")
  monedas(@ActiveOrganization() organizationId: number) {
    return this.hybridService.getMonedas(organizationId);
  }

  @Get("inventario")
  inventario(
    @ActiveOrganization() organizationId: number,
    @Query() query: Record<string, unknown>,
  ) {
    return this.hybridService.getInventario(organizationId, query);
  }

  @Get("inventario/:codigo")
  inventarioByCodigo(
    @ActiveOrganization() organizationId: number,
    @Param("codigo") codigo: string,
  ) {
    return this.hybridService.getInventarioByCodigo(organizationId, codigo);
  }

  @Get("clientes")
  clientes(
    @ActiveOrganization() organizationId: number,
    @Query() query: Record<string, unknown>,
  ) {
    return this.hybridService.getClientes(organizationId, query);
  }

  @Get("existencia")
  existencia(
    @ActiveOrganization() organizationId: number,
    @Query() query: Record<string, unknown>,
  ) {
    return this.hybridService.getExistencia(organizationId, query);
  }

  @Get("ventas")
  ventas(
    @ActiveOrganization() organizationId: number,
    @Query() query: Record<string, unknown>,
  ) {
    return this.hybridService.getVentas(organizationId, query);
  }

  @Get("ventas/:documento")
  ventaByDocumento(
    @ActiveOrganization() organizationId: number,
    @Param("documento") documento: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.hybridService.getVentaByDocumento(
      organizationId,
      documento,
      query,
    );
  }
}
