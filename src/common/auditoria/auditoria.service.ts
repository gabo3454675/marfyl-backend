import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import {
  registrarAuditoria,
  RegistrarAuditoriaParams,
} from './registrar-auditoria';

/**
 * Servicio inyectable para registrar auditoría SAC (tabla `auditorias`).
 */
@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(params: RegistrarAuditoriaParams): Promise<void> {
    return registrarAuditoria(this.prisma, params);
  }
}
