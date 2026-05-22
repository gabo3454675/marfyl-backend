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
  UseInterceptors,
} from '@nestjs/common';
import { CacheTTL } from '@nestjs/cache-manager';
import { HttpCacheTenantInterceptor } from '@/common/interceptors/http-cache-tenant.interceptor';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';

@Controller('customers')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  async create(
    @Body() createCustomerDto: CreateCustomerDto,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.customersService.create(createCustomerDto, organizationId);
  }

  @Get()
  @UseInterceptors(HttpCacheTenantInterceptor)
  @CacheTTL(60)
  async findAll(@ActiveOrganization() organizationId: number) {
    return this.customersService.findAll(organizationId);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.customersService.findOne(id, organizationId);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCustomerDto: UpdateCustomerDto,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.customersService.update(id, updateCustomerDto, organizationId);
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.customersService.remove(id, organizationId);
  }
}
