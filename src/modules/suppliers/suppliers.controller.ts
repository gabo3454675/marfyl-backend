import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  create(
    @Body() createSupplierDto: CreateSupplierDto,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.suppliersService.create(createSupplierDto, organizationId);
  }

  @Get()
  findAll(@ActiveOrganization() organizationId: number) {
    return this.suppliersService.findAll(organizationId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.suppliersService.findOne(id, organizationId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateSupplierDto: UpdateSupplierDto,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.suppliersService.update(id, updateSupplierDto, organizationId);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.suppliersService.remove(id, organizationId);
  }
}
