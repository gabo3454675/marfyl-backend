import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { getCompanyIdFromOrganization } from '@/common/helpers/organization.helper';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async create(createSupplierDto: CreateSupplierDto, organizationId: number) {
    // Obtener companyId correspondiente a la organización
    const companyId = await getCompanyIdFromOrganization(this.prisma, organizationId);

    return this.prisma.supplier.create({
      data: {
        ...createSupplierDto,
        companyId, // Requerido por el schema
        organizationId, // OBLIGATORIO: Inyectar organizationId del contexto (nunca del body)
      },
    });
  }

  async findAll(organizationId: number) {
    return this.prisma.supplier.findMany({
      where: {
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(id: number, organizationId: number) {
    const supplier = await this.prisma.supplier.findFirst({
      where: {
        id,
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
      },
    });

    if (!supplier) {
      throw new NotFoundException(`Proveedor con ID ${id} no encontrado`);
    }

    return supplier;
  }

  async update(id: number, updateSupplierDto: UpdateSupplierDto, organizationId: number) {
    await this.findOne(id, organizationId);

    return this.prisma.supplier.update({
      where: { id },
      data: updateSupplierDto,
    });
  }

  async remove(id: number, organizationId: number) {
    await this.findOne(id, organizationId);

    // Verificar si tiene gastos asociados
    const expensesCount = await this.prisma.expense.count({
      where: {
        supplierId: id,
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
      },
    });

    if (expensesCount > 0) {
      throw new ConflictException(
        `No se puede eliminar el proveedor porque tiene ${expensesCount} gasto(s) asociado(s)`,
      );
    }

    return this.prisma.supplier.delete({
      where: { id },
    });
  }
}
