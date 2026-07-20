import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { PermissionsGuard } from "@/common/guards/permissions.guard";
import { Permissions } from "@/common/decorators/permissions.decorator";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { ActiveUser } from "@/common/decorators/active-user.decorator";
import { CashHoldService } from "./cash-hold.service";
import { UpsertCashHoldDto } from "./dto/upsert-cash-hold.dto";

@Controller("cash-holds")
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
export class CashHoldController {
  constructor(private readonly cashHoldService: CashHoldService) {}

  @Get()
  @Permissions("canManageCierreCaja")
  list(@ActiveOrganization() organizationId: number) {
    return this.cashHoldService.list(organizationId);
  }

  @Get("summary")
  @Permissions("canManageCierreCaja")
  summary(@ActiveOrganization() organizationId: number) {
    return this.cashHoldService.summary(organizationId);
  }

  @Post()
  @Permissions("canManageCierreCaja")
  upsert(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
    @Body() dto: UpsertCashHoldDto,
  ) {
    return this.cashHoldService.upsert(organizationId, user.id, dto);
  }

  @Delete(":id")
  @Permissions("canManageCierreCaja")
  remove(
    @ActiveOrganization() organizationId: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.cashHoldService.remove(organizationId, id);
  }
}
