import { Controller, Get, Post, Param, Body, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Response } from "express";
import { InvoicesService } from "./invoices.service";
import { Public } from "@/common/decorators/public.decorator";

interface MarkAsPaidDto {
  markedBy?: string; // Nombre o email de quien marca como pagada
}

/**
 * Controlador para endpoints públicos de facturas
 * No requiere autenticación ni membresía de organización
 */
@Controller("invoices/public")
export class InvoicesPublicController {
  constructor(private readonly invoicesService: InvoicesService) {}

  /**
   * Obtiene los datos de una factura por su token público
   * Endpoint público - No requiere autenticación
   * @Throttle(30, 60) = 30 requests por minuto para prevenir enumeración
   */
  @Public()
  @Throttle({ long: { limit: 30, ttl: 60000 } })
  @Get(":token")
  async getPublicInvoice(@Param("token") token: string) {
    return this.invoicesService.findByPublicToken(token);
  }

  /**
   * Descarga el PDF de una factura por su token público
   * Endpoint público - No requiere autenticación
   * @Throttle(30, 60) = 30 requests por minuto para prevenir enumeración
   */
  @Public()
  @Throttle({ long: { limit: 30, ttl: 60000 } })
  @Get(":token/pdf")
  async getPublicPDF(@Param("token") token: string, @Res() res: Response) {
    const invoice = await this.invoicesService.findByPublicToken(token);
    const pdfBuffer = await this.invoicesService.generatePDF(
      invoice.id,
      invoice.organizationId,
    );
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="factura-${(invoice as { consecutiveNumber?: number }).consecutiveNumber ?? invoice.id}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  }

  /**
   * Marca una factura como pagada desde el link público
   * Endpoint público - No requiere autenticación
   * @Throttle(3, 60) = 3 intentos por minuto para prevenir abuse
   */
  @Public()
  @Throttle({ long: { limit: 3, ttl: 60000 } })
  @Post(":token/mark-paid")
  async markAsPaid(@Param("token") token: string, @Body() body: MarkAsPaidDto) {
    return this.invoicesService.markAsPaidByClient(token, body.markedBy);
  }
}
