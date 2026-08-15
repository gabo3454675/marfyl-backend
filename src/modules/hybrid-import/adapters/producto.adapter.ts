import { Injectable } from '@nestjs/common';
import type { HybridAdapter, ValidationResult } from './hybrid-adapter.interface';
import type { HybridProductoInput } from '../types/hybrid-input.types';
import type { CreateProductFromHybridDto } from '../types/hybrid-output.types';
import type { ImportContext } from '../types/import-context';
import { productoDedupKey } from './dedup-keys';

@Injectable()
export class ProductoAdapter implements HybridAdapter<HybridProductoInput, CreateProductFromHybridDto> {
  
  transform(input: HybridProductoInput, context: ImportContext): CreateProductFromHybridDto {
    return {
      sku: input.codigo?.trim() || '',
      name: input.nombre?.trim() || 'Sin nombre',
      description: input.referencia?.trim() || undefined,
      barcode: input.referencia?.trim() || undefined,
      costPrice: 0, // Hybrid no provee costo en inventario
      salePrice: 0, // Hybrid no provee precio en inventario
      salePriceCurrency: context.currencyCode,
      isExempt: false,
      isActive: input.activo === true || input.activo === 1,
    };
  }

  getDedupKey(input: HybridProductoInput): string {
    return productoDedupKey(input.codigo);
  }

  validate(input: HybridProductoInput): ValidationResult {
    const errors: ValidationResult['errors'] = [];

    if (!input.codigo?.trim()) {
      errors.push({ field: 'codigo', message: 'Código es requerido', code: 'REQUIRED' });
    }

    if (!input.nombre?.trim()) {
      errors.push({ field: 'nombre', message: 'Nombre es requerido', code: 'REQUIRED' });
    }

    return { valid: errors.length === 0, errors };
  }
}
