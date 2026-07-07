import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { Prisma } from "@prisma/client";
import { ActivityLogService } from "@/modules/activity-log/activity-log.service";
import { PushNotificationService } from "@/modules/notifications/push-notification.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { CreateVariantDto } from "./dto/create-variant.dto";
import { UpdateVariantDto } from "./dto/update-variant.dto";
import { getCompanyIdFromOrganization } from "@/common/helpers/organization.helper";
import { UploadService } from "@/common/services/upload.service";
import { PaginatedResponse } from "@/common/interfaces/paginated-response.interface";
import { parseMonddyExcel } from "./monddy-excel.parser";

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
    return this.uploadService.uploadFile(file, "products");
  }

  async create(
    createProductDto: CreateProductDto,
    organizationId: number,
    imageUrl?: string,
  ) {
    // Verificar si el SKU ya existe en esta organización
    if (createProductDto.sku) {
      const existingProduct = await this.prisma.product.findFirst({
        where: {
          organizationId,
          sku: createProductDto.sku,
        },
      });

      if (existingProduct) {
        throw new ConflictException("El SKU ya existe para esta organización");
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
        throw new ConflictException(
          "El código de barras ya existe para esta organización",
        );
      }
    }

    // Obtener companyId correspondiente a la organización
    const companyId = await getCompanyIdFromOrganization(
      this.prisma,
      organizationId,
    );

    const { isBundle, bundleComponents, isService, ...productRest } =
      createProductDto;
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
        salePriceCurrency: createProductDto.salePriceCurrency ?? "USD",
        isBundle: bundle,
        isService: srv,
        bundleComponents: storedComponents,
      },
    });
  }

  async findAll(organizationId: number) {
    const products = await this.prisma.product.findMany({
      where: {
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    console.log(
      "[ProductsService] findAll result for organizationId",
      organizationId,
      "- products found:",
      products.length,
    );
    return products;
  }

  /**
   * Obtiene productos con paginación server-side y búsqueda.
   * Para catálogos grandes (5k+ productos), usar esta versión.
   */
  async findAllPaginated(
    organizationId: number,
    options: {
      page?: number;
      limit?: number;
      search?: string;
      categoryId?: number;
    } = {},
  ): Promise<PaginatedResponse<any>> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const skip = (page - 1) * limit;

    console.log(
      "[ProductsService] findAllPaginated called with",
      {
        organizationId,
        page,
        limit,
        search: options.search,
        categoryId: options.categoryId,
      },
    );

    const where: any = { organizationId };

    if (options.categoryId) {
      where.categoryId = options.categoryId;
    }

    if (options.search) {
      where.OR = [
        { name: { contains: options.search, mode: "insensitive" } },
        { sku: { contains: options.search, mode: "insensitive" } },
        { barcode: { contains: options.search, mode: "insensitive" } },
      ];
    }

    const [total, data] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          costPrice: true,
          salePrice: true,
          salePriceCurrency: true,
          stock: true,
          minStock: true,
          imageUrl: true,
          isExempt: true,
          isBundle: true,
          isService: true,
        },
      }),
    ]);

    console.log(
      "[ProductsService] findAllPaginated result for organizationId",
      organizationId,
      "- total:",
      total,
      "returned:",
      data.length,
    );

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
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
        throw new ConflictException("El SKU ya existe para esta organización");
      }
    }

    // Verificar código de barras único si se está actualizando
    if (
      updateProductDto.barcode &&
      updateProductDto.barcode !== existingProduct.barcode
    ) {
      const duplicateProduct = await this.prisma.product.findFirst({
        where: {
          organizationId,
          barcode: updateProductDto.barcode,
        },
      });

      if (duplicateProduct) {
        throw new ConflictException(
          "El código de barras ya existe para esta organización",
        );
      }
    }

    const nextBundle =
      updateProductDto.isBundle !== undefined
        ? updateProductDto.isBundle
        : existingProduct.isBundle;
    const nextService =
      updateProductDto.isService !== undefined
        ? !!updateProductDto.isService
        : !!(existingProduct as { isService?: boolean }).isService;
    const data: Record<string, unknown> = {
      ...(updateProductDto as object),
    } as Record<string, unknown>;
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
      const org = await this.prisma.organization
        .findUnique({
          where: { id: organizationId },
          select: { nombre: true },
        })
        .catch(() => null);
      this.pushNotification
        .notifyStockBajo({
          organizationName: org?.nombre ?? "Organización",
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
      const newSale =
        updateProductDto.salePrice != null
          ? Number(updateProductDto.salePrice)
          : oldSale;
      const oldCost = Number(existingProduct.costPrice);
      const newCost =
        updateProductDto.costPrice != null
          ? Number(updateProductDto.costPrice)
          : oldCost;
      if (oldSale !== newSale || oldCost !== newCost) {
        await this.activityLog.log({
          organizationId,
          userId,
          action: "PRODUCT_PRICE_UPDATE",
          entityType: "product",
          entityId: String(id),
          oldValue: { salePrice: oldSale, costPrice: oldCost },
          newValue: { salePrice: newSale, costPrice: newCost },
          summary: `${existingProduct.name}: precio venta ${oldSale} → ${newSale}${oldCost !== newCost ? `, costo ${oldCost} → ${newCost}` : ""}`,
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
      throw new NotFoundException(
        `Producto con código de barras ${barcode} no encontrado`,
      );
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
   * Importa productos desde un archivo Excel en formato MonddY.
   * Usa el parser MonddY para extraer productos con variantes,
   * y realiza upsert por SKU para idempotencia multi-tenant.
   */
  async importFromExcel(file: Express.Multer.File, organizationId: number) {
    try {
      // Validar que el archivo existe
      if (!file || !file.buffer) {
        throw new BadRequestException("Archivo no válido");
      }

      // Parsear con el parser MonddY (productos + variantes)
      const parsedProducts = await parseMonddyExcel(file.buffer);

      if (parsedProducts.length === 0) {
        throw new BadRequestException(
          "No se encontraron productos válidos en el archivo. " +
            "Verifique que tenga datos en el formato MonddY esperado.",
        );
      }

      // Obtener companyId para la organización
      const companyId = await getCompanyIdFromOrganization(
        this.prisma,
        organizationId,
      );

      // Contadores para el resumen
      let created = 0;
      let updated = 0;
      const errors: string[] = [];

      // Transacción atómica para crear/actualizar productos y variantes
      await this.prisma.$transaction(
        async (tx) => {
          for (const pp of parsedProducts) {
            try {
              // Verificar existencia previa para el contador (antes del upsert)
              const existing = await tx.product.findFirst({
                where: { organizationId, sku: pp.sku },
                select: { id: true },
              });

              // Upsert producto base por organizationId + sku (idempotente)
              const product = await tx.product.upsert({
                where: {
                  organizationId_sku: { organizationId, sku: pp.sku },
                },
                create: {
                  companyId,
                  organizationId,
                  sku: pp.sku,
                  name: pp.name,
                  costPrice: pp.costPrice,
                  salePrice: pp.salePrice,
                  stock: pp.stock,
                  isActive: pp.isActive,
                  minStock: 5,
                },
                update: {
                  name: pp.name,
                  costPrice: pp.costPrice,
                  stock: pp.stock,
                  isActive: pp.isActive,
                },
              });

              if (existing) {
                updated++;
              } else {
                created++;
              }

              // Procesar variantes si el producto tiene
              if (pp.variants.length > 0) {
                // 1) Resetear todas las variantes a no-default
                await tx.productVariant.updateMany({
                  where: { productId: product.id },
                  data: { isDefault: false },
                });

                // 2) Ordenar: "UNIDAD" primero si existe, luego el resto
                const sortedVariants = [...pp.variants].sort((a, b) => {
                  const aIsUnidad = a.name.toUpperCase() === "UNIDAD";
                  const bIsUnidad = b.name.toUpperCase() === "UNIDAD";
                  if (aIsUnidad && !bIsUnidad) return -1;
                  if (!aIsUnidad && bIsUnidad) return 1;
                  return 0;
                });

                // 3) Upsert cada variante por productId + name
                for (let i = 0; i < sortedVariants.length; i++) {
                  const v = sortedVariants[i];
                  const isDefault = i === 0;

                  await tx.productVariant.upsert({
                    where: {
                      productId_name: {
                        productId: product.id,
                        name: v.name,
                      },
                    },
                    create: {
                      productId: product.id,
                      name: v.name,
                      salePrice: v.salePrice,
                      unitQuantity: v.unitQuantity,
                      stockBehavior: v.stockBehavior,
                      inheritCost: v.inheritCost,
                      customCost: v.customCost,
                      isDefault,
                      sortOrder: i,
                      isActive: true,
                    },
                    update: {
                      salePrice: v.salePrice,
                      unitQuantity: v.unitQuantity,
                      stockBehavior: v.stockBehavior,
                      inheritCost: v.inheritCost,
                      customCost: v.customCost,
                      isDefault,
                      sortOrder: i,
                      isActive: true,
                    },
                  });
                }

                // 4) Sincronizar Product.salePrice con la variante default
                await this.syncProductSalePrice(product.id, tx);
              }
            } catch (error: any) {
              errors.push(
                `Producto ${pp.sku} (${pp.name}): ${error.message || "Error desconocido"}`,
              );
            }
          }
        },
        {
          timeout: 60000, // 60 segundos para transacciones con muchas variantes
        },
      );

      return {
        success: true,
        created,
        updated,
        total: parsedProducts.length,
        errors: errors.slice(0, 50),
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Error al procesar el archivo Excel: ${error.message || "Error desconocido"}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // SYNC: Sincroniza Product.salePrice con la variante default
  // ---------------------------------------------------------------------------

  /**
   * Actualiza Product.salePrice con el salePrice de la variante isDefault=true.
   * Debe llamarse dentro de una transacción existente.
   */
  private async syncProductSalePrice(
    productId: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const defaultVariant = await tx.productVariant.findFirst({
      where: { productId, isDefault: true, isActive: true },
      select: { salePrice: true },
    });

    if (defaultVariant) {
      await tx.product.update({
        where: { id: productId },
        data: { salePrice: defaultVariant.salePrice },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // VARIANTES DE PRODUCTO
  // ---------------------------------------------------------------------------

  /**
   * Retorna todas las variantes activas de un producto, ordenadas por sortOrder y luego id.
   */
  async findVariantsByProduct(productId: number, organizationId: number) {
    // Verificar que el producto existe y pertenece a la organización
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
    });

    if (!product) {
      throw new NotFoundException(`Producto con ID ${productId} no encontrado`);
    }

    return this.prisma.productVariant.findMany({
      where: {
        productId,
        isActive: true,
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        productId: true,
        name: true,
        salePrice: true,
        unitQuantity: true,
        stockBehavior: true,
        inheritCost: true,
        customCost: true,
        isDefault: true,
        sortOrder: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Crea una nueva variante para un producto.
   */
  async createVariant(
    productId: number,
    dto: CreateVariantDto,
    organizationId: number,
  ) {
    // Verificar que el producto existe y pertenece a la organización
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
    });

    if (!product) {
      throw new NotFoundException(`Producto con ID ${productId} no encontrado`);
    }

    // Validar unicidad de nombre por producto
    const existingVariant = await this.prisma.productVariant.findFirst({
      where: { productId, name: dto.name },
    });

    if (existingVariant) {
      throw new ConflictException(
        `Ya existe una variante con el nombre "${dto.name}" para este producto`,
      );
    }

    // Validar costo: si no hereda, debe tener un costo personalizado
    if (dto.inheritCost === false) {
      if (dto.customCost === undefined || dto.customCost === null) {
        throw new BadRequestException(
          "La variante requiere un costo personalizado cuando no hereda del producto",
        );
      }
    }

    // Si es default y hay otros defaults, desactivarlos en una transacción
    if (dto.isDefault === true) {
      return this.prisma.$transaction(async (tx) => {
        await tx.productVariant.updateMany({
          where: {
            productId,
            isDefault: true,
            isActive: true,
          },
          data: { isDefault: false },
        });

        const variant = await tx.productVariant.create({
          data: {
            productId,
            name: dto.name,
            salePrice: dto.salePrice,
            unitQuantity: dto.unitQuantity ?? 1,
            stockBehavior: dto.stockBehavior ?? "DEDUCT",
            inheritCost: dto.inheritCost ?? true,
            customCost: dto.customCost ?? null,
            isDefault: true,
            sortOrder: dto.sortOrder ?? 0,
            isActive: dto.isActive ?? true,
          },
          include: { product: true },
        });

        await this.syncProductSalePrice(productId, tx);

        return variant;
      });
    }

    // Crear la variante sin tocar defaults
    return this.prisma.productVariant.create({
      data: {
        productId,
        name: dto.name,
        salePrice: dto.salePrice,
        unitQuantity: dto.unitQuantity ?? 1,
        stockBehavior: dto.stockBehavior ?? "DEDUCT",
        inheritCost: dto.inheritCost ?? true,
        customCost: dto.customCost ?? null,
        isDefault: dto.isDefault ?? false,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
      include: { product: true },
    });
  }

  /**
   * Actualiza una variante existente.
   */
  async updateVariant(
    variantId: number,
    dto: UpdateVariantDto,
    organizationId: number,
  ) {
    // Verificar que la variante existe y pertenece a la organización (via Product)
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId },
      include: {
        product: {
          select: { organizationId: true, id: true },
        },
      },
    });

    if (!variant) {
      throw new NotFoundException(`Variante con ID ${variantId} no encontrada`);
    }

    if (variant.product.organizationId !== organizationId) {
      throw new NotFoundException(`Variante con ID ${variantId} no encontrada`);
    }

    // Validar unicidad de nombre por producto si se está actualizando el nombre
    if (dto.name && dto.name !== variant.name) {
      const duplicate = await this.prisma.productVariant.findFirst({
        where: {
          productId: variant.productId,
          name: dto.name,
          id: { not: variantId },
        },
      });

      if (duplicate) {
        throw new ConflictException(
          `Ya existe una variante con el nombre "${dto.name}" para este producto`,
        );
      }
    }

    // Validar costo: determinar los valores finales después del update
    const finalInheritCost =
      dto.inheritCost !== undefined ? dto.inheritCost : variant.inheritCost;
    const finalCustomCost =
      dto.customCost !== undefined ? dto.customCost : variant.customCost;

    if (finalInheritCost === false && finalCustomCost === null) {
      throw new BadRequestException(
        "La variante requiere un costo personalizado cuando no hereda del producto",
      );
    }

    // Si se marca como default, desactivar otros defaults en transacción
    if (dto.isDefault === true) {
      return this.prisma.$transaction(async (tx) => {
        await tx.productVariant.updateMany({
          where: {
            productId: variant.productId,
            isDefault: true,
            isActive: true,
            id: { not: variantId },
          },
          data: { isDefault: false },
        });

        const updated = await tx.productVariant.update({
          where: { id: variantId },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.salePrice !== undefined && { salePrice: dto.salePrice }),
            ...(dto.unitQuantity !== undefined && {
              unitQuantity: dto.unitQuantity,
            }),
            ...(dto.stockBehavior !== undefined && {
              stockBehavior: dto.stockBehavior,
            }),
            ...(dto.inheritCost !== undefined && {
              inheritCost: dto.inheritCost,
            }),
            ...(dto.customCost !== undefined && { customCost: dto.customCost }),
            ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
            ...(dto.isActive !== undefined && { isActive: dto.isActive }),
            isDefault: true,
          },
        });

        if (dto.salePrice !== undefined) {
          await this.syncProductSalePrice(variant.productId, tx);
        }

        return updated;
      });
    }

    // Actualizar sin tocar defaults
    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.salePrice !== undefined && { salePrice: dto.salePrice }),
        ...(dto.unitQuantity !== undefined && {
          unitQuantity: dto.unitQuantity,
        }),
        ...(dto.stockBehavior !== undefined && {
          stockBehavior: dto.stockBehavior,
        }),
        ...(dto.inheritCost !== undefined && { inheritCost: dto.inheritCost }),
        ...(dto.customCost !== undefined && { customCost: dto.customCost }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    // Si la variante es default y se actualizó salePrice, sincronizar producto
    if (variant.isDefault && dto.salePrice !== undefined) {
      await this.syncProductSalePrice(variant.productId, this.prisma);
    }

    return updated;
  }

  /**
   * Eliminación lógica de una variante (isActive = false).
   */
  async deleteVariant(variantId: number, organizationId: number) {
    // Verificar que la variante existe y pertenece a la organización (via Product)
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId },
      include: {
        product: {
          select: { organizationId: true },
        },
      },
    });

    if (!variant) {
      throw new NotFoundException(`Variante con ID ${variantId} no encontrada`);
    }

    if (variant.product.organizationId !== organizationId) {
      throw new NotFoundException(`Variante con ID ${variantId} no encontrada`);
    }

    // Soft delete: marcar como inactiva
    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { isActive: false },
    });

    return { success: true };
  }
}
