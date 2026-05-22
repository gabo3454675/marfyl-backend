import { PrismaClient } from '@prisma/client';

/**
 * Helper para obtener el companyId correspondiente a una organizationId
 * Busca la empresa legacy que tiene el mismo nombre que la organización
 * Acepta PrismaService o PrismaClient (para transacciones)
 */
export async function getCompanyIdFromOrganization(
  prisma: PrismaClient | any,
  organizationId: number,
): Promise<number> {
  // Obtener la organización
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { nombre: true },
  });

  if (!organization) {
    throw new Error(`Organización con ID ${organizationId} no encontrada`);
  }

  // Buscar la empresa legacy con el mismo nombre
  const company = await prisma.company.findFirst({
    where: { name: organization.nombre },
    select: { id: true },
  });

  if (!company) {
    // Si no existe, crear una empresa legacy con el mismo nombre
    // Esto es para mantener compatibilidad
    const newCompany = await prisma.company.create({
      data: {
        name: organization.nombre,
        taxId: `J-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 10)}`,
        currency: 'USD',
        isActive: true,
      },
      select: { id: true },
    });
    return newCompany.id;
  }

  return company.id;
}
