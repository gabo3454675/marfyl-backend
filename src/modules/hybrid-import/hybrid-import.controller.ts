import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';
import { HybridImportService } from './hybrid-import.service';
import type { ImportResult, HybridImportPreviewResult } from './types/import-result.types';

@Controller('hybrid-import')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class HybridImportController {
  constructor(private readonly hybridImportService: HybridImportService) {}

  /**
   * Preview de importación de ventas.
   * Muestra qué se importaría sin persistir.
   */
  @Get('ventas/preview')
  async previewVentas(
    @ActiveOrganization() organizationId: number,
  ): Promise<HybridImportPreviewResult> {
    return this.hybridImportService.previewVentas(organizationId);
  }

  /**
   * Preview de importación de ventas específicas.
   */
  @Post('ventas/preview')
  async previewVentasSpecific(
    @ActiveOrganization() organizationId: number,
    @Body('documentos') documentos: string[],
  ): Promise<HybridImportPreviewResult> {
    return this.hybridImportService.previewVentas(organizationId, documentos);
  }

  /**
   * Confirmar importación de ventas.
   * Persiste las ventas en la base de datos.
   */
  @Post('ventas/confirm')
  async confirmVentas(
    @ActiveOrganization() organizationId: number,
    @Body('documentos') documentos: string[],
  ): Promise<ImportResult> {
    return this.hybridImportService.confirmVentas(organizationId, documentos);
  }
}
