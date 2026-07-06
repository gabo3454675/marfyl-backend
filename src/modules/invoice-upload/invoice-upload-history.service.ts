import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { num } from "@/common/helpers/number.helper";
import { buildMovementReasonSearchPattern } from "./invoice-upload.constants";

@Injectable()
export class InvoiceUploadHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Lean history list ────────────────────────────────────────────────

  async getHistory(
    organizationId: number,
    params?: { page?: number; limit?: number; dateFrom?: string; dateTo?: string },
  ) {
    const page = Math.max(params?.page ?? 1, 1);
    const limit = Math.min(Math.max(params?.limit ?? 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {
      organizationId,
      OR: [
        { description: { contains: "Compra", mode: "insensitive" } },
        { description: { contains: "Importación", mode: "insensitive" } },
      ],
    };

    if (params?.dateFrom) {
      where.date = { ...where.date, gte: new Date(params.dateFrom) };
    }
    if (params?.dateTo) {
      const endDate = new Date(params.dateTo);
      endDate.setHours(23, 59, 59, 999);
      where.date = { ...where.date, lte: endDate };
    }

    const [items, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        select: {
          id: true,
          date: true,
          amount: true,
          description: true,
          referenceNumber: true,
          status: true,
          createdAt: true,
          supplier: { select: { id: true, name: true } },
        },
        orderBy: { date: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return {
      items: items.map((e) => ({
        id: e.id,
        date: e.date,
        amount: Number(e.amount),
        description: e.description,
        referenceNumber: e.referenceNumber,
        status: e.status,
        supplier: e.supplier,
        createdAt: e.createdAt,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  // ── Full detail with products, payments, tax breakdown ───────────────

  async getHistoryDetail(organizationId: number, expenseId: number) {
    // Parallelize: expense + movements fetch simultaneously
    const [expense, movements] = await Promise.all([
      this.prisma.expense.findFirst({
        where: { id: expenseId, organizationId },
        include: {
          supplier: { select: { id: true, name: true, taxId: true, email: true, phone: true } },
          category: { select: { id: true, name: true } },
          payments: { select: { id: true, amount: true, paidAt: true, notes: true }, orderBy: { paidAt: "asc" } },
        },
      }),
      this.prisma.inventoryMovement.findMany({
        where: { reason: { contains: buildMovementReasonSearchPattern(expenseId) } },
        include: { product: { select: { id: true, name: true, sku: true } } },
        orderBy: { createdAt: "asc" },
      } as any),
    ]);

    if (!expense) {
      throw new NotFoundException(`Gasto con ID ${expenseId} no encontrado`);
    }

    const amountPaid = expense.payments.reduce((sum, p) => sum + num(p.amount), 0);

    return {
      id: expense.id,
      date: expense.date,
      amount: num(expense.amount),
      description: expense.description,
      referenceNumber: expense.referenceNumber,
      status: expense.status,
      supplier: expense.supplier,
      category: expense.category,
      baseExempt: num(expense.baseExempt),
      baseReduced: num(expense.baseReduced),
      baseGeneral: num(expense.baseGeneral),
      ivaAmount: num(expense.ivaAmount),
      supplierControlNumber: expense.supplierControlNumber,
      supplierInvoiceNumber: expense.supplierInvoiceNumber,
      payments: expense.payments.map((p) => ({
        id: p.id,
        amount: num(p.amount),
        paidAt: p.paidAt,
        notes: p.notes,
      })),
      amountPaid,
      products: movements.map((m: any) => ({
        productId: m.productId,
        productName: m.product?.name ?? null,
        productSku: m.product?.sku ?? null,
        quantity: m.quantity,
        unitCost: m.unitCostAtTransaction != null ? num(m.unitCostAtTransaction) : null,
        total: m.unitCostAtTransaction != null ? num(m.unitCostAtTransaction) * m.quantity : null,
      })),
      createdAt: expense.createdAt,
    };
  }
}
