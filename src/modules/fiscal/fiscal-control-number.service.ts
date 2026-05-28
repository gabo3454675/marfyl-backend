import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { formatControlNumber } from './helpers/control-number.helper';

@Injectable()
export class FiscalControlNumberService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserva el siguiente numero de control fiscal para la organizacion (atomico).
   */
  async allocateControlNumber(organizationId: number): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      let profile = await tx.fiscalProfile.findUnique({ where: { organizationId } });
      if (!profile) {
        profile = await tx.fiscalProfile.create({
          data: { organizationId, controlSeriesPrefix: '01', nextControlSequence: 1 },
        });
      }

      const prefix = profile.controlSeriesPrefix ?? '01';
      const seq = profile.nextControlSequence ?? 1;
      const controlNumber = formatControlNumber(prefix, seq);

      await tx.fiscalProfile.update({
        where: { organizationId },
        data: { nextControlSequence: seq + 1 },
      });

      return controlNumber;
    });
  }
}
