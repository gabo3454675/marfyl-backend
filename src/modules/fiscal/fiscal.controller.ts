import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { FiscalService } from "./fiscal.service";
import { FiscalCalendarService } from "./fiscal-calendar.service";
import { FiscalComplianceHubService } from "./fiscal-compliance-hub.service";
import { FiscalValidationService } from "./fiscal-validation.service";
import { FiscalEventsService } from "./fiscal-events.service";
import { FiscalAuditService } from "./fiscal-audit.service";
import { FiscalNormsService } from "./fiscal-norms.service";
import { UpsertFiscalProfileDto } from "./dto/upsert-fiscal-profile.dto";
import { EmitFiscalEventDto } from "./dto/emit-fiscal-event.dto";
import { PreventiveValidationDto } from "./dto/preventive-validation.dto";
import { QueryLibroDto } from "./dto/query-libro.dto";
import { CargaRapidaCompraDto } from "./dto/carga-rapida-compra.dto";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { VerificarRolFiscalGuard } from "@/common/guards/verificar-rol-fiscal.guard";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { ActiveUser } from "@/common/decorators/active-user.decorator";

@Controller("fiscal")
@UseGuards(JwtAuthGuard, OrganizationGuard, VerificarRolFiscalGuard)
export class FiscalController {
  constructor(
    private readonly fiscalService: FiscalService,
    private readonly fiscalCalendar: FiscalCalendarService,
    private readonly complianceHub: FiscalComplianceHubService,
    private readonly validation: FiscalValidationService,
    private readonly fiscalEvents: FiscalEventsService,
    private readonly fiscalAudit: FiscalAuditService,
    private readonly fiscalNorms: FiscalNormsService,
  ) {}

  @Get("dashboard")
  dashboard(
    @ActiveOrganization() organizationId: number,
    @Query() query: QueryLibroDto,
  ) {
    return this.fiscalService.getDashboard(organizationId, query);
  }

  @Get("calendario")
  calendario(
    @ActiveOrganization() organizationId: number,
    @Query() query: QueryLibroDto,
  ) {
    const now = new Date();
    const year = query.year ?? now.getFullYear();
    const month = query.month ?? now.getMonth() + 1;
    return this.fiscalCalendar.listCalendar(organizationId, year, month);
  }

  @Post("calendario/sync")
  async syncCalendario(
    @Query("force") force?: string,
    @ActiveUser() user?: { id: number },
  ) {
    const cal = await this.fiscalCalendar.syncSeniatRulesFromJson(
      force === "true",
    );
    const norms = await this.fiscalNorms.syncNormsFromCalendarJson(user?.id);
    return { ...cal, norms };
  }

  @Get("compliance/hub")
  getComplianceHub(
    @ActiveOrganization() organizationId: number,
    @Query() query: QueryLibroDto,
  ) {
    const now = new Date();
    const year = query.year ?? now.getFullYear();
    const month = query.month ?? now.getMonth() + 1;
    return this.complianceHub.getHub(organizationId, year, month);
  }

  @Post("compliance/validate")
  validateOperation(
    @ActiveOrganization() organizationId: number,
    @Body() dto: PreventiveValidationDto,
  ) {
    return this.validation.validate({
      organizationId,
      operation: dto.operation,
      taxId: dto.taxId,
      documentDate: dto.documentDate ? new Date(dto.documentDate) : undefined,
      controlNumber: dto.controlNumber,
      amountBs: dto.amountBs,
    });
  }

  @Post("compliance/events")
  emitEvent(
    @ActiveOrganization() organizationId: number,
    @Body() dto: EmitFiscalEventDto,
    @ActiveUser() user: { id: number },
  ) {
    return this.fiscalEvents.emit({
      organizationId,
      eventType: dto.eventType,
      entityType: dto.entityType,
      entityId: dto.entityId,
      payload: dto.payload,
      userId: user.id,
      auditAction: "FISCAL_EVENT_EMIT",
    });
  }

  @Get("compliance/audit")
  listAudit(
    @ActiveOrganization() organizationId: number,
    @Query("limit") limit?: string,
  ) {
    return this.fiscalAudit.listRecent(
      organizationId,
      limit ? Number(limit) : 25,
    );
  }

  @Get("compliance/norms")
  listNorms() {
    return this.fiscalNorms.listActive();
  }

