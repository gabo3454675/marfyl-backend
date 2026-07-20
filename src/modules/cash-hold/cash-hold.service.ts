import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { UpsertCashHoldDto } from "./dto/upsert-cash-hold.dto";

@Injectable()
export class CashHoldService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: number) {
    return this.prisma.cashHold.findMany({
      where: { organizationId },
      orderBy: [{ asOf: "desc" }, { id: "desc" }],
    });
  }

  async summary(organizationId: number) {
    const rows = await this.prisma.cashHold.findMany({
      where: { organizationId },
      select: { location: true, currency: true, amount: true },
    });
    const byKey = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.location}:${r.currency}`;
      byKey.set(key, (byKey.get(key) ?? 0) + Number(r.amount));
    }
    return [...byKey.entries()].map(([key, amount]) => {
      const [location, currency] = key.split(":");
      return { location, currency, amount };
    });
  }

  async upsert(organizationId: number, userId: number, dto: UpsertCashHoldDto) {
    const data = {
      organizationId,
      location: dto.location,
      currency: dto.currency.toUpperCase(),
      amount: new Prisma.Decimal(dto.amount),
      asOf: new Date(dto.asOf),
      label: dto.label.trim(),
      notes: dto.notes?.trim() || null,
      createdById: userId,
    };

    if (dto.importKey?.trim()) {
      return this.prisma.cashHold.upsert({
        where: { importKey: dto.importKey.trim() },
        create: { ...data, importKey: dto.importKey.trim() },
        update: {
          location: data.location,
          currency: data.currency,
          amount: data.amount,
          asOf: data.asOf,
          label: data.label,
          notes: data.notes,
        },
      });
    }

    return this.prisma.cashHold.create({ data: { ...data, importKey: null } });
  }

  async remove(organizationId: number, id: number) {
    const existing = await this.prisma.cashHold.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException("Saldo de caja no encontrado");
    await this.prisma.cashHold.delete({ where: { id } });
    return { ok: true };
  }
}
