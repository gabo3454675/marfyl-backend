import { InvoiceStatus, MovementType } from '@prisma/client';

/**
 * DTO para crear Invoice desde Hybrid.
 */
export interface CreateInvoiceFromHybridDto {
  legacyImportKey: string;
  importSource: 'hybrid';
  isLegacyImport: true;
  issueDate: Date;
  totalAmount: number;
  baseExempt: number;
  baseGeneral: number;
  baseReduced: number;
  ivaAmount: number;
  status: InvoiceStatus;
  paymentMethod: string;
  paymentStatus: 'paid' | 'PROCESSED_LEGACY';
  montoUsd: number;
  montoBs: number;
  tasaReferencia: number;
  notes: string;
  controlNumber?: string;
  items: CreateInvoiceItemFromHybridDto[];
}

export interface CreateInvoiceItemFromHybridDto {
  productId: number | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  taxRate: number;
  taxableBase: number;
  ivaLine: number;
  sourceHash: string;
  sourceLineKey: string;
  sourceSkuExact: string;
  sourceDescription: string;
  sourceQuantity: number;
  effectiveQuantity: number;
}

/**
 * DTO para crear/actualizar Product desde Hybrid.
 */
export interface CreateProductFromHybridDto {
  sku: string;
  name: string;
  description?: string;
  barcode?: string;
  costPrice: number;
  salePrice: number;
  salePriceCurrency: string;
  isExempt: boolean;
  isActive: boolean;
}

/**
 * DTO para crear/actualizar Customer desde Hybrid.
 */
export interface CreateCustomerFromHybridDto {
  name: string;
  taxId: string;
  phone?: string;
  email?: string;
  address?: string;
}

/**
 * DTO para movimiento de inventario desde Hybrid.
 */
export interface CreateInventoryMovementFromHybridDto {
  type: MovementType;
  quantity: number;
  productId: number;
  userId: number;
  tenantId: number;
  unitCostAtTransaction: number;
  reason: string;
}
