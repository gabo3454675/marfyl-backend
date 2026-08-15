import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { HybridAdapter, ValidationResult } from './hybrid-adapter.interface';
import type { HybridVentaDetailInput, HybridVentaLineaInput } from '../types/hybrid-input.types';
import type { CreateInvoiceFromHybridDto, CreateInvoiceItemFromHybridDto } from '../types/hybrid-output.types';
import type { ImportContext } from '../types/import-context';
import { ventaDedupKey } from './dedup-keys';
import { mapHybridStatus, isImportableStatus } from './status.mapper';

@Injectable()
export class VentaAdapter implements HybridAdapter<HybridVentaDetailInput, CreateInvoiceFromHybridDto> {
  
  transform(input: HybridVentaDetailInput, context: ImportContext): CreateInvoiceFromHybridDto {
    const status = mapHybridStatus(input.status);
    const issueDate = new Date(input.fecha);
    
    // Calcular base imponible
    const baseExempt = input.exento || 0;
    const baseGeneral = input.bruto || 0;
    const ivaAmount = input.impuesto || 0;
    
    // Convertir a USD si es necesario
    const tasaReferencia = context.exchangeRate;
    const montoOriginal = input.neto || 0;
    const montoUsd = context.currencyCode === 'USD' ? montoOriginal : montoOriginal / tasaReferencia;
    const montoBs = context.currencyCode === 'VES' ? montoOriginal : montoOriginal * tasaReferencia;
    
    return {
      legacyImportKey: ventaDedupKey(input.documento),
      importSource: 'hybrid',
      isLegacyImport: true,
      issueDate,
      totalAmount: montoUsd,
      baseExempt,
      baseGeneral,
      baseReduced: 0,
      ivaAmount,
      status,
      paymentMethod: 'CASH',
      paymentStatus: status === 'PAID' ? 'paid' : 'PROCESSED_LEGACY',
      montoUsd,
      montoBs,
      tasaReferencia,
      notes: `Importado desde Hybrid. Documento: ${input.documento}. Caja: ${input.caja}. Serie: ${input.serie}. Clasificación: ${input.clasificacion}`,
      controlNumber: input.serie || undefined,
      items: input.lineas.map((linea) => this.transformLinea(linea, input, context)),
    };
  }

  getDedupKey(input: HybridVentaDetailInput): string {
    return ventaDedupKey(input.documento);
  }

  validate(input: HybridVentaDetailInput): ValidationResult {
    const errors: ValidationResult['errors'] = [];

    if (!input.documento?.trim()) {
      errors.push({ field: 'documento', message: 'Documento es requerido', code: 'REQUIRED' });
    }

    if (!input.fecha) {
      errors.push({ field: 'fecha', message: 'Fecha es requerida', code: 'REQUIRED' });
    }

    if (!input.lineas || input.lineas.length === 0) {
      errors.push({ field: 'lineas', message: 'Venta sin líneas de detalle', code: 'EMPTY_LINES' });
    }

    if (!isImportableStatus(input.status)) {
      errors.push({ field: 'status', message: `Status ${input.status} no es importable`, code: 'STATUS_NOT_IMPORTABLE' });
    }

    return { valid: errors.length === 0, errors };
  }

  private transformLinea(
    linea: HybridVentaLineaInput,
    cabecera: HybridVentaDetailInput,
    context: ImportContext,
  ): CreateInvoiceItemFromHybridDto {
    const sourceLineKey = `${cabecera.documento}:${linea.linea}`;
    const sourceHash = createHash('sha256')
      .update(JSON.stringify({ documento: cabecera.documento, linea: linea.linea, codigo: linea.codigo, cantidad: linea.cantidad, precio: linea.precio }))
      .digest('hex');

    const tasaReferencia = context.exchangeRate;
    const precioOriginal = linea.precio || 0;
    const importeOriginal = linea.importe || 0;
    
    const unitPrice = context.currencyCode === 'USD' ? precioOriginal : precioOriginal / tasaReferencia;
    const subtotal = context.currencyCode === 'USD' ? importeOriginal : importeOriginal / tasaReferencia;

    return {
      productId: null, // Se resuelve por EntityResolver
      quantity: linea.cantidad || 1,
      unitPrice,
      subtotal,
      taxRate: 16,
      taxableBase: subtotal,
      ivaLine: subtotal * 0.16,
      sourceHash,
      sourceLineKey,
      sourceSkuExact: linea.codigo || '',
      sourceDescription: linea.nombre || '',
      sourceQuantity: linea.cantidad || 0,
      effectiveQuantity: linea.cantidad || 0,
    };
  }
}
