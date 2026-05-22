import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { TenantId } from '@/common/decorators/tenant.decorator';
import { ActiveUser } from '@/common/decorators/active-user.decorator';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';
import { ActiveOrganizationMembership } from '@/common/decorators/active-organization-membership.decorator';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('me')
  async getCurrentTenant(@TenantId() tenantId: string) {
    // TODO: Implementar obtención de tenant actual
    return { message: 'Get current tenant - To be implemented', tenantId };
  }

  /**
   * Lista todas las organizaciones. Solo Super Admin.
   * Usado en el switcher para cambiar entre cualquier org sin necesidad de ser miembro.
   */
  @Get('organizations-all')
  async getAllOrganizationsForSuperAdmin(@ActiveUser() user: { id: number }) {
    return this.tenantsService.getAllOrganizationsForSuperAdmin(user.id);
  }

  /**
   * Obtiene la organización actual (incluye exchangeRate).
   */
  @Get('organization')
  @UseGuards(OrganizationGuard)
  async getOrganization(@ActiveOrganization() organizationId: number) {
    return this.tenantsService.getOrganization(organizationId);
  }

  /**
   * Actualiza la organización (ej. tasa BCV/Paralelo). Solo ADMIN o SUPER_ADMIN.
   */
  @Patch('organization')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  async updateOrganization(
    @ActiveOrganization() organizationId: number,
    @Body() dto: UpdateOrganizationDto,
    @ActiveUser() user: { id: number },
  ) {
    return this.tenantsService.updateOrganization(organizationId, dto, user.id);
  }

  /**
   * Historial de tasas BCV (auditoría). Query: desde?, hasta?, limit?
   */
  @Get('organization/tasas-historicas')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'MANAGER')
  async getTasasHistorial(
    @ActiveOrganization() organizationId: number,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    return this.tenantsService.getTasasHistorial(organizationId, {
      desde,
      hasta,
      limit: limitNum,
    });
  }

  /**
   * Reporte Ganancia/Pérdida por Diferencial Cambiario. Query: desde, hasta (YYYY-MM-DD).
   */
  @Get('organization/reporte-diferencial-cambiario')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'MANAGER')
  async getReporteDiferencialCambiario(
    @ActiveOrganization() organizationId: number,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
  ) {
    if (!desde || !hasta) {
      throw new BadRequestException(
        'Query desde y hasta (YYYY-MM-DD) son requeridos',
      );
    }
    return this.tenantsService.getReporteDiferencialCambiario(
      organizationId,
      desde,
      hasta,
    );
  }

  /**
   * Historial de cambios (audit log). Solo SUPER_ADMIN y ADMIN.
   */
  @Get('organization/audit-log')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getAuditLog(
    @ActiveOrganization() organizationId: number,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 100;
    return this.tenantsService.getAuditLog(organizationId, limitNum);
  }

  /**
   * Auditoría de acciones (precio, factura eliminada, autoconsumo). Solo SUPER_ADMIN y ADMIN.
   */
  @Get('organization/activity-log')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getActivityLog(
    @ActiveOrganization() organizationId: number,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 100;
    return this.tenantsService.getActivityLog(organizationId, limitNum);
  }

  /**
   * Purga usuarios desactivados >6 meses sin facturas ni tareas. Solo SUPER_ADMIN.
   */
  @Post('purge-inactive-users')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  async purgeInactiveUsers(@ActiveUser() user: { id: number }) {
    return this.tenantsService.purgeInactiveUsers(user.id);
  }

  @Post()
  async createOrganization(
    @Body() createOrganizationDto: CreateOrganizationDto,
    @ActiveUser() user: any,
  ) {
    // Validación de Super Admin se hace en el servicio
    return this.tenantsService.create(createOrganizationDto, user.id);
  }

  /**
   * Lista los miembros de la organización según visibilidad del rol:
   * SUPER_ADMIN/ADMIN: lista completa. MANAGER: solo SELLER/WAREHOUSE. SELLER/WAREHOUSE: vacía.
   */
  @Get('users')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'MANAGER')
  async getMembers(
    @ActiveOrganization() organizationId: number,
    @ActiveOrganizationMembership() membership: any,
  ) {
    return this.tenantsService.getMembers(organizationId, membership?.role);
  }

  /**
   * Alias: GET /organization/members (misma lógica que GET /users).
   */
  @Get('organization/members')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'MANAGER')
  async getOrganizationMembers(
    @ActiveOrganization() organizationId: number,
    @ActiveOrganizationMembership() membership: any,
  ) {
    return this.tenantsService.getMembers(organizationId, membership?.role);
  }

  /**
   * Cambia el rol de un miembro. ADMIN no puede cambiar a SUPER_ADMIN ni promoverse a SUPER_ADMIN.
   */
  @Patch('organization/members/:memberId/role')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  async updateMemberRole(
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body() dto: UpdateMemberRoleDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: any,
    @ActiveOrganizationMembership() membership: any,
  ) {
    return this.tenantsService.updateMemberRole(
      memberId,
      organizationId,
      dto,
      user.id,
      membership?.role ?? '',
    );
  }

  /**
   * Desactiva un miembro (soft: status SUSPENDED). No borra User ni historial.
   */
  @Delete('organization/members/:memberId')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  async removeMember(
    @Param('memberId', ParseIntPipe) memberId: number,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: any,
    @ActiveOrganizationMembership() membership: any,
  ) {
    return this.tenantsService.removeMemberByMemberId(
      memberId,
      organizationId,
      user.id,
      membership?.role ?? '',
    );
  }

  /**
   * Elimina (desactiva) un usuario de la organización por userId (legacy).
   * Regla: no puede eliminarse a sí mismo. Solo OWNER o ADMIN puede eliminar.
   */
  @Delete('users/:id')
  @UseGuards(OrganizationGuard)
  async removeUser(
    @Param('id', ParseIntPipe) targetUserId: number,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: any,
    @ActiveOrganizationMembership() membership: any,
  ) {
    return this.tenantsService.removeUserFromOrganization({
      organizationId,
      targetUserId,
      requesterUserId: user.id,
      requesterRole: membership?.role,
    });
  }
}
