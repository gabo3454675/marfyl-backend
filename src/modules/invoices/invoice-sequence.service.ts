import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

type TxClient = Prisma.TransactionClient;

@Injectable()
export class InvoiceSequenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserva el siguiente consecutivo de factura para la organización (atómico).
   * Debe llamarse dentro de la misma transacción que crea la factura.
   */
  async allocateNext(
    organizationId: number,
    tx?: TxClient,
  ): Promise<number> {
    if (tx) {
      return this.allocateInTransaction(tx, organizationId);
    }
    return this.prisma.$transaction((client) =>
      this.allocateInTransaction(client, organizationId),
    );
  }

  private async allocateInTransaction(
    tx: TxClient,
    organizationId: number,
  ): Promise<number> {
    const bumped = await tx.$queryRaw<{ allocated: number }[]>`
      UPDATE "organization_invoice_sequences"
      SET "nextNumber" = "nextNumber" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "organizationId" = ${organizationId}
      RETURNING "nextNumber" - 1 AS allocated
    `;

    if (bumped.length > 0) {
      return bumped[0].allocated;
    }

    const max = await tx.invoice.aggregate({
      where: { organizationId },
      _max: { consecutiveNumber: true },
    });
    const start = (max._max.consecutiveNumber ?? 0) + 1;
    await tx.organizationInvoiceSequence.create({
      data: { organizationId, nextNumber: start + 1 },
    });
    return start;
  }
}
