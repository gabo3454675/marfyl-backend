import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Query,
} from "@nestjs/common";
import { PayrollService } from "./payroll.service";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { ActiveUser } from "@/common/decorators/active-user.decorator";
import {
  AdjustPayrollProfileDto,
  UpdatePayrollProfileDto,
} from "./dto/update-payroll-profile.dto";

@Controller("payroll")
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Get("employees")
  listEmployees(@ActiveOrganization() organizationId: number) {
    return this.payrollService.listEmployees(organizationId);
  }

  @Patch("profiles/:memberId")
  updateProfile(
    @Param("memberId", ParseIntPipe) memberId: number,
    @Body() dto: UpdatePayrollProfileDto,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.payrollService.updateProfile(organizationId, memberId, dto);
  }

  @Post("profiles/:memberId/adjust")
  adjustProfile(
    @Param("memberId", ParseIntPipe) memberId: number,
    @Body() dto: AdjustPayrollProfileDto,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.payrollService.adjustProfile(organizationId, memberId, dto);
  }

  @Post("process")
  processPayroll(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.payrollService.processPayroll(organizationId, user.id);
  }

  @Get("runs")
  listRuns(
    @ActiveOrganization() organizationId: number,
    @Query("limit") limit?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : 20;
    return this.payrollService.listRuns(organizationId, Number.isFinite(n) ? n : 20);
  }

  @Get("runs/:id")
  getRun(
    @Param("id", ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.payrollService.getRun(organizationId, id);
  }
}