  @Post("compliance/norms/sync")
  syncNorms(@ActiveUser() user: { id: number }) {
    return this.fiscalNorms.syncNormsFromCalendarJson(user.id);
  }

  @Post("backfill/libro-ventas")
  backfillVentas(
    @ActiveOrganization() organizationId: number,
    @Query() query: QueryLibroDto,
    @Query("limit") limit?: string,
  ) {
    return this.fiscalService.backfillLibroVentas(organizationId, {
      year: query.year,
      month: query.month,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("profile")
  getProfile(@ActiveOrganization() organizationId: number) {
    return this.fiscalService.getProfile(organizationId);
  }

  @Post("profile")
  upsertProfile(
    @ActiveOrganization() organizationId: number,
    @Body() dto: UpsertFiscalProfileDto,
    @ActiveUser() user: { id: number },
  ) {
    return this.fiscalService.upsertProfile(organizationId, dto, user.id);
  }

  @Get("libro-ventas")
  libroVentas(
    @ActiveOrganization() organizationId: number,
    @Query() query: QueryLibroDto,
  ) {
    return this.fiscalService.listLibroVentas(organizationId, query);
  }

  @Get("libro-ventas/export.xlsx")
  async exportVentasXlsx(
    @ActiveOrganization() organizationId: number,
    @Query() query: QueryLibroDto,
    @Res() res: Response,
  ) {
    const buf = await this.fiscalService.exportLibroVentasXlsx(
      organizationId,
      query,
    );
    const y = query.year ?? new Date().getFullYear();
    const m = query.month ?? new Date().getMonth() + 1;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="libro-ventas-${y}-${String(m).padStart(2, "0")}.xlsx"`,
    );
    res.send(buf);
  }

  @Get("libro-ventas/export.txt")
  async exportVentasTxt(
    @ActiveOrganization() organizationId: number,
    @Query() query: QueryLibroDto,
    @Res() res: Response,
  ) {
    const txt = await this.fiscalService.exportLibroVentasTxt(
      organizationId,
      query,
    );
    const y = query.year ?? new Date().getFullYear();
    const m = query.month ?? new Date().getMonth() + 1;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="libro-ventas-${y}-${String(m).padStart(2, "0")}.txt"`,
    );
    res.send(txt);
  }

  @Get("libro-compras")
  libroCompras(
    @ActiveOrganization() organizationId: number,
    @Query() query: QueryLibroDto,
  ) {
    return this.fiscalService.listLibroCompras(organizationId, query);
  }

  @Get("retenciones")
  retenciones(
    @ActiveOrganization() organizationId: number,
    @Query() query: QueryLibroDto,
  ) {
    return this.fiscalService.listRetenciones(organizationId, query);
  }

  @Get("retenciones/export.txt")
  async exportRetencionesTxt(
    @ActiveOrganization() organizationId: number,
    @Query() query: QueryLibroDto,
    @Res() res: Response,
  ) {
    const txt = await this.fiscalService.exportRetencionesTxt(
      organizationId,
      query,
    );
    const y = query.year ?? new Date().getFullYear();
    const m = query.month ?? new Date().getMonth() + 1;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="retenciones-${y}-${String(m).padStart(2, "0")}.txt"`,
    );
    res.send(txt);
  }

  @Get("retenciones/:id/pdf")
  async retencionPdf(
    @ActiveOrganization() organizationId: number,
    @Param("id", ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const buf = await this.fiscalService.getRetencionPdf(organizationId, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="retencion-${id}.pdf"`,
    );
    res.send(buf);
  }

  @Get("retenciones/:id")
  retencionDetail(
    @ActiveOrganization() organizationId: number,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.fiscalService.getRetencion(organizationId, id);
  }

  @Post("compras/carga-rapida")
  cargaRapida(
    @ActiveOrganization() organizationId: number,
    @Body() dto: CargaRapidaCompraDto,
  ) {
    return this.fiscalService.cargaRapidaCompra(organizationId, dto);
  }

  @Get("predeclaracion")
  predeclaracion(
    @ActiveOrganization() organizationId: number,
    @Query() query: QueryLibroDto,
  ) {
    return this.fiscalService.getPredeclaracion(organizationId, query);
  }

  @Post("periods/:year/:month/close")
  closePeriod(
    @ActiveOrganization() organizationId: number,
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.fiscalService.closePeriod(
      organizationId,
      year,
      month,
      user.id,
    );
  }
}
