import { InvoiceStatus } from '@prisma/client';

/**
 * Resultado de una operación de importación.
 */
export interface ImportResult {
  imported: number;
  skipped: SkippedItem[];
  errors: ImportError[];
  warnings: ImportWarning[];
}

export interface SkippedItem {
  key: string;
  reason: 'already_imported' | 'validation_error' | 'status_not_importable';
  details?: string;
}

export interface ImportError {
  key: string;
  error: string;
  code: string;
}

export interface ImportWarning {
  key: string;
  message: string;
  code: string;
}

/**
 * Resultado del preview (antes de confirmar).
 */
export interface HybridImportPreviewResult {
  batchId: string;
  organizationId: number;
  summary: HybridImportSummary;
  invoices: HybridImportInvoicePreview[];
}

export interface HybridImportSummary {
  ventas: number;
  lineas: number;
  ready: number;
  warnings: number;
  errors: number;
  alreadyImported: number;
}

export interface HybridImportInvoicePreview {
  documento: string;
  fecha: string;
  cliente: string;
  status: 'ready' | 'warning' | 'error' | 'already_imported';
  hybridStatus: number;
  marfylStatus: InvoiceStatus;
  totalAmount: number;
  lineCount: number;
  issues: string[];
  lines: HybridImportLinePreview[];
}

export interface HybridImportLinePreview {
  codigo: string;
  nombre: string;
  cantidad: number;
  importe: number;
  productId?: number;
  productName?: string;
  matchBy?: 'sku' | 'barcode' | 'name' | 'none';
}
