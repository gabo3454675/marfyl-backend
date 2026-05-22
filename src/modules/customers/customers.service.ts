import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { getCompanyIdFromOrganization } from '@/common/helpers/organization.helper';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async create(createCustomerDto: CreateCustomerDto, organizationId: number) {
    // Obtener companyId correspondiente a la organización
    const companyId = await getCompanyIdFromOrganization(this.prisma, organizationId);

    return this.prisma.customer.create({
      data: {
        ...createCustomerDto,
        companyId, // Requerido por el schema
        organizationId, // OBLIGATORIO: Inyectar organizationId del contexto (nunca del body)
      },
    });
  }

  async findAll(organizationId: number) {
    return this.prisma.customer.findMany({
      where: {
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number, organizationId: number) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id,
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
      },
    });

    if (!customer) {
      throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
    }

    return customer;
  }

  async update(id: number, updateCustomerDto: UpdateCustomerDto, organizationId: number) {
    // Verificar que el cliente existe y pertenece a la organización
    await this.findOne(id, organizationId);

    return this.prisma.customer.update({
      where: { id },
      data: updateCustomerDto,
    });
  }

  async remove(id: number, organizationId: number) {
    // Verificar que el cliente existe y pertenece a la organización
    await this.findOne(id, organizationId);

    return this.prisma.customer.delete({
      where: { id },
    });
  }
}
