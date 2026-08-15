import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';

export interface ResolvedProduct {
  id: number;
  name: string;
  sku: string | null;
  salePrice: unknown;
  stock: number;
  isExempt: boolean;
  isBundle: boolean;
  isService: boolean;
  costPrice: unknown;
}

export interface ProductResolution {
  product?: ResolvedProduct;
  matchBy?: 'sku' | 'barcode' | 'name';
}

export interface ResolvedCustomer {
  id: number;
  name: string;
  taxId: string | null;
}

export interface CustomerResolution {
  customer?: ResolvedCustomer;
  created: boolean;
}

@Injectable()
export class EntityResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveProduct(
    organizationId: number,
    codigo: string,
    nombre: string,
  ): Promise<ProductResolution> {
    // 1. Buscar por SKU
    if (codigo?.trim()) {
      const bySku = await this.prisma.product.findFirst({
        where: {
          organizationId,
          sku: codigo.trim(),
        },
        select: {
          id: true,
          name: true,
          sku: true,
          salePrice: true,
          stock: true,
          isExempt: true,
          isBundle: true,
          isService: true,
          costPrice: true,
        },
      });

      if (bySku) {
        return { product: bySku as ResolvedProduct, matchBy: 'sku' };
      }
    }

    // 2. Buscar por barcode (referencia)
    if (codigo?.trim()) {
      const byBarcode = await this.prisma.product.findFirst({
        where: {
          organizationId,
          barcode: codigo.trim(),
        },
        select: {
          id: true,
          name: true,
          sku: true,
          salePrice: true,
          stock: true,
          isExempt: true,
          isBundle: true,
          isService: true,
          costPrice: true,
        },
      });

      if (byBarcode) {
        return { product: byBarcode as ResolvedProduct, matchBy: 'barcode' };
      }
    }

    // 3. Buscar por nombre (fuzzy)
    if (nombre?.trim()) {
      const byName = await this.prisma.product.findFirst({
        where: {
          organizationId,
          name: {
            contains: nombre.trim(),
            mode: 'insensitive',
          },
        },
        select: {
          id: true,
          name: true,
          sku: true,
          salePrice: true,
          stock: true,
          isExempt: true,
          isBundle: true,
          isService: true,
          costPrice: true,
        },
      });

      if (byName) {
        return { product: byName as ResolvedProduct, matchBy: 'name' };
      }
    }

    return {};
  }

  async resolveCustomer(
    organizationId: number,
    companyId: number,
    rif: string,
    nit: string,
    nombre: string,
  ): Promise<CustomerResolution> {
    const taxId = rif?.trim() || nit?.trim();

    // 1. Buscar por taxId
    if (taxId) {
      const existing = await this.prisma.customer.findFirst({
        where: {
          organizationId,
          taxId,
        },
        select: {
          id: true,
          name: true,
          taxId: true,
        },
      });

      if (existing) {
        return { customer: existing as ResolvedCustomer, created: false };
      }
    }

    // 2. Buscar por nombre
    if (nombre?.trim()) {
      const byName = await this.prisma.customer.findFirst({
        where: {
          organizationId,
          name: {
            contains: nombre.trim(),
            mode: 'insensitive',
          },
        },
        select: {
          id: true,
          name: true,
          taxId: true,
        },
      });

      if (byName) {
        return { customer: byName as ResolvedCustomer, created: false };
      }
    }

    // 3. Crear nuevo cliente
    const created = await this.prisma.customer.create({
      data: {
        organizationId,
        companyId,
        name: nombre?.trim() || 'Cliente Hybrid',
        taxId: taxId || null,
      },
      select: {
        id: true,
        name: true,
        taxId: true,
      },
    });

    return { customer: created as ResolvedCustomer, created: true };
  }

  async resolveProductsBatch(
    organizationId: number,
    lineas: Array<{ codigo: string; nombre: string }>,
  ): Promise<Map<string, ProductResolution>> {
    const results = new Map<string, ProductResolution>();

    for (const linea of lineas) {
      const resolution = await this.resolveProduct(organizationId, linea.codigo, linea.nombre);
      results.set(linea.codigo, resolution);
    }

    return results;
  }
}
