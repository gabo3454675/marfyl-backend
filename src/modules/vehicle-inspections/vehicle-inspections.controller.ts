import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  BadRequestException,
  Res,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import { VehicleInspectionsService } from './vehicle-inspections.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { CompanyAccessGuard } from '@/common/guards/company-access.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';
import { ActiveUser } from '@/common/decorators/active-user.decorator';
import { ActiveOrganizationMembership } from '@/common/decorators/active-organization-membership.decorator';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { PrintInspectionTemplateDto } from './dto/print-inspection-template.dto';
import { UpdateInspectionDto } from './dto/update-inspection.dto';

@Controller('vehicle-inspections')
@UseGuards(JwtAuthGuard, OrganizationGuard, CompanyAccessGuard)
export class VehicleInspectionsController {
  constructor(
    private readonly vehicleInspectionsService: VehicleInspectionsService,
  ) {}

  @Post()
  async create(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
    @Body() dto: CreateInspectionDto,
  ) {
    return this.vehicleInspectionsService.create({
      organizationId,
      userId: user.id,
      dto,
    });
  }

  @Get()
  async findAll(@ActiveOrganization() organizationId: number) {
    return this.vehicleInspectionsService.findByOrganization(organizationId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: number,
  ) {
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      throw new BadRequestException('ID de inspección inválido');
    }
    return this.vehicleInspectionsService.findOne(numericId, organizationId);
  }

  @Post('print-template')
  async printTemplate(
    @ActiveOrganization() organizationId: number,
    @Body() dto: PrintInspectionTemplateDto,
    @Res() res: Response,
  ) {
    const { buffer, fileName } =
      await this.vehicleInspectionsService.generateDaveanTemplateDocument({
        organizationId,
        payload: dto.payload,
        signatureDataUrl: dto.signatureDataUrl,
      });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(buffer);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: number,
    @Body() dto: UpdateInspectionDto,
  ) {
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      throw new BadRequestException('ID de inspección inválido');
    }
    return this.vehicleInspectionsService.update(numericId, organizationId, dto);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: number,
    @ActiveOrganizationMembership()
    membership: { role?: string } | undefined,
  ) {
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      throw new BadRequestException('ID de inspección inválido');
    }
    const role = String(membership?.role ?? '').toUpperCase();
    if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
      throw new ForbiddenException(
        'No tienes permisos para eliminar inspecciones.',
      );
    }
    return this.vehicleInspectionsService.remove(numericId, organizationId);
  }
}
