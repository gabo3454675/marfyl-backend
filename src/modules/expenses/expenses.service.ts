import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { getCompanyIdFromOrganization } from '@/common/helpers/organization.helper';
import type { PurchaseLineDto } from './dto/purchase-line.dto';
import * as ExcelJS from 'exceljs';
import pdfParse from 'pdf-parse';

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v && typeof (v as { toNumber: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  /** Suma abonos; si no hay filas y el gasto está PAID (histórico), se considera pagado al 100 %. */
  computeAmountPaid(expense: {
    amount: unknown;
    status: string;
    payments?: { amount: unknown }[];
  }): number {
    const paySum = (expense.payments ?? []).reduce((s, p) => s + num(p.amount), 0);
    if (paySum === 0 && expense.status === 'PAID') return num(expense.amount);
    return paySum;
  }

  enrichExpense<T extends { amount: unknown; status: string; payments?: { amount: unknown }[] }>(expense: T) {
    const amount = num(expense.amount);
    const amountPaid = this.computeAmountPaid(expense);
    const balanceDue = Math.max(0, Math.round((amount - amountPaid) * 100) / 100);
    return {
      ...expense,
      amountPaid,
      balanceDue,
    };
  }

  async create(createExpenseDto: CreateExpenseDto, organizationId: number, userId: number) {
    const { purchaseLines, initialPayment, ...rest } = createExpenseDto;

    const category = await this.prisma.expenseCategory.findFirst({
      where: {
        id: createExpenseDto.categoryId,
        organizationId,
      },
    });

    if (!category) {
      throw new NotFoundException(
        `Categoría con ID ${createExpenseDto.categoryId} no encontrada`,
      );
    }

    if (createExpenseDto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: {
          id: createExpenseDto.supplierId,
          organizationId,
        },
      });

      if (!supplier) {
        throw new NotFoundException(
          `Proveedor con ID ${createExpenseDto.supplierId} no encontrado`,
        );
      }
    }

    if (purchaseLines?.length && !userId) {
      throw new BadRequestException('Se requiere usuario autenticado para cargar inventario desde la compra.');
    }

    if (initialPayment != null && initialPayment > 0) {
      const total = num(createExpenseDto.amount);
      if (initialPayment > total + 0.01) {
        throw new BadRequestException('El abono inicial no puede superar el monto del gasto.');
      }
    }

    const companyId = await getCompanyIdFromOrganization(this.prisma, organizationId);

    const expense = await this.prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          ...rest,
          companyId,
          date: new Date(createExpenseDto.date),
          organizationId,
          status: createExpenseDto.status || 'PENDING',
        },
        include: {
          supplier: true,
          category: true,
          payments: true,
        },
      });

      if (purchaseLines?.length) {
        await this.applyPurchaseLinesTx(tx, {
          expenseId: created.id,
          organizationId,
          userId,
          companyId,
          lines: purchaseLines,
        });
      }

      if (initialPayment != null && initialPayment > 0) {
        await tx.expensePayment.create({
          data: {
            organizationId,
            expenseId: created.id,
            amount: initialPayment,
            notes: 'Abono al registrar el gasto',
          },
        });
        const total = num(created.amount);
        const paid = initialPayment;
        await tx.expense.update({
          where: { id: created.id },
          data: {
            status: paid >= total - 0.01 ? 'PAID' : 'PENDING',
          },
        });
      }

      return tx.expense.findFirst({
        where: { id: created.id, organizationId },
        include: { supplier: true, category: true, payments: true },
      });
    });

    if (!expense) {
      throw new NotFoundException('No se pudo crear el gasto');
    }

    return this.enrichExpense(expense);
  }

  private async applyPurchaseLinesTx(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    params: {
      expenseId: number;
      organizationId: number;
      userId: number;
      companyId: number;
      lines: PurchaseLineDto[];
    },
  ) {
    const { expenseId, organizationId, userId, lines } = params;

    for (const line of lines) {
      const product = await tx.product.findFirst({
        where: { id: line.productId, organizationId },
      });
      if (!product) {
        throw new NotFoundException(`Producto ${line.productId} no encontrado en la organización`);
      }
      if (product.isBundle) {
        throw new BadRequestException(
          `No se puede cargar inventario sobre el combo "${product.name}" (ID ${line.productId}). Use los productos sueltos.`,
        );
      }
      if (product.isService) {
        throw new BadRequestException(
          `No se puede cargar inventario sobre el servicio "${product.name}" (ID ${line.productId}).`,
        );
      }

      const unitCost = line.unitCostUsd ?? num(product.costPrice);
      const qty = line.quantity;

      await tx.inventoryMovement.create({
        data: {
          type: 'COMPRA',
          quantity: qty,
          reason: `Entrada por compra / factura proveedor (gasto #${expenseId})`,
          productId: line.productId,
          userId,
          tenantId: organizationId,
          unitCostAtTransaction: unitCost,
        },
      });

      await tx.product.update({
        where: { id: line.productId },
        data: {
          stock: { increment: qty },
          ...(line.unitCostUsd != null ? { costPrice: line.unitCostUsd } : {}),
        },
      });
    }
  }

  async findAll(organizationId: number) {
    const rows = await this.prisma.expense.findMany({
      where: {
        organizationId,
      },
      include: {
        supplier: true,
        category: true,
        payments: true,
      },
      orderBy: {
        date: 'desc',
      },
    });
    return rows.map((e) => this.enrichExpense(e));
  }

  async findOne(id: number, organizationId: number) {
    const expense = await this.prisma.expense.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        supplier: true,
        category: true,
        payments: true,
      },
    });

    if (!expense) {
      throw new NotFoundException(`Gasto con ID ${id} no encontrado`);
    }

    return this.enrichExpense(expense);
  }

  async registerPayment(
    id: number,
    organizationId: number,
    dto: { amount: number; notes?: string },
  ) {
    const expense = await this.findOne(id, organizationId);
    const total = num(expense.amount);
    const paid = this.computeAmountPaid(expense);
    const remaining = Math.max(0, total - paid);
    if (dto.amount > remaining + 0.01) {
      throw new BadRequestException(
        `El abono (${dto.amount.toFixed(2)}) supera el saldo pendiente (${remaining.toFixed(2)}).`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.expensePayment.create({
        data: {
          organizationId,
          expenseId: id,
          amount: dto.amount,
          notes: dto.notes ?? null,
        },
      });
      const after = paid + dto.amount;
      await tx.expense.update({
        where: { id },
        data: {
          status: after >= total - 0.01 ? 'PAID' : 'PENDING',
        },
      });
    });

    return this.findOne(id, organizationId);
  }

  /** Cuentas por pagar: gastos con saldo > 0 (proveedor / factura pendiente). */
  async listAccountsPayable(organizationId: number) {
    const rows = await this.findAll(organizationId);
    return rows.filter((e) => e.balanceDue > 0.01);
  }

  async update(id: number, updateExpenseDto: UpdateExpenseDto, organizationId: number) {
    await this.findOne(id, organizationId);

    if (updateExpenseDto.categoryId) {
      const category = await this.prisma.expenseCategory.findFirst({
        where: {
          id: updateExpenseDto.categoryId,
          organizationId,
        },
      });

      if (!category) {
        throw new NotFoundException(
          `Categoría con ID ${updateExpenseDto.categoryId} no encontrada`,
        );
      }
    }

    if (updateExpenseDto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: {
          id: updateExpenseDto.supplierId,
          organizationId,
        },
      });

      if (!supplier) {
        throw new NotFoundException(
          `Proveedor con ID ${updateExpenseDto.supplierId} no encontrado`,
        );
      }
    }

    const updateData: Record<string, unknown> = { ...updateExpenseDto };
    if (updateExpenseDto.date) {
      updateData.date = new Date(updateExpenseDto.date);
    }

    const updated = await this.prisma.expense.update({
      where: { id },
      data: updateData as any,
      include: {
        supplier: true,
        category: true,
        payments: true,
      },
    });

    return this.enrichExpense(updated);
  }

  async remove(id: number, organizationId: number) {
    await this.findOne(id, organizationId);

    return this.prisma.expense.delete({
      where: { id },
    });
  }

  async getStats(organizationId: number) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const totalExpenses = await this.prisma.expense.aggregate({
      where: {
        organizationId,
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _sum: {
        amount: true,
      },
    });

    const expensesByCategory = await this.prisma.expense.groupBy({
      by: ['categoryId'],
      where: {
        organizationId,
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _sum: {
        amount: true,
      },
    });

    const categoryIds = expensesByCategory.map((e) => e.categoryId);
    const categories = await this.prisma.expenseCategory.findMany({
      where: {
        id: { in: categoryIds },
        organizationId,
      },
    });

    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

    const inventoryCategory = await this.prisma.expenseCategory.findFirst({
      where: {
        organizationId,
        name: 'Inventario',
      },
    });

    let inventoryTotal = 0;
    if (inventoryCategory) {
      const inventoryExpenses = await this.prisma.expense.aggregate({
        where: {
          organizationId,
          categoryId: inventoryCategory.id,
          date: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
        _sum: {
          amount: true,
        },
      });
      inventoryTotal = Number(inventoryExpenses._sum.amount || 0);
    }

    const operationalTotal = Number(totalExpenses._sum.amount || 0) - inventoryTotal;

    const categoryBreakdown = expensesByCategory.map((exp) => ({
      categoryId: exp.categoryId,
      categoryName: categoryMap.get(exp.categoryId) || 'Desconocida',
      amount: Number(exp._sum.amount || 0),
    }));

    return {
      totalMonth: Number(totalExpenses._sum.amount || 0),
      inventoryTotal,
      operationalTotal,
      categoryBreakdown,
    };
  }

  /** Plantilla Excel para importar facturas de compra (SKU o código de barras, cantidad, costo USD). */
  async generatePurchaseInvoiceTemplateBuffer(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DISIS';
    const ws = workbook.addWorksheet('Factura compra');
    const headers = ['SKU_O_CODIGO_BARRAS', 'CANTIDAD', 'COSTO_UNITARIO_USD'];
    ws.addRow(headers);
    const hr = ws.getRow(1);
    hr.font = { bold: true };
    ws.addRow(['EJ-SKU-001', 12, 4.5]);
    ws.columns = [{ width: 22 }, { width: 12 }, { width: 18 }];
    ws.getCell('A1').note =
      'Use el mismo SKU o código de barras que en Inventario. Si omite costo, se usa el costo actual del producto.';
    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }

  private normalizeSkuKey(s: string): string {
    return s.trim().toUpperCase();
  }

  private parseFlexibleNumber(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value).trim().replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }

  private async resolveInventoryCategoryId(organizationId: number): Promise<number> {
    let cat = await this.prisma.expenseCategory.findFirst({
      where: { organizationId, name: { equals: 'Inventario', mode: 'insensitive' } },
    });
    if (!cat) {
      cat = await this.prisma.expenseCategory.findFirst({
        where: { organizationId, name: { contains: 'inventario', mode: 'insensitive' } },
      });
    }
    if (!cat) {
      throw new BadRequestException(
        'No existe una categoría de gasto de inventario. Cree una categoría llamada «Inventario» o similar.',
      );
    }
    return cat.id;
  }

  /**
   * Importa factura de compra desde Excel o PDF.
   * Excel: columnas flexibles (fila 1 = encabezados) — código, cantidad, costo unitario USD (opcional).
   * PDF: texto por líneas; se intenta detectar líneas tipo «código cantidad costo» (mejor resultado con PDFs de tabla simples).
   */
  async importPurchaseInvoice(params: {
    file: Express.Multer.File;
    organizationId: number;
    userId: number;
    confirm?: boolean;
    supplierId?: number;
    date?: string;
    referenceNumber?: string;
    description?: string;
    initialPayment?: number;
  }) {
    const { file, organizationId, userId } = params;
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo no válido');
    }

    const ext = (file.originalname || '').toLowerCase().split('.').pop() || '';
    const isExcel = ext === 'xlsx' || ext === 'xls';
    const isPdf = ext === 'pdf';

    if (!isExcel && !isPdf) {
      throw new BadRequestException('Use un archivo Excel (.xlsx, .xls) o PDF (.pdf).');
    }

    const products = await this.prisma.product.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        costPrice: true,
        isBundle: true,
        isService: true,
      },
    });
    const bySku = new Map<string, (typeof products)[0]>();
    const byBarcode = new Map<string, (typeof products)[0]>();
    for (const p of products) {
      if (p.sku) bySku.set(this.normalizeSkuKey(p.sku), p);
      if (p.barcode) byBarcode.set(this.normalizeSkuKey(p.barcode), p);
    }

    const resolveProduct = (code: string): (typeof products)[0] | null => {
      const k = this.normalizeSkuKey(code);
      return bySku.get(k) ?? byBarcode.get(k) ?? null;
    };

    type RawRow = { rowNum?: number; line?: number; code: string; qty: number; unitCost: number | null };
    const rawRows: RawRow[] = [];
    const parseErrors: { row?: number; line?: number; message: string }[] = [];

    if (isExcel) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as any);
      const worksheet = workbook.worksheets[0];
      if (!worksheet || worksheet.rowCount < 2) {
        throw new BadRequestException('El Excel debe tener encabezados y al menos una fila de datos.');
      }

      const headerRow = worksheet.getRow(1);
      const headers: string[] = [];
      const lastCol = Math.min(headerRow.cellCount || 20, 30);
      for (let c = 1; c <= lastCol; c++) {
        headers[c - 1] = String(headerRow.getCell(c).value ?? '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();
      }

      const findCol = (candidates: string[]): number => {
        for (let i = 0; i < headers.length; i++) {
          const h = headers[i] || '';
          if (!h) continue;
          for (const c of candidates) {
            if (h === c || h.includes(c)) return i;
          }
        }
        return -1;
      };

      const colCode = findCol(['sku_o_codigo_barras', 'sku', 'codigo', 'codigo de barras', 'barcode', 'ref']);
      const colQty = findCol(['cantidad', 'qty', 'quantity', 'uds', 'unidades']);
      const colCost = findCol([
        'costo_unitario_usd',
        'costo',
        'costo unitario',
        'precio costo',
        'unit cost',
        'p. costo',
      ]);

      if (colCode < 0 || colQty < 0) {
        throw new BadRequestException(
          'No se encontraron columnas obligatorias. Incluya encabezados reconocibles: código/SKU y CANTIDAD.',
        );
      }

      for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
        const row = worksheet.getRow(rowNum);
        const code = String(row.getCell(colCode + 1)?.value ?? '').trim();
        const qtyNum = this.parseFlexibleNumber(row.getCell(colQty + 1)?.value);
        const costCell = colCost >= 0 ? row.getCell(colCost + 1)?.value : null;
        const unitCost = costCell != null && String(costCell).trim() !== '' ? this.parseFlexibleNumber(costCell) : null;

        if (!code && (qtyNum == null || qtyNum === 0)) continue;

        if (!code) {
          parseErrors.push({ row: rowNum, message: 'Falta código/SKU en una fila con cantidad.' });
          continue;
        }
        if (qtyNum == null || qtyNum < 1 || !Number.isFinite(qtyNum)) {
          parseErrors.push({ row: rowNum, message: `Cantidad inválida para "${code}"` });
          continue;
        }
        const qty = Math.floor(qtyNum);
        if (Math.abs(qtyNum - qty) > 0.0001) {
          parseErrors.push({ row: rowNum, message: `La cantidad debe ser entera para "${code}"` });
          continue;
        }

        rawRows.push({
          rowNum,
          code,
          qty,
          unitCost: unitCost != null && unitCost >= 0 ? unitCost : null,
        });
      }
    } else {
      // pdf-parse 1.x: ligero y compatible con Node 18 (v2/pdfjs en Render rompe process.getBuiltinModule)
      const buf = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
      const pdfData = await pdfParse(buf);
      const text = pdfData.text || '';

      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let lineNo = 0;
      for (const line of lines) {
        lineNo++;
        const tabParts = line.split('\t').map((p) => p.trim()).filter(Boolean);
        let parts: string[];
        if (tabParts.length >= 3) {
          parts = tabParts;
        } else {
          parts = line.split(/\s+/).filter(Boolean);
        }
        if (parts.length < 3) continue;

        const code = parts[0];
        if (!/^[\w.\-]+$/i.test(code) || code.length > 80) continue;

        const qtyNum = this.parseFlexibleNumber(parts[1]);
        const unitCost = this.parseFlexibleNumber(parts[2]);
        if (qtyNum == null || qtyNum < 1) continue;
        const qty = Math.floor(qtyNum);
        if (Math.abs(qtyNum - qty) > 0.0001) continue;
        if (unitCost == null || unitCost < 0) continue;

        rawRows.push({ line: lineNo, code, qty, unitCost });
      }

      if (rawRows.length === 0) {
        throw new BadRequestException(
          'No se pudieron leer líneas de compra desde el PDF. Use la plantilla Excel o un PDF con una línea por ítem: CODIGO CANTIDAD COSTO (separados por espacios o tabuladores).',
        );
      }
    }

    const merged = new Map<
      number,
      { productId: number; quantity: number; unitCostUsd?: number; name: string; sku: string | null }
    >();

    const unmatched: { row?: number; line?: number; code: string; reason: string }[] = [];

    for (const r of rawRows) {
      const p = resolveProduct(r.code);
      if (!p) {
        unmatched.push({
          row: r.rowNum,
          line: r.line,
          code: r.code,
          reason: 'No hay producto con ese SKU o código de barras',
        });
        continue;
      }
      if (p.isBundle) {
        unmatched.push({
          row: r.rowNum,
          line: r.line,
          code: r.code,
          reason: 'Es un combo; cargue los productos sueltos',
        });
        continue;
      }
      if (p.isService) {
        unmatched.push({
          row: r.rowNum,
          line: r.line,
          code: r.code,
          reason: 'Es un servicio (sin inventario)',
        });
        continue;
      }

      const defaultCost = num(p.costPrice);
      const unit = r.unitCost != null && r.unitCost >= 0 ? r.unitCost : defaultCost;
      if (unit < 0 || !Number.isFinite(unit)) {
        parseErrors.push({
          row: r.rowNum,
          line: r.line,
          message: `Costo inválido para "${p.name}"`,
        });
        continue;
      }

      const prev = merged.get(p.id);
      if (prev) {
        const newQ = prev.quantity + r.qty;
        const prevTotal = prev.quantity * (prev.unitCostUsd ?? 0);
        const addTotal = r.qty * unit;
        const wAvg = (prevTotal + addTotal) / newQ;
        merged.set(p.id, {
          ...prev,
          quantity: newQ,
          unitCostUsd: Math.round(wAvg * 10000) / 10000,
        });
      } else {
        merged.set(p.id, {
          productId: p.id,
          quantity: r.qty,
          unitCostUsd: unit,
          name: p.name,
          sku: p.sku,
        });
      }
    }

    const purchaseLines: PurchaseLineDto[] = [...merged.values()].map((m) => ({
      productId: m.productId,
      quantity: m.quantity,
      unitCostUsd: m.unitCostUsd,
    }));

    let totalAmount = 0;
    const linesPreview = [...merged.values()].map((m) => {
      const lineTotal = m.quantity * (m.unitCostUsd ?? 0);
      totalAmount += lineTotal;
      return {
        productId: m.productId,
        name: m.name,
        sku: m.sku,
        quantity: m.quantity,
        unitCostUsd: m.unitCostUsd ?? 0,
        lineTotal: Math.round(lineTotal * 100) / 100,
      };
    });
    totalAmount = Math.round(totalAmount * 100) / 100;

    const blocking = parseErrors.length > 0 || unmatched.length > 0;

    if (!params.confirm) {
      return {
        dryRun: true,
        totalAmount,
        lines: linesPreview,
        errors: parseErrors,
        unmatched,
        canConfirm: purchaseLines.length > 0 && !blocking,
      };
    }

    if (purchaseLines.length === 0) {
      throw new BadRequestException('No hay líneas válidas para registrar el gasto.');
    }
    if (blocking) {
      throw new BadRequestException(
        'Corrija los errores del archivo antes de confirmar (revise la vista previa).',
      );
    }

    const categoryId = await this.resolveInventoryCategoryId(organizationId);
    const dateStr = params.date || new Date().toISOString().split('T')[0];
    const desc =
      params.description?.trim() ||
      `Compra de inventario importada (${isExcel ? 'Excel' : 'PDF'})`;

    const dto: CreateExpenseDto = {
      date: dateStr,
      amount: totalAmount,
      description: desc,
      referenceNumber: params.referenceNumber,
      categoryId,
      supplierId: params.supplierId,
      status: 'PENDING',
      purchaseLines,
      initialPayment:
        params.initialPayment != null && params.initialPayment > 0 ? params.initialPayment : undefined,
    };

    return this.create(dto, organizationId, userId);
  }
}
