import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { MovementType } from '@prisma/client';
import type { CreateInspectionDto } from './dto/create-inspection.dto';
import type { UpdateInspectionDto } from './dto/update-inspection.dto';
import * as ExcelJS from 'exceljs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Servicio de inspección de vehículos. Módulo exclusivo Davean: el acceso está
 * restringido por CompanyAccessGuard (solo empresa Davean). Todos los datos
 * guardados (diagramPins, usedParts, fotos/diagramas) quedan asociados al
 * tenantId (organización) de la petición, que en práctica es siempre Davean.
 */
@Injectable()
export class VehicleInspectionsService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveDaveanTemplatePath(): string {
    const fromEnv = process.env.DAVEAN_INSPECTION_TEMPLATE_PATH;
    const candidates = [
      fromEnv,
      resolve(process.cwd(), 'templates/davean-inspection-template.xlsx'),
      resolve(
        process.cwd(),
        'backend/templates/davean-inspection-template.xlsx',
      ),
      resolve(process.cwd(), '../../hojas de entradas vehiculos multiservicios Davean.xlsx'),
      resolve(
        process.cwd(),
        '../../../hojas de entradas vehiculos multiservicios Davean.xlsx',
      ),
    ].filter(Boolean) as string[];

    const found = candidates.find((p) => existsSync(p));
    if (!found) {
      throw new NotFoundException(
        'No se encontró el template Excel de Davean en backend/templates. Configura DAVEAN_INSPECTION_TEMPLATE_PATH si deseas otra ruta.',
      );
    }
    return found;
  }

  private toText(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value);
  }

  private parsePayload(payload: Record<string, unknown>) {
    const ingreso = (payload.ingreso ?? {}) as Record<string, any>;
    const datosCliente = (ingreso.datosCliente ?? {}) as Record<string, any>;
    const vehiculo = (ingreso.vehiculo ?? {}) as Record<string, any>;
    const recepcion = (ingreso.recepcion ?? {}) as Record<string, any>;
    const inspeccion = (payload.inspeccion ?? {}) as Record<string, any>;
    const internos = (inspeccion.accesoriosInternos ?? {}) as Record<string, any>;
    const exterior = (inspeccion.checklistLucesYExterior ?? {}) as Record<string, any>;
    const salida = (payload.salida ?? {}) as Record<string, any>;
    return { datosCliente, vehiculo, recepcion, internos, exterior, salida };
  }

  async generateDaveanTemplateDocument(params: {
    organizationId: number;
    payload: Record<string, unknown>;
    signatureDataUrl?: string;
  }): Promise<{ buffer: Buffer; fileName: string }> {
    try {
      // CompanyAccessGuard ya garantiza acceso exclusivo Davean.
      const workbook = new ExcelJS.Workbook();
      const templatePath = this.resolveDaveanTemplatePath();
      await workbook.xlsx.readFile(templatePath);
      const worksheet = workbook.getWorksheet('Hoja1') ?? workbook.worksheets[0];
      if (!worksheet) {
        throw new NotFoundException('No se encontró la hoja del template Davean.');
      }

      const { datosCliente, vehiculo, recepcion, internos, exterior, salida } =
        this.parsePayload(params.payload);

      const set = (cell: string, value: unknown) => {
        worksheet.getCell(cell).value = this.toText(value);
      };

      set('E2', datosCliente.cliente);
      set('J2', datosCliente.telefono);
      set('E4', datosCliente.direccion);
      set('J4', datosCliente.rifCi);
      set('D7', vehiculo.marca);
      set('E7', vehiculo.modelo);
      set('F7', vehiculo.anio);
      set('G7', vehiculo.placa);
      set('H7', vehiculo.color);
      set('B9', recepcion.fechaIngreso);
      set('C32', recepcion.numeroControl);
      set('F32', recepcion.tecnico);
      set('K39', salida.kilometrajeSalida ?? recepcion.kilometrajeIngreso);
      set('I38', salida.recibidoPor);

      const status = (v: unknown) =>
        v === 'N/A' ? 'N/A' : v === 'SI' ? 'SI' : 'NO';
      set('K41', status(internos.cauchoRepuesto));
      set('K42', status(internos.gatoHidraulicoOMecanico));
      set('K43', status(internos.triangulo));
      set('K44', status(internos.llaveCruz));
      set('K45', status(internos.reproductor));
      set('K46', status(internos.pantallaDvd));
      set('K47', status(internos.pendrive));
      set('K48', status(internos.cargador));
      set('K49', status(internos.cornetas));

      set('C58', status(exterior.claxonBocina));
      set('C59', status(exterior.limpiaParabrisas));
      set('C60', status(exterior.lucesBajas));
      set('C61', status(exterior.lucesAltas));
      set('C62', status(exterior.luzIntermitente));
      set('C63', status(exterior.direccionalIzquierda));
      set('C64', status(exterior.direccionalDerecha));
      set('C65', status(exterior.luzFreno));
      set('C66', status(exterior.luzPequenaStopFaros));
      set('F65', status(exterior.placas));
      set('F66', status(exterior.alarmaControl));

      if (params.signatureDataUrl?.startsWith('data:image/')) {
        try {
          const imageId = workbook.addImage({
            base64: params.signatureDataUrl,
            extension: 'png',
          });
          worksheet.addImage(imageId, 'I65:K66');
        } catch {
          // Si la firma viene corrupta, no bloqueamos la generación del documento.
        }
      }

      const xlsxBuffer = await workbook.xlsx.writeBuffer();
      const placa = this.toText(vehiculo.placa || 'sin-placa')
        .replace(/\s+/g, '-')
        .toLowerCase();
      return {
        buffer: Buffer.from(xlsxBuffer),
        fileName: `entrada-salida-davean-${placa}-${Date.now()}.xlsx`,
      };
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Error desconocido al crear Excel';
      throw new InternalServerErrorException(
        `No se pudo generar el documento Entrada/Salida: ${msg}`,
      );
    }
  }

  async update(id: number, organizationId: number, dto: UpdateInspectionDto) {
    const existing = await this.prisma.vehicleInspection.findFirst({
      where: { id, tenantId: organizationId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Inspección no encontrada.');
    }

    return this.prisma.vehicleInspection.update({
      where: { id },
      data: {
        diagramPins: dto.diagramPins ? (dto.diagramPins as object) : undefined,
        vehicleInfo: dto.vehicleInfo ?? undefined,
        notes: dto.notes ?? undefined,
      },
    });
  }

  async remove(id: number, organizationId: number) {
    const existing = await this.prisma.vehicleInspection.findFirst({
      where: { id, tenantId: organizationId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Inspección no encontrada.');
    }
    await this.prisma.vehicleInspection.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Crea una inspección de vehículo. Por cada repuesto en usedParts,
   * descuenta del inventario (movimiento USO_TALLER) y luego guarda la inspección.
   * Los datos se asocian al organizationId/tenantId de la petición (Davean).
   */
  async create(params: {
    organizationId: number;
    userId: number;
    dto: CreateInspectionDto;
  }) {
    const { organizationId, userId, dto } = params;
    const usedParts = dto.usedParts ?? [];
    const diagramPins = dto.diagramPins ?? [];

    // Validar productos y stock antes de la transacción
    for (const item of usedParts) {
      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, organizationId },
        select: { id: true, name: true, stock: true },
      });
      if (!product) {
        throw new NotFoundException(
          `Producto con id ${item.productId} no encontrado en esta organización.`,
        );
      }
      if (product.stock < item.quantity) {
        throw new BadRequestException(
          `Stock insuficiente en "${product.name}". Disponible: ${product.stock}, solicitado: ${item.quantity}.`,
        );
      }
    }

    const inspection = await this.prisma.$transaction(async (tx) => {
      // Descontar inventario (USO_TALLER) por cada repuesto
      for (const item of usedParts) {
        await tx.inventoryMovement.create({
          data: {
            type: MovementType.USO_TALLER,
            quantity: -item.quantity,
            reason: `Inspección vehículo${dto.vehicleInfo ? ` - ${dto.vehicleInfo}` : ''}`,
            productId: item.productId,
            userId,
            tenantId: organizationId,
          },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      return tx.vehicleInspection.create({
        data: {
          tenantId: organizationId,
          diagramPins: diagramPins.length ? (diagramPins as object) : undefined,
          usedParts: usedParts.length ? (usedParts as object) : undefined,
          vehicleInfo: dto.vehicleInfo ?? undefined,
          notes: dto.notes ?? undefined,
        },
      });
    });

    return inspection;
  }

  /**
   * Lista inspecciones de la organización.
   */
  async findByOrganization(organizationId: number, limit = 50) {
    return this.prisma.vehicleInspection.findMany({
      where: { tenantId: organizationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  /**
   * Obtiene una inspección por id (solo si pertenece al tenant).
   */
  async findOne(id: number, organizationId: number) {
    const inspection = await this.prisma.vehicleInspection.findFirst({
      where: { id, tenantId: organizationId },
    });
    if (!inspection) {
      throw new NotFoundException('Inspección no encontrada.');
    }
    return inspection;
  }
}
