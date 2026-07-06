import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";
import { getCompanyIdFromOrganization } from "@/common/helpers/organization.helper";
import { PaginatedResponse } from "@/common/interfaces/paginated-response.interface";

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async create(createCustomerDto: CreateCustomerDto, organizationId: number) {
    // Obtener companyId correspondiente a la organización
    const companyId = await getCompanyIdFromOrganization(
      this.prisma,
      organizationId,
    );

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
        createdAt: "desc",
      },
    });
  }

  async findAllPaginated(
    organizationId: number,
    params: { page: number; limit?: number; search?: string },
  ): Promise<PaginatedResponse<any>> {
    const { page, limit = 20, search } = params;
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { taxId: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          taxId: true,
          email: true,
          phone: true,
          address: true,
          createdAt: true,
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

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

  async update(
    id: number,
    updateCustomerDto: UpdateCustomerDto,
    organizationId: number,
  ) {
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
