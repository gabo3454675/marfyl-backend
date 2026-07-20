import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
  Res,
  Header,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import { InvoicesService } from "./invoices.service";
import { LiquorSalesService } from "./liquor-sales.service";
import { CreateInvoiceDto } from "./dto/create-invoice.dto";
import { InvoiceHistoryQueryDto } from "./dto/history-query.dto";
import { VoidInvoiceDto, AdjustAmountDto } from "./dto/void-invoice.dto";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { PermissionsGuard } from "@/common/guards/permissions.guard";
import { AnyPermissionsGuard } from "@/common/guards/any-permissions.guard";
import { Permissions } from "@/common/decorators/permissions.decorator";
import { AnyPermissions } from "@/common/decorators/any-permissions.decorator";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { ActiveUser } from "@/common/decorators/active-user.decorator";

@Controller("invoices")
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly liquorSalesService: LiquorSalesService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @UseGuards(AnyPermissionsGuard)
  @AnyPermissions("canManageInvoices", "canAccessPOS")
  async create(
    @Body() createInvoiceDto: CreateInvoiceDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: any,
  ) {
    return this.invoicesService.create(
      createInvoiceDto,
      organizationId,
      user.id,
    );
  }

  @Get()
  @Permissions("canManageInvoices")
  async findAll(
    @ActiveOrganization() organizationId: number,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("search") search?: string,
    @Query("status") status?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : undefined;

    if (pageNum !== undefined && isNaN(pageNum)) {
      return this.invoicesService.findAll(organizationId);
    }

    if (pageNum !== undefined && pageNum > 0) {
      return this.invoicesService.findAllPaginated(organizationId, {
        page: pageNum,
        limit: limitNum,
        search,
        status,
      });
    }

    return this.invoicesService.findAll(organizationId);
  }

  /**
   * Obtiene facturas marcadas como pagadas por clientes (notificaciones)
   */
  @Get("client-marked-paid")
  async getClientMarkedAsPaid(@ActiveOrganization() organizationId: number) {
    return this.invoicesService.getClientMarkedAsPaid(organizationId);
  }

  /**
   * Historial de facturas por rango de fechas: resumen diario (total ventas, IGTF, por método de pago) y lista detallada.
   * Query: startDate, endDate (ISO 8601), opcional companyId u organizationId (solo superadmin puede consultar otra org).
   */
  @Get("history")
  async getHistory(
    @Query() query: InvoiceHistoryQueryDto,
    @ActiveOrganization() activeOrganizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    const requestedOrgId = query.organizationId ?? query.companyId;
    return this.invoicesService.getHistory(
      activeOrganizationId,
      user.id,
      query.startDate,
      query.endDate,
      requestedOrgId,
    );
  }

  /**
   * Reporte diario de licores: cerveza light/negra en tobos (12) y cajas (3 tobos),
   * whisky y otros por unidad. Query: day=YYYY-MM-DD (default: ayer Caracas).
   */
  @Get("liquor-sales")
  @Permissions("canManageInvoices")
  async getLiquorSales(
    @ActiveOrganization() organizationId: number,
    @Query("day") day?: string,
  ) {
    return this.liquorSalesService.getDailyReport(organizationId, day);
  }

  /**
   * Limpia el historial de ventas/facturación de la organización (solo super_admin, desarrollo).
   */
  @Post("clear-test-data")
  async clearTestData(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.invoicesService.clearTestData(organizationId, user.id);
  }

  @Delete(":id")
  @Permissions("canDeleteInvoices")
  async remove(
    @Param("id", ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.invoicesService.remove(id, organizationId, user.id);
  }

  @Get(":id/pdf")
  @Header("Content-Type", "application/pdf")
  @Header("Content-Disposition", 'inline; filename="factura.pdf"')
  async getPDF(
    @Param("id", ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
    @Res() res: Response,
  ) {
    try {
      const pdfBuffer = await this.invoicesService.generatePDF(
        id,
        organizationId,
      );
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="factura-${id}.pdf"`,
        "Content-Length": String(pdfBuffer.length),
      });
      res.send(pdfBuffer);
    } catch (err: any) {
      const status = err?.status ?? 500;
      const message = err?.message ?? "Error al generar el PDF";
      console.error("[PDF] Error generando factura", id, err?.stack || err);
      res.status(status).json({ message });
    }
  }

  @Get(":id")
  async findOne(
    @Param("id", ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
  ) {
    const invoice = await this.invoicesService.findOne(id, organizationId);
    // Agregar URL pública si existe el token
    const invoiceWithToken = invoice as typeof invoice & {
      publicToken?: string;
    };
    if (invoiceWithToken.publicToken) {
      const frontendUrl = this.configService.get<string>(
        "FRONTEND_URL",
        "http://localhost:3002",
      );
      return {
        ...invoice,
        publicUrl: `${frontendUrl}/pay/${invoiceWithToken.publicToken}`,
      };
    }
    return invoice;
  }

  /**
   * Anula una factura (soft-delete). Cumple con la normativa tributaria venezolana.
   * La factura pasa a estado CANCELLED, se preservan todos los datos y se registra en auditoría.
   */
  @Post(":id/void")
  @Permissions("canAnulateInvoices")
  @HttpCode(HttpStatus.OK)
  async voidInvoice(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: VoidInvoiceDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.invoicesService.voidInvoice(
      id,
      organizationId,
      user.id,
      dto.reason,
    );
  }

  /**
   * Ajusta el monto de una factura mediante nota de crédito.
   * Crea un registro de nota de crédito y actualiza el total de la factura original.
   */
  @Patch(":id/adjust-amount")
  @HttpCode(HttpStatus.OK)
  async adjustAmount(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: AdjustAmountDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.invoicesService.adjustAmount(
      id,
      dto.newAmount,
      organizationId,
      user.id,
      dto.reason,
    );
  }
}
