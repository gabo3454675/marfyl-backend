import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { RegisterExpensePaymentDto } from './dto/register-expense-payment.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';
import { ActiveUser } from '@/common/decorators/active-user.decorator';

@Controller('expenses')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  create(
    @Body() createExpenseDto: CreateExpenseDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { sub: number },
  ) {
    return this.expensesService.create(createExpenseDto, organizationId, user.sub);
  }

  @Get()
  findAll(@ActiveOrganization() organizationId: number) {
    return this.expensesService.findAll(organizationId);
  }

  @Get('stats')
  getStats(@ActiveOrganization() organizationId: number) {
    return this.expensesService.getStats(organizationId);
  }

  @Get('accounts-payable')
  listAccountsPayable(@ActiveOrganization() organizationId: number) {
    return this.expensesService.listAccountsPayable(organizationId);
  }

  /** Plantilla Excel para importar factura de compra (SKU, cantidad, costo USD). */
  @Get('purchase-invoice-template')
  downloadPurchaseInvoiceTemplate(@Res() res: Response) {
    return this.expensesService.generatePurchaseInvoiceTemplateBuffer().then((buffer) => {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="factura-compra-plantilla.xlsx"',
      );
      res.send(buffer);
    });
  }

  /**
   * Importa factura de compra desde Excel o PDF: vista previa (confirm=false) o registro (confirm=true).
   * multipart: file, confirm, supplierId?, date?, referenceNumber?, description?, initialPayment?
   */
  @Post('import-purchase')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  importPurchaseInvoice(
    @UploadedFile() file: Express.Multer.File,
    @Body('confirm') confirm?: string,
    @Body('supplierId') rawSupplierId?: string,
    @Body('date') date?: string,
    @Body('referenceNumber') referenceNumber?: string,
    @Body('description') description?: string,
    @Body('initialPayment') rawInitialPayment?: string,
    @ActiveOrganization() organizationId?: number,
    @ActiveUser() user?: { sub: number },
  ) {
    if (!file) {
      throw new BadRequestException('Archivo requerido');
    }
    const confirmBool =
      confirm === 'true' ||
      confirm === '1' ||
      String(confirm || '').toLowerCase().trim() === 'true';

    let supplierId: number | undefined;
    if (rawSupplierId != null && String(rawSupplierId).trim() !== '') {
      const n = parseInt(String(rawSupplierId), 10);
      if (Number.isFinite(n)) supplierId = n;
    }

    let initialPayment: number | undefined;
    if (rawInitialPayment != null && String(rawInitialPayment).trim() !== '') {
      const ip = parseFloat(String(rawInitialPayment));
      if (Number.isFinite(ip) && ip > 0) initialPayment = ip;
    }

    return this.expensesService.importPurchaseInvoice({
      file,
      organizationId: organizationId!,
      userId: user!.sub,
      confirm: confirmBool,
      supplierId,
      date: date?.trim() || undefined,
      referenceNumber: referenceNumber?.trim() || undefined,
      description: description?.trim() || undefined,
      initialPayment,
    });
  }

  @Post(':id/payments')
  registerPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RegisterExpensePaymentDto,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.expensesService.registerPayment(id, organizationId, dto);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.expensesService.findOne(id, organizationId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateExpenseDto: UpdateExpenseDto,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.expensesService.update(id, updateExpenseDto, organizationId);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.expensesService.remove(id, organizationId);
  }
}
