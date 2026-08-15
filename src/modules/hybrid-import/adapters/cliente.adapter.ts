import { Injectable } from '@nestjs/common';
import type { HybridAdapter, ValidationResult } from './hybrid-adapter.interface';
import type { HybridClienteInput } from '../types/hybrid-input.types';
import type { CreateCustomerFromHybridDto } from '../types/hybrid-output.types';
import type { ImportContext } from '../types/import-context';
import { clienteDedupKey } from './dedup-keys';

@Injectable()
export class ClienteAdapter implements HybridAdapter<HybridClienteInput, CreateCustomerFromHybridDto> {
  
  transform(input: HybridClienteInput, context: ImportContext): CreateCustomerFromHybridDto {
    const taxId = input.rif?.trim() || input.nit?.trim() || '';
    
    return {
      name: input.nombre?.trim() || 'Sin nombre',
      taxId,
      phone: input.telefono?.trim() || undefined,
      email: input.email?.trim() || undefined,
      address: input.direccion?.trim() || undefined,
    };
  }

  getDedupKey(input: HybridClienteInput): string {
    return clienteDedupKey(input.rif, input.nit);
  }

  validate(input: HybridClienteInput): ValidationResult {
    const errors: ValidationResult['errors'] = [];

    if (!input.nombre?.trim()) {
      errors.push({ field: 'nombre', message: 'Nombre es requerido', code: 'REQUIRED' });
    }

    if (!input.rif?.trim() && !input.nit?.trim()) {
      errors.push({ field: 'rif', message: 'RIF o NIT es requerido para deduplicación', code: 'REQUIRED' });
    }

    return { valid: errors.length === 0, errors };
  }
}
