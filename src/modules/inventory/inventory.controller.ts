import {
  Controller,
  Get,
  Post,
  Delete,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Body,
} from '@nestjs/common';
import { Res } from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { SuperAdminGuard } from '@/common/guards/super-admin.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';
import { ClearInventoryDto } from './dto/clear-inventory.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @UseGuards(JwtAuthGuard, OrganizationGuard)
  async findAll(@ActiveOrganization() organizationId: number) {
    return this.inventoryService.findAll(organizationId);
  }

  /**
   * Devuelve el formato exacto que el sistema espera para el Excel.
   * Objetivo: que puedas pedirle el archivo a tus clientes sin ambigüedad.
   */
  @Get('template-format')
  @UseGuards(JwtAuthGuard, OrganizationGuard)
  async templateFormat() {
    return this.inventoryService.getTemplateFormat();
  }

  /**
   * Descarga una plantilla Excel real (.xlsx) lista para enviar a clientes.
   * Incluye notas en los headers para mejorar UX.
   */
  @Get('template')
  @UseGuards(JwtAuthGuard, OrganizationGuard)
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.inventoryService.generateTemplateXlsxBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="inventory-template.xlsx"',
    );
    res.send(Buffer.from(buffer as any));
  }

  /**
   * Import masivo de inventario desde Excel (.xlsx/.xls)
   * Campo esperado: `file` (multipart/form-data)
   *
   * Dry run:
   * - confirm=false (default): valida y devuelve preview sin guardar
   * - confirm=true: ejecuta escritura si no hay errores
   */
  @Post('import')
  @UseGuards(JwtAuthGuard, OrganizationGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async importExcel(
    @UploadedFile() file: Express.Multer.File,
    @ActiveOrganization() organizationId: number,
    @Body('confirm') confirm?: string | boolean,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo no proporcionado');
    }

    // Validar tipo de archivo
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/octet-stream', // algunos navegadores envían esto para .xlsx
    ];
    const allowedExtensions = ['.xlsx', '.xls'];
    const fileExtension = file.originalname
      .toLowerCase()
      .substring(file.originalname.lastIndexOf('.'));

    if (
      !allowedMimeTypes.includes(file.mimetype) &&
      !allowedExtensions.includes(fileExtension)
    ) {
      throw new BadRequestException(
        'El archivo debe ser un Excel (.xlsx o .xls). Tipo recibido: ' +
          file.mimetype,
      );
    }

    const confirmBool =
      confirm === true || String(confirm || '').toLowerCase().trim() === 'true';

    return this.inventoryService.importFromExcelWithDryRun({
      file,
      organizationId,
      confirm: confirmBool,
    });
  }

  /**
   * Limpia todo el inventario de una organización (productos y movimientos).
   * Solo Super Admin global (User.isSuperAdmin). No requiere x-tenant-id.
   * Body: { tenantId: number }
   */
  @Delete('clear')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async clear(@Body() dto: ClearInventoryDto) {
    return this.inventoryService.clearByTenantId(dto.tenantId);
  }
}
