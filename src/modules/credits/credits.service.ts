import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { CreditStatus, CreditTransactionType, PaymentStatus } from '@prisma/client';
import { UpdateCreditLimitDto } from './dto/update-credit-limit.dto';
import { RegisterPaymentDto } from './dto/register-payment.dto';
import { TaskStatus } from '@prisma/client';

// require() evita "default is not a constructor" en producción (CommonJS)
const PDFDocument = require('pdfkit');

@Injectable()
export class CreditsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Obtiene o crea la cuenta de crédito de un cliente en la organización.
   * Si no existe, crea una con límite 0 y status ACTIVE (el admin debe subir el límite).
   */
  async getOrCreateCredit(customerId: number, organizationId: number) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });
    if (!customer) {
      throw new NotFoundException('Cliente no encontrado');
    }

    let credit = await this.prisma.customerCredit.findUnique({
      where: { customerId },
      include: { customer: true },
    });

    if (!credit) {
      credit = await this.prisma.customerCredit.create({
        data: {
          customerId,
          organizationId,
          limitAmount: 50,
          currentBalance: 0,
          status: CreditStatus.ACTIVE,
          creditDueDays: 8,
        },
        include: { customer: true },
      });
    } else if (credit.organizationId !== organizationId) {
      throw new NotFoundException('Crédito no pertenece a esta organización');
    }

    return credit;
  }

  /**
   * Lista créditos de la organización (para panel de abonos).
   */
  async listByOrganization(organizationId: number) {
    return this.prisma.customerCredit.findMany({
      where: { organizationId },
      include: {
        customer: true,
      },
      orderBy: { customer: { name: 'asc' } },
    });
  }

  /**
   * Actualiza el límite de crédito. Solo super_admin o admin.
   */
  async updateLimit(
    creditId: number,
    dto: UpdateCreditLimitDto,
    organizationId: number,
    userId: number,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    const membership = await this.prisma.member.findFirst({
      where: { userId, organizationId, status: 'ACTIVE' },
    });
    const isAdmin =
      user?.isSuperAdmin ||
      (membership && (membership.role === 'ADMIN' || membership.role === 'SUPER_ADMIN'));
    if (!isAdmin) {
      throw new ForbiddenException(
        'Solo el Super Admin o un administrador pueden modificar el límite de crédito',
      );
    }

    const credit = await this.prisma.customerCredit.findFirst({
      where: { id: creditId, organizationId },
    });
    if (!credit) {
      throw new NotFoundException('Crédito no encontrado');
    }

    if (dto.limitAmount < Number(credit.currentBalance)) {
      throw new BadRequestException(
        'El límite no puede ser menor al saldo deudor actual',
      );
    }

    return this.prisma.customerCredit.update({
      where: { id: creditId },
      data: { limitAmount: dto.limitAmount },
      include: { customer: true },
    });
  }

  /**
   * Registra un CARGO por venta a crédito (llamado desde InvoicesService al crear factura con paymentMethod CREDIT).
   */
  async chargeForInvoice(
    customerId: number,
    organizationId: number,
    invoiceId: number,
    amountUsd: number,
    amountBs: number,
    exchangeRate: number,
  ) {
    const credit = await this.getOrCreateCredit(customerId, organizationId);
    if (credit.status !== CreditStatus.ACTIVE) {
      throw new BadRequestException('El crédito del cliente está suspendido');
    }
    const available = Number(credit.limitAmount) - Number(credit.currentBalance);
    if (available < amountUsd) {
      throw new BadRequestException('Límite de crédito insuficiente');
    }

    const newBalance = Number(credit.currentBalance) + amountUsd;
    await this.prisma.customerCredit.update({
      where: { id: credit.id },
      data: { currentBalance: newBalance },
    });

    return this.prisma.creditTransaction.create({
      data: {
        creditId: credit.id,
        invoiceId,
        type: CreditTransactionType.CHARGE,
        amountUsd,
        amountBs,
        exchangeRate,
        description: `Venta a crédito - Factura #${invoiceId}`,
      },
    });
  }

  /**
   * Registra un abono. Actualiza current_balance y, si se asocia a factura y queda saldada, marca la tarea de cobranza como DONE.
   */
  async registerPayment(
    creditId: number,
    dto: RegisterPaymentDto,
    organizationId: number,
  ) {
    const credit = await this.prisma.customerCredit.findFirst({
      where: { id: creditId, organizationId },
      include: { customer: true },
    });
    if (!credit) {
      throw new NotFoundException('Crédito no encontrado');
    }

    const balance = Number(credit.currentBalance);
    if (dto.amountUsd > balance) {
      throw new BadRequestException(
        'El abono no puede ser mayor al saldo deudor actual',
      );
    }

    const newBalance = balance - dto.amountUsd;
    const description =
      dto.description ?? (dto.invoiceId ? `Abono (Factura #${dto.invoiceId})` : 'Abono');

    await this.prisma.customerCredit.update({
      where: { id: creditId },
      data: { currentBalance: newBalance },
    });

    const created = await this.prisma.creditTransaction.create({
      data: {
        creditId,
        invoiceId: dto.invoiceId ?? undefined,
        type: CreditTransactionType.PAYMENT,
        amountUsd: dto.amountUsd,
        amountBs: dto.amountBs,
        exchangeRate: dto.exchangeRate,
        description,
      },
      include: {
        credit: { include: { customer: true } },
        invoice: true,
      },
    });

    if (dto.invoiceId) {
      await this.tryCloseCollectionTaskForInvoice(dto.invoiceId, organizationId);
    }

    return created;
  }

  /**
   * Si la factura ya está saldada (suma de abonos >= total), marca la tarea de cobranza como DONE.
   */
  private async tryCloseCollectionTaskForInvoice(
    invoiceId: number,
    organizationId: number,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
    });
    if (!invoice) return;

    const totalInvoice = Number(invoice.totalAmount);
    const sumPayments = await this.prisma.creditTransaction.aggregate({
      where: {
        invoiceId,
        type: CreditTransactionType.PAYMENT,
      },
      _sum: { amountUsd: true },
    });
    const paid = Number(sumPayments._sum.amountUsd ?? 0);
    if (paid < totalInvoice) return;

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { paymentStatus: PaymentStatus.paid },
    });

    await this.prisma.task.updateMany({
      where: {
        invoiceId,
        organizationId,
        category: 'COBRANZA',
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
      },
      data: { status: TaskStatus.DONE },
    });
  }

  /**
   * Historial de movimientos de un crédito.
   */
  async getTransactions(creditId: number, organizationId: number) {
    const credit = await this.prisma.customerCredit.findFirst({
      where: { id: creditId, organizationId },
    });
    if (!credit) {
      throw new NotFoundException('Crédito no encontrado');
    }

    return this.prisma.creditTransaction.findMany({
      where: { creditId },
      include: { invoice: { select: { id: true, totalAmount: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Clientes con deuda vencida (para indicador en lista de clientes).
   * Una tarea de cobranza con dueDate < hoy y no DONE implica deuda vencida para ese cliente (vía factura).
   */
  async getCustomerIdsWithOverdueDebt(organizationId: number): Promise<number[]> {
    const tasks = await this.prisma.task.findMany({
      where: {
        organizationId,
        category: 'COBRANZA',
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        dueDate: { lt: new Date() },
        invoiceId: { not: null },
      },
      select: {
        invoice: {
          select: { customerId: true },
        },
      },
    });
    const ids = new Set<number>();
    tasks.forEach((t) => {
      if (t.invoice?.customerId) ids.add(t.invoice.customerId);
    });
    return Array.from(ids);
  }

  /**
   * Genera PDF de recibo de abono.
   */
  async generatePaymentReceiptPdf(
    transactionId: number,
    organizationId: number,
  ): Promise<Buffer> {
    const transaction = await this.prisma.creditTransaction.findFirst({
      where: { id: transactionId },
      include: {
        credit: {
          include: {
            customer: true,
            organization: { select: { id: true, nombre: true } },
          },
        },
      },
    });

    if (!transaction || transaction.credit.organizationId !== organizationId) {
      throw new NotFoundException('Transacción no encontrada');
    }
    if (transaction.type !== CreditTransactionType.PAYMENT) {
      throw new BadRequestException('Solo se puede generar recibo de abonos');
    }

    const companyName = transaction.credit.organization.nombre || 'Empresa';
    const customer = transaction.credit.customer;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      doc.fontSize(20).text('RECIBO DE ABONO', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text(`Fecha: ${transaction.createdAt.toLocaleDateString('es-VE', { dateStyle: 'long' })}`, { align: 'center' });
      doc.text(`Hora: ${transaction.createdAt.toLocaleTimeString('es-VE')}`, { align: 'center' });
      doc.moveDown();
      doc.text(`${companyName}`, { align: 'center' });
      doc.moveDown(2);
      doc.text(`Cliente: ${customer.name}`);
      doc.text(`Concepto: ${transaction.description || 'Abono a cuenta por cobrar'}`);
      doc.moveDown();
      doc.fontSize(14).text(`Monto USD: $ ${Number(transaction.amountUsd).toFixed(2)}`, { align: 'left' });
      doc.text(`Monto BS: Bs. ${Number(transaction.amountBs).toFixed(2)} (Tasa: ${Number(transaction.exchangeRate).toFixed(2)})`, { align: 'left' });
      doc.moveDown(2);
      doc.fontSize(9).fillColor('#666').text(`Transacción #${transaction.id} · Generado el ${new Date().toLocaleString('es-VE')}`, { align: 'center' });
      doc.end();
    });
  }
}
