import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
  Res,
  Header,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceHistoryQueryDto } from './dto/history-query.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';
import { ActiveUser } from '@/common/decorators/active-user.decorator';

@Controller('invoices')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  async create(
    @Body() createInvoiceDto: CreateInvoiceDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: any,
  ) {
    return this.invoicesService.create(createInvoiceDto, organizationId, user.id);
  }

  @Get()
  async findAll(@ActiveOrganization() organizationId: number) {
    return this.invoicesService.findAll(organizationId);
  }

  /**
   * Obtiene facturas marcadas como pagadas por clientes (notificaciones)
   */
  @Get('client-marked-paid')
  async getClientMarkedAsPaid(@ActiveOrganization() organizationId: number) {
    return this.invoicesService.getClientMarkedAsPaid(organizationId);
  }

  /**
   * Historial de facturas por rango de fechas: resumen diario (total ventas, IGTF, por método de pago) y lista detallada.
   * Query: startDate, endDate (ISO 8601), opcional companyId u organizationId (solo superadmin puede consultar otra org).
   */
  @Get('history')
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
   * Limpia el historial de ventas/facturación de la organización (solo super_admin, desarrollo).
   */
  @Post('clear-test-data')
  async clearTestData(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.invoicesService.clearTestData(organizationId, user.id);
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.invoicesService.remove(id, organizationId, user.id);
  }

  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'inline; filename="factura.pdf"')
  async getPDF(
    @Param('id', ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
    @Res() res: Response,
  ) {
    try {
      const pdfBuffer = await this.invoicesService.generatePDF(id, organizationId);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="factura-${id}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      });
      res.send(pdfBuffer);
    } catch (err: any) {
      const status = err?.status ?? 500;
      const message = err?.message ?? 'Error al generar el PDF';
      console.error('[PDF] Error generando factura', id, err?.stack || err);
      res.status(status).json({ message });
    }
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
  ) {
    const invoice = await this.invoicesService.findOne(id, organizationId);
    // Agregar URL pública si existe el token
    const invoiceWithToken = invoice as typeof invoice & { publicToken?: string };
    if (invoiceWithToken.publicToken) {
      const frontendUrl = this.configService.get<string>(
        'FRONTEND_URL',
        'http://localhost:3002',
      );
      return {
        ...invoice,
        publicUrl: `${frontendUrl}/pay/${invoiceWithToken.publicToken}`,
      };
    }
    return invoice;
  }
}
