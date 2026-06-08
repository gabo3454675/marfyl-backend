import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CONCERT_ORG_SLUG } from "@/common/founding-orgs";
import { ConcertService } from "./concert.service";
import { isConcertFeatureEnabled } from "./concert.config";

/**
 * Al arrancar el backend, asegura el evento temporal de boletería en Monddy Corp
 * (slug monddy). Solo si CONCERT_AUTO_SETUP_MONDDY=true.
 */
@Injectable()
export class ConcertBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ConcertBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly concertService: ConcertService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.CONCERT_AUTO_SETUP_MONDDY !== "true") {
      return;
    }
    if (!isConcertFeatureEnabled()) {
      this.logger.warn(
        "CONCERT_AUTO_SETUP_MONDDY activo pero CONCERT_FEATURE_ENABLED no — omitido",
      );
      return;
    }

    const org = await this.prisma.organization.findUnique({
      where: { slug: CONCERT_ORG_SLUG },
      select: { id: true, nombre: true, concertModuleEnabled: true },
    });

    if (!org) {
      this.logger.warn(`Org boletería (${CONCERT_ORG_SLUG}) no encontrada`);
      return;
    }
    if (!org.concertModuleEnabled) {
      this.logger.warn(
        `Monddy (${org.nombre}) sin concertModuleEnabled — ejecute provision fundador`,
      );
      return;
    }

    try {
      const event = await this.concertService.ensureDefaultEvent(org.id);
      const seatCount = await this.prisma.concertSeat.count({
        where: { section: { eventId: event.id } },
      });
      this.logger.log(
        `Boletería Monddy lista: evento "${event.slug}" (${seatCount} asientos)`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`No se pudo provisionar boletería Monddy: ${message}`);
    }
  }
}
