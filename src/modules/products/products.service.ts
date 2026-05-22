import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ActivityLogService } from '@/modules/activity-log/activity-log.service';
import { PushNotificationService } from '@/modules/notifications/push-notification.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { getCompanyIdFromOrganization } from '@/common/helpers/organization.helper';
import { UploadService } from '@/common/services/upload.service';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private uploadService: UploadService,
    private activityLog: ActivityLogService,
    private pushNotification: PushNotificationService,
  ) {}

  /**
   * Sube una imagen usando el servicio de upload (S3 o local)
   */
  async uploadImage(file: Express.Multer.File): Promise<string> {
    return this.uploadService.uploadFile(file, 'products');
  }

  async create(createProductDto: CreateProductDto, organizationId: number, imageUrl?: string) {
    // Verificar si el SKU ya existe en esta organización
    if (createProductDto.sku) {
      const existingProduct = await this.prisma.product.findFirst({
        where: {
          organizationId,
          sku: createProductDto.sku,
        },
      });

      if (existingProduct) {
        throw new ConflictException('El SKU ya existe para esta organización');
      }
    }

    // Verificar si el código de barras ya existe en esta organización
    if (createProductDto.barcode) {
      const existingProduct = await this.prisma.product.findFirst({
        where: {
          organizationId,
          barcode: createProductDto.barcode,
        },
      });

      if (existingProduct) {
        throw new ConflictException('El código de barras ya existe para esta organización');
      }
    }

    // Obtener companyId correspondiente a la organización
    const companyId = await getCompanyIdFromOrganization(this.prisma, organizationId);

    const { isBundle, bundleComponents, isService, ...productRest } = createProductDto;
    const bundle = isBundle ?? false;
    const srv = bundle ? false : (isService ?? false);
    const compsRaw = bundleComponents as unknown;
    const compsArr = Array.isArray(compsRaw) ? compsRaw : [];
    let storedComponents: object | undefined;
    if (bundle) {
      storedComponents = compsArr.length > 0 ? (compsRaw as object) : [];
    } else if (srv && compsArr.length > 0) {
      storedComponents = compsRaw as object;
    } else {
      storedComponents = undefined;
    }

    return this.prisma.product.create({
      data: {
        ...productRest,
        companyId, // Requerido por el schema
        organizationId,
        imageUrl: imageUrl || null,
        costPrice: createProductDto.costPrice ?? 0,
        stock: createProductDto.stock ?? 0,
        minStock: createProductDto.minStock ?? 5,
        salePriceCurrency: createProductDto.salePriceCurrency ?? 'USD',
        isBundle: bundle,
        isService: srv,
        bundleComponents: storedComponents,
      },
    });
  }

  async findAll(organizationId: number) {
    return this.prisma.product.findMany({
      where: {
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number, organizationId: number) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
      },
    });

    if (!product) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }

    return product;
  }

  async update(
    id: number,
    updateProductDto: UpdateProductDto,
    organizationId: number,
    userId?: number,
  ) {
    // Verificar que el producto existe y pertenece a la organización
    const existingProduct = await this.findOne(id, organizationId);

    // Verificar SKU único si se está actualizando
    if (updateProductDto.sku && updateProductDto.sku !== existingProduct.sku) {
      const duplicateProduct = await this.prisma.product.findFirst({
        where: {
          organizationId,
          sku: updateProductDto.sku,
        },
      });

      if (duplicateProduct) {
        throw new ConflictException('El SKU ya existe para esta organización');
      }
    }

    // Verificar código de barras único si se está actualizando
    if (updateProductDto.barcode && updateProductDto.barcode !== existingProduct.barcode) {
      const duplicateProduct = await this.prisma.product.findFirst({
        where: {
          organizationId,
          barcode: updateProductDto.barcode,
        },
      });

      if (duplicateProduct) {
        throw new ConflictException('El código de barras ya existe para esta organización');
      }
    }

    const nextBundle =
      updateProductDto.isBundle !== undefined ? updateProductDto.isBundle : existingProduct.isBundle;
    const nextService =
      updateProductDto.isService !== undefined
        ? !!updateProductDto.isService
        : !!(existingProduct as { isService?: boolean }).isService;
    const data: Record<string, unknown> = { ...(updateProductDto as object) } as Record<string, unknown>;
    if (nextBundle) {
      data.isService = false;
    }

    if (updateProductDto.bundleComponents !== undefined) {
      const bc = updateProductDto.bundleComponents as unknown;
      const arr = Array.isArray(bc) ? bc : [];
      if (nextBundle) {
        data.bundleComponents = arr.length > 0 ? bc : [];
      } else if (nextService) {
        data.bundleComponents = arr.length > 0 ? bc : null;
      } else {
        data.bundleComponents = null;
      }
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: data as any,
    });

    // Alertas: si el stock quedó por debajo del mínimo, notificar a Super Admins
    const newStock = updated.stock;
    const minStock = updated.minStock ?? 5;
    if (newStock < minStock) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { nombre: true },
      }).catch(() => null);
      this.pushNotification
        .notifyStockBajo({
          organizationName: org?.nombre ?? 'Organización',
          productName: updated.name,
          productId: id,
          stockActual: newStock,
          minStock,
        })
        .catch(() => {});
    }

    // Auditoría: cambio de precio (venta o costo)
    if (userId != null) {
      const oldSale = Number(existingProduct.salePrice);
      const newSale = updateProductDto.salePrice != null ? Number(updateProductDto.salePrice) : oldSale;
      const oldCost = Number(existingProduct.costPrice);
      const newCost = updateProductDto.costPrice != null ? Number(updateProductDto.costPrice) : oldCost;
      if (oldSale !== newSale || oldCost !== newCost) {
        await this.activityLog.log({
          organizationId,
          userId,
          action: 'PRODUCT_PRICE_UPDATE',
          entityType: 'product',
          entityId: String(id),
          oldValue: { salePrice: oldSale, costPrice: oldCost },
          newValue: { salePrice: newSale, costPrice: newCost },
          summary: `${existingProduct.name}: precio venta ${oldSale} → ${newSale}${oldCost !== newCost ? `, costo ${oldCost} → ${newCost}` : ''}`,
        });
      }
    }

    return updated;
  }

  async remove(id: number, organizationId: number) {
    // Verificar que el producto existe y pertenece a la organización
    await this.findOne(id, organizationId);

    return this.prisma.product.delete({
      where: { id },
    });
  }

  async findByBarcode(barcode: string, organizationId: number) {
    const product = await this.prisma.product.findFirst({
      where: {
        barcode,
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
      },
    });

    if (!product) {
      throw new NotFoundException(`Producto con código de barras ${barcode} no encontrado`);
    }

    return product;
  }

  /**
   * Lista productos con stock por debajo del mínimo (para alertas en web/app).
   */
  async getAlertasStock(organizationId: number) {
    const products = await this.prisma.product.findMany({
      where: {
        organizationId,
        // @ts-ignore
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        stock: true,
        minStock: true,
        salePrice: true,
      },
    });
    const minStockDefault = 5;
    return products
      .filter((p) => p.stock < (p.minStock ?? minStockDefault))
      .map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        stock: p.stock,
        minStock: p.minStock ?? minStockDefault,
        salePrice: Number(p.salePrice),
      }));
  }

  /**
   * Importa productos desde un archivo Excel
   * Usa transacciones de Prisma para velocidad y lógica de upsert inteligente
   */
  async importFromExcel(file: Express.Multer.File, organizationId: number) {
    try {
      // Validar que el archivo existe
      if (!file || !file.buffer) {
        throw new BadRequestException('Archivo no válido');
      }

      // Leer el archivo Excel con exceljs
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as any);

      // Obtener la primera hoja
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        throw new BadRequestException('El archivo Excel no contiene hojas');
      }

      // Validar que tiene filas
      if (worksheet.rowCount < 2) {
        throw new BadRequestException('El archivo Excel debe tener al menos una fila de datos (excluyendo encabezados)');
      }

      // Obtener encabezados de la primera fila
      const headerRow = worksheet.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell({ includeEmpty: false }, (cell) => {
        headers.push(String(cell.value || '').trim().toLowerCase());
      });

      // Validar columnas requeridas (case-insensitive)
      const requiredColumns = ['nombre', 'precio', 'stock'];
      const columnMap: Record<string, number> = {};

      // Buscar columnas (flexible con variaciones)
      const columnVariations: Record<string, string[]> = {
        nombre: ['nombre', 'name', 'producto', 'product', 'descripción', 'descripcion'],
        precio: ['precio', 'price', 'precio de venta', 'sale price', 'venta'],
        stock: ['stock', 'inventario', 'inventory', 'cantidad', 'quantity'],
        sku: ['sku', 'código', 'codigo', 'code'],
        codigoBarras: ['código de barras', 'codigo de barras', 'barcode', 'código barras', 'codigo barras'],
      };

      for (const [key, variations] of Object.entries(columnVariations)) {
        const foundIndex = headers.findIndex((h) =>
          variations.some((v) => h.includes(v) || v.includes(h))
        );
        if (foundIndex !== -1) {
          columnMap[key] = foundIndex + 1; // ExcelJS usa índices basados en 1
        }
      }

      // Validar columnas requeridas
      if (!columnMap.nombre || !columnMap.precio || !columnMap.stock) {
        throw new BadRequestException(
          'El archivo Excel debe contener las columnas: Nombre, Precio, Stock. ' +
          'Columnas opcionales: SKU, Código de Barras'
        );
      }

      // Obtener companyId para la organización
      const companyId = await getCompanyIdFromOrganization(this.prisma, organizationId);

      // Contadores para el resumen
      let created = 0;
      let updated = 0;
      const errors: string[] = [];

      // Usar transacción de Prisma para velocidad y atomicidad
      await this.prisma.$transaction(
        async (tx) => {
          // Procesar cada fila (empezando desde la fila 2, ya que la 1 es encabezados)
          for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
            const row = worksheet.getRow(rowNum);

            try {
              // Extraer valores de las celdas
              const nombre = row.getCell(columnMap.nombre)?.value?.toString()?.trim();
              const precioStr = row.getCell(columnMap.precio)?.value?.toString()?.trim();
              const stockStr = row.getCell(columnMap.stock)?.value?.toString()?.trim();
              const sku = columnMap.sku
                ? row.getCell(columnMap.sku)?.value?.toString()?.trim()
                : undefined;
              const codigoBarras = columnMap.codigoBarras
                ? row.getCell(columnMap.codigoBarras)?.value?.toString()?.trim()
                : undefined;

              // Validar datos requeridos
              if (!nombre) {
                errors.push(`Fila ${rowNum}: El nombre es requerido`);
                continue;
              }

              const precio = parseFloat(precioStr || '0');
              if (isNaN(precio) || precio < 0) {
                errors.push(`Fila ${rowNum}: El precio debe ser un número válido mayor o igual a 0`);
                continue;
              }

              const stock = parseInt(stockStr || '0', 10);
              if (isNaN(stock) || stock < 0) {
                errors.push(`Fila ${rowNum}: El stock debe ser un número entero válido mayor o igual a 0`);
                continue;
              }

              // Lógica de upsert inteligente: Si existe SKU, actualizar; si no, crear
              if (sku) {
                // Buscar producto existente por SKU
                const existingProduct = await tx.product.findFirst({
                  where: {
                    organizationId,
                    sku,
                  },
                });

                if (existingProduct) {
                  // Actualizar producto existente (actualizar stock y precio si cambió)
                  await tx.product.update({
                    where: { id: existingProduct.id },
                    data: {
                      name: nombre,
                      salePrice: precio,
                      stock: stock, // Actualizar stock
                      ...(codigoBarras && { barcode: codigoBarras }),
                    },
                  });
                  updated++;
                } else {
                  // Crear nuevo producto con SKU
                  await tx.product.create({
                    data: {
                      name: nombre,
                      sku,
                      salePrice: precio,
                      costPrice: 0,
                      stock,
                      minStock: 5,
                      companyId,
                      organizationId,
                      ...(codigoBarras && { barcode: codigoBarras }),
                    },
                  });
                  created++;
                }
              } else if (codigoBarras) {
                // Si no hay SKU pero hay código de barras, usar código de barras para upsert
                const existingProduct = await tx.product.findFirst({
                  where: {
                    organizationId,
                    barcode: codigoBarras,
                  },
                });

                if (existingProduct) {
                  // Actualizar producto existente
                  await tx.product.update({
                    where: { id: existingProduct.id },
                    data: {
                      name: nombre,
                      salePrice: precio,
                      stock: stock,
                    },
                  });
                  updated++;
                } else {
                  // Crear nuevo producto
                  await tx.product.create({
                    data: {
                      name: nombre,
                      barcode: codigoBarras,
                      salePrice: precio,
                      costPrice: 0,
                      stock,
                      minStock: 5,
                      companyId,
                      organizationId,
                    },
                  });
                  created++;
                }
              } else {
                // Si no hay SKU ni código de barras, solo crear (no podemos hacer upsert)
                await tx.product.create({
                  data: {
                    name: nombre,
                    salePrice: precio,
                    costPrice: 0,
                    stock,
                    minStock: 5,
                    companyId,
                    organizationId,
                  },
                });
                created++;
              }
            } catch (error: any) {
              errors.push(`Fila ${rowNum}: ${error.message || 'Error desconocido'}`);
            }
          }
        },
        {
          timeout: 30000, // 30 segundos de timeout para transacciones largas
        }
      );

      return {
        success: true,
        created,
        updated,
        total: worksheet.rowCount - 1, // Excluir fila de encabezados
        errors: errors.slice(0, 50), // Limitar errores a 50 para no saturar la respuesta
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Error al procesar el archivo Excel: ${error.message || 'Error desconocido'}`
      );
    }
  }
}
