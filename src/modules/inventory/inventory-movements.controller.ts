import { Controller, Post, Get, UseGuards, Body, Query } from '@nestjs/common';
import { InventoryMovementsService } from './inventory-movements.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';
import { ActiveUser } from '@/common/decorators/active-user.decorator';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementType } from '@prisma/client';

@Controller('inventory/movements')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class InventoryMovementsController {
  constructor(
    private readonly inventoryMovementsService: InventoryMovementsService,
  ) {}

  /**
   * Registra una salida por Autoconsumo o Merma (vencido/dañado).
   * Descuenta del stock del producto y crea el registro en InventoryMovement.
   */
  @Post()
  async create(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
    @Body() dto: CreateMovementDto,
  ) {
    return this.inventoryMovementsService.createOutflow({
      organizationId,
      userId: user.id,
      dto,
    });
  }

  /**
   * KPIs para dashboard de Autoconsumo: impacto económico por día, productos más consumidos, distribución por motivo.
   * Query opcionales: dateFrom, dateTo (YYYY-MM-DD).
   */
  @Get('kpis')
  async getKpis(
    @ActiveOrganization() organizationId: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.inventoryMovementsService.getAutoconsumoKpis(organizationId, {
      dateFrom,
      dateTo,
    });
  }

  /**
   * Lista movimientos de inventario de la organización.
   * Query opcionales: productId, type (MovementType), limit.
   */
  @Get()
  async findAll(
    @ActiveOrganization() organizationId: number,
    @Query('productId') productId?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    const options: { productId?: number; type?: MovementType; limit?: number } =
      {};
    if (productId != null && productId !== '') {
      const n = parseInt(productId, 10);
      if (!Number.isNaN(n)) options.productId = n;
    }
    if (type != null && type !== '')
      options.type = type as MovementType;
    if (limit != null && limit !== '') {
      const n = parseInt(limit, 10);
      if (!Number.isNaN(n)) options.limit = n;
    }
    return this.inventoryMovementsService.findByOrganization(
      organizationId,
      options,
    );
  }
}
