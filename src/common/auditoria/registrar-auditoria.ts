import { Prisma } from '@prisma/client';
import { PrismaService } from '@/common/prisma/prisma.service';

/**
 * Parámetros para persistir una fila en la tabla `auditorias` (módulo SAC).
 */
export interface RegistrarAuditoriaParams {
  usuarioId: number;
  accion: string;
  entidad: string;
  entidadId: string | number;
  valoresAnteriores?: Prisma.InputJsonValue | null;
  valoresNuevos?: Prisma.InputJsonValue | null;
}

/**
 * Utilidad reutilizable: inserta un registro de auditoría fiscal.
 * Puede llamarse desde servicios inyectando `PrismaService` o desde `AuditoriaService`.
 */
export async function registrarAuditoria(
  prisma: PrismaService,
  params: RegistrarAuditoriaParams,
): Promise<void> {
  const {
    usuarioId,
    accion,
    entidad,
    entidadId,
    valoresAnteriores,
    valoresNuevos,
  } = params;

  await prisma.auditoria.create({
    data: {
      usuario_id: usuarioId,
      accion,
      entidad,
      entidad_id: String(entidadId),
      valores_anteriores:
        valoresAnteriores !== undefined && valoresAnteriores !== null
          ? (valoresAnteriores as Prisma.InputJsonValue)
          : undefined,
      valores_nuevos:
        valoresNuevos !== undefined && valoresNuevos !== null
          ? (valoresNuevos as Prisma.InputJsonValue)
          : undefined,
    },
  });
}
