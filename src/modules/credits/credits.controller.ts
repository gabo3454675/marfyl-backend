import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CreditsService } from './credits.service';
import { UpdateCreditLimitDto } from './dto/update-credit-limit.dto';
import { RegisterPaymentDto } from './dto/register-payment.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';
import { ActiveUser } from '@/common/decorators/active-user.decorator';

@Controller('credits')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  /**
   * Lista todas las cuentas de crédito de la organización (para panel de abonos).
   */
  @Get()
  list(@ActiveOrganization() organizationId: number) {
    return this.creditsService.listByOrganization(organizationId);
  }

  /**
   * Clientes con deuda vencida (IDs) para indicadores en UI.
   */
  @Get('overdue-customer-ids')
  async getOverdueCustomerIds(@ActiveOrganization() organizationId: number) {
    const ids = await this.creditsService.getCustomerIdsWithOverdueDebt(organizationId);
    return { customerIds: ids };
  }

  /**
   * Obtiene o crea el crédito de un cliente.
   */
  @Get('customer/:customerId')
  getByCustomer(
    @Param('customerId', ParseIntPipe) customerId: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.creditsService.getOrCreateCredit(customerId, organizationId);
  }

  /**
   * Actualiza el límite de crédito. Solo super_admin o admin.
   */
  @Patch(':creditId/limit')
  updateLimit(
    @Param('creditId', ParseIntPipe) creditId: number,
    @Body() dto: UpdateCreditLimitDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.creditsService.updateLimit(creditId, dto, organizationId, user.id);
  }

  /**
   * Registra un abono.
   */
  @Post(':creditId/payment')
  registerPayment(
    @Param('creditId', ParseIntPipe) creditId: number,
    @Body() dto: RegisterPaymentDto,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.creditsService.registerPayment(creditId, dto, organizationId);
  }

  /**
   * Historial de movimientos de un crédito.
   */
  @Get(':creditId/transactions')
  getTransactions(
    @Param('creditId', ParseIntPipe) creditId: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.creditsService.getTransactions(creditId, organizationId);
  }

  /**
   * Descarga PDF recibo de un abono.
   */
  @Get('transactions/:transactionId/receipt-pdf')
  async getReceiptPdf(
    @Param('transactionId', ParseIntPipe) transactionId: number,
    @ActiveOrganization() organizationId: number,
    @Res() res: Response,
  ) {
    const buffer = await this.creditsService.generatePaymentReceiptPdf(
      transactionId,
      organizationId,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="recibo-abono-${transactionId}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }
}
