import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { PermissionsGuard } from "@/common/guards/permissions.guard";
import { AnyPermissionsGuard } from "@/common/guards/any-permissions.guard";
import { Permissions } from "@/common/decorators/permissions.decorator";
import { AnyPermissions } from "@/common/decorators/any-permissions.decorator";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { ActiveUser } from "@/common/decorators/active-user.decorator";
import { FloorOrdersService } from "./floor-orders.service";
import {
  ChargeFloorOrderDto,
  CreateFloorOrderDto,
  UpdateFloorOrderStatusDto,
} from "./dto/floor-order.dto";

@Controller("floor-orders")
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class FloorOrdersController {
  constructor(private readonly floorOrders: FloorOrdersService) {}

  /** Cola: anfitrión, cocina o caja */
  @Get()
  @UseGuards(AnyPermissionsGuard)
  @AnyPermissions("canTakeFloorOrder", "canViewKitchenQueue", "canAccessPOS")
  list(
    @ActiveOrganization() organizationId: number,
    @Query("status") status?: string,
    @Query("day") day?: string,
  ) {
    return this.floorOrders.list(organizationId, { status, day });
  }

  @Get(":id")
  @UseGuards(AnyPermissionsGuard)
  @AnyPermissions("canTakeFloorOrder", "canViewKitchenQueue", "canAccessPOS")
  getOne(
    @ActiveOrganization() organizationId: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.floorOrders.getOne(organizationId, id);
  }

  /** Solo anfitrión / quien toma pedidos */
  @Post()
  @UseGuards(PermissionsGuard)
  @Permissions("canTakeFloorOrder")
  create(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
    @Body() dto: CreateFloorOrderDto,
  ) {
    return this.floorOrders.create(organizationId, user.id, dto);
  }

  @Post(":id/send")
  @UseGuards(PermissionsGuard)
  @Permissions("canTakeFloorOrder")
  send(
    @ActiveOrganization() organizationId: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.floorOrders.send(organizationId, id);
  }

  /** Solo cocina / barra */
  @Patch(":id/status")
  @UseGuards(PermissionsGuard)
  @Permissions("canViewKitchenQueue")
  updateStatus(
    @ActiveOrganization() organizationId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateFloorOrderStatusDto,
  ) {
    return this.floorOrders.updateStatus(organizationId, id, dto.status);
  }

  /** Solo caja (POS) */
  @Post(":id/charge")
  @UseGuards(PermissionsGuard)
  @Permissions("canAccessPOS")
  charge(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ChargeFloorOrderDto,
  ) {
    return this.floorOrders.charge(organizationId, user.id, id, dto);
  }

  /** Anfitrión o cocina pueden cancelar; caja también */
  @Post(":id/cancel")
  @UseGuards(AnyPermissionsGuard)
  @AnyPermissions("canTakeFloorOrder", "canViewKitchenQueue", "canAccessPOS")
  cancel(
    @ActiveOrganization() organizationId: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.floorOrders.cancel(organizationId, id);
  }
}
