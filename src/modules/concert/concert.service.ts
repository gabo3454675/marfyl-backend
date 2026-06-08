import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  ConcertOrderStatus,
  ConcertPaymentMethod,
  ConcertSeatStatus,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { assertDbAvailable } from "@/common/prisma/assert-db-available";
import { UploadService } from "@/common/services/upload.service";
import { EmailService } from "@/modules/email/email.service";
import type { OwnerOrderSeatLine } from "@/modules/email/email.types";
import {
  CONCERT_HOLD_MINUTES,
  isConcertEnabledForOrganization,
  isConcertFeatureEnabled,
} from "./concert.config";
import { ConcertCheckoutDto } from "./dto/checkout.dto";
import { AdminSellDto } from "./dto/admin-sell.dto";
import {
  HEMENEGILDA_SEAT_CATALOG,
  type SeatCatalogEntry,
} from "./hemenegilda-seat-catalog";
import {
  buildPublicTicketUrl,
  formatTicketDisplayCode,
  parseTicketScanInput,
  resolveTicketQrPayload,
} from "@/common/utils/concert-ticket-qr.util";
import { CONCERT_TICKET_EMAIL } from "@/modules/email/concert-ticket-email.constants";

@Injectable()
export class ConcertService {
  private readonly logger = new Logger(ConcertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly emailService: EmailService,
  ) {}

  private get frontendUrl(): string {
    return process.env.FRONTEND_URL?.trim() || "http://localhost:3003";
  }

  private assertEnabled() {
    if (!isConcertFeatureEnabled()) {
      throw new NotFoundException("Módulo de concierto no disponible");
    }
  }

  private assertConcertForOrganization(org: {
    slug: string;
    concertModuleEnabled?: boolean;
  }) {
    this.assertEnabled();
    if (!isConcertEnabledForOrganization(org)) {
      throw new NotFoundException(
        "Módulo de concierto no disponible para esta organización",
      );
    }
  }

  private async assertConcertForOrganizationId(organizationId: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true, concertModuleEnabled: true },
    });
    if (!org) throw new NotFoundException("Organización no encontrada");
    this.assertConcertForOrganization(org);
  }

  private async getEventBySlug(slug: string) {
    const event = await this.prisma.concertEvent.findFirst({
      where: { slug, isActive: true },
      include: {
        sections: { orderBy: { sortOrder: "asc" }, include: { seats: true } },
        organization: {
          select: {
            id: true,
            slug: true,
            nombre: true,
            exchangeRate: true,
            concertModuleEnabled: true,
          },
        },
      },
    });
    if (!event) throw new NotFoundException("Evento no encontrado");
    this.assertConcertForOrganization(event.organization);
    return event;
  }

  private async releaseExpiredHolds(eventId: number) {
    const now = new Date();
    await this.prisma.concertSeat.updateMany({
      where: {
        status: ConcertSeatStatus.HELD,
        heldUntil: { lt: now },
        section: { eventId },
      },
      data: {
        status: ConcertSeatStatus.AVAILABLE,
        heldUntil: null,
        holdToken: null,
        orderId: null,
      },
    });
  }

  private buildOwnerSeatLines(
    seats: Array<{
      displayNumber: number | null;
      mesaNumber: number | null;
      rowLabel: string;
      seatNumber: number;
      priceUsd: number | null;
      section: { code: string };
    }>,
    event: {
      priceUsdVip: number;
      priceUsdStandard: number;
    },
  ): OwnerOrderSeatLine[] {
    return seats.map((seat) => {
      const priceUsd =
        seat.priceUsd ??
        (seat.section.code === "VIP"
          ? event.priceUsdVip
          : event.priceUsdStandard);
      const seatLabel =
        seat.displayNumber != null && seat.mesaNumber != null
          ? `Mesa ${seat.mesaNumber} · Asiento ${seat.displayNumber}`
          : `${seat.rowLabel}-${seat.seatNumber}`;
      return {
        seatLabel,
        sectionCode: seat.section.code,
        priceUsd,
      };
    });
  }

  private sumSeatTotals(
    seats: {
      priceUsd: number | null;
      priceBs: number | null;
      section: { code: string };
    }[],
    event: {
      priceUsdVip: number;
      priceBsVip: number | null;
      priceUsdStandard: number;
      organization: { exchangeRate: number | null };
    },
  ) {
    let amountUsd = 0;
    let amountBs = 0;
    const fallbackBsVip =
      event.priceBsVip ??
      event.priceUsdVip * (event.organization.exchangeRate || 1);
    for (const seat of seats) {
      const usd =
        seat.priceUsd ??
        (seat.section.code === "VIP"
          ? event.priceUsdVip
          : event.priceUsdStandard);
      const bs =
        seat.priceBs ??
        (seat.section.code === "VIP"
          ? fallbackBsVip
          : usd * (event.organization.exchangeRate || 1));
      amountUsd += usd;
      amountBs += bs;
    }
    return {
      amountUsd: Math.round(amountUsd * 100) / 100,
      amountBs: Math.round(amountBs * 100) / 100,
    };
  }

  private mapSeatForPublic(seat: {
    id: number;
    rowLabel: string;
    seatNumber: number;
    status: ConcertSeatStatus;
    heldUntil: Date | null;
    priceUsd: number | null;
    priceBs: number | null;
    mesaNumber: number | null;
    displayNumber: number | null;
    tierCode: string | null;
    tierLabel: string | null;
  }) {
    const now = new Date();
    const effectiveStatus =
      seat.status === ConcertSeatStatus.HELD &&
      seat.heldUntil &&
      seat.heldUntil < now
        ? ConcertSeatStatus.AVAILABLE
        : seat.status;
    return {
      id: seat.id,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
      mesaNumber: seat.mesaNumber,
      displayNumber: seat.displayNumber,
      priceUsd: seat.priceUsd,
      priceBs: seat.priceBs,
      tierCode: seat.tierCode,
      tierLabel: seat.tierLabel,
      status: effectiveStatus,
    };
  }

  private buildSectionPublicView(
    section: { id: number; code: string; label: string },
    seats: ReturnType<ConcertService["mapSeatForPublic"]>[],
  ) {
    const mesaMap = new Map<
      number,
      ReturnType<ConcertService["mapSeatForPublic"]>[]
    >();
    for (const s of seats) {
      const mesa = s.mesaNumber ?? 0;
      const list = mesaMap.get(mesa) ?? [];
      list.push(s);
      mesaMap.set(mesa, list);
    }
    const mesas = [...mesaMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([mesaNumber, mesaSeats]) => ({
        mesaNumber,
        tierCode: mesaSeats[0]?.tierCode,
        tierLabel: mesaSeats[0]?.tierLabel,
        priceUsd: mesaSeats[0]?.priceUsd,
        priceBs: mesaSeats[0]?.priceBs,
        seats: mesaSeats.sort(
          (a, b) => (a.displayNumber ?? 0) - (b.displayNumber ?? 0),
        ),
      }));

    const tiers = [
      ...new Set(seats.map((s) => s.tierCode).filter(Boolean)),
    ] as string[];

    return {
      code: section.code,
      label: section.label,
      tiers,
      mesas,
      seats,
    };
  }

  async getPublicEvent(slug: string) {
    this.assertEnabled();
    const event = await this.getEventBySlug(slug);
    await this.releaseExpiredHolds(event.id);

    const seats = await this.prisma.concertSeat.findMany({
      where: { section: { eventId: event.id } },
      include: { section: { select: { code: true, label: true } } },
    });

    const stats = {
      total: seats.length,
      available: seats.filter((s) => s.status === ConcertSeatStatus.AVAILABLE)
        .length,
      sold: seats.filter((s) => s.status === ConcertSeatStatus.SOLD).length,
    };

    return {
      slug: event.slug,
      title: event.title,
      subtitle: event.subtitle,
      venueName: event.venueName,
      eventStartsAt: event.eventStartsAt,
      priceUsdStandard: event.priceUsdStandard,
      priceUsdVip: event.priceUsdVip,
      exchangeRate: event.organization.exchangeRate,
      bankAccountName: event.bankAccountName,
      bankAccountInfo: event.bankAccountInfo,
      pagoMovilInfo: event.pagoMovilInfo,
      cashInstructions: event.cashInstructions,
      publicNotes: event.publicNotes,
      paymentMethods: [
        ConcertPaymentMethod.CASH_USD,
        ConcertPaymentMethod.PAGO_MOVIL,
        ConcertPaymentMethod.BANK_TRANSFER,
      ],
      stats,
      pricingNote:
        "Montos en USD y Bs fijos por asiento según planilla del organizador (no calculados por tasa BCV).",
      sections: event.sections.map((sec) =>
        this.buildSectionPublicView(
          sec,
          seats
            .filter((s) => s.sectionId === sec.id)
            .map((s) => this.mapSeatForPublic(s)),
        ),
      ),
    };
  }

  async holdSeats(slug: string, seatIds: number[]) {
    this.assertEnabled();
    const event = await this.getEventBySlug(slug);
    await this.releaseExpiredHolds(event.id);

    const holdToken = randomUUID();
    const heldUntil = new Date(Date.now() + CONCERT_HOLD_MINUTES * 60 * 1000);

    const seats = await this.prisma.concertSeat.findMany({
      where: { id: { in: seatIds }, section: { eventId: event.id } },
      include: { section: true },
    });
    if (seats.length !== seatIds.length) {
      throw new BadRequestException("Algunos asientos no existen");
    }

    for (const seat of seats) {
      if (seat.status === ConcertSeatStatus.SOLD) {
        throw new ConflictException(
          `Asiento ${seat.rowLabel}-${seat.seatNumber} ya vendido`,
        );
      }
      if (
        seat.status === ConcertSeatStatus.HELD &&
        seat.heldUntil &&
        seat.heldUntil > new Date() &&
        seat.holdToken !== holdToken
      ) {
        throw new ConflictException(
          `Asiento ${seat.rowLabel}-${seat.seatNumber} en reserva`,
        );
      }
    }

    await this.prisma.concertSeat.updateMany({
      where: { id: { in: seatIds } },
      data: { status: ConcertSeatStatus.HELD, heldUntil, holdToken },
    });

    const totals = this.sumSeatTotals(seats, event);
    const exchangeRate = event.organization.exchangeRate || 1;

    return {
      holdToken,
      heldUntil,
      seatIds,
      amountUsd: totals.amountUsd,
      amountBs: totals.amountBs,
      exchangeRate,
    };
  }

  async checkoutPublic(
    slug: string,
    dto: ConcertCheckoutDto,
    paymentProof?: Express.Multer.File,
  ) {
    this.assertEnabled();
    const event = await this.getEventBySlug(slug);
    await this.releaseExpiredHolds(event.id);

    const seats = await this.prisma.concertSeat.findMany({
      where: {
        holdToken: dto.holdToken,
        section: { eventId: event.id },
        status: ConcertSeatStatus.HELD,
      },
      include: { section: true },
    });
    if (seats.length === 0) {
      throw new BadRequestException(
        "Reserva expirada o inválida. Vuelva a elegir asientos.",
      );
    }

    if (
      (dto.paymentMethod === ConcertPaymentMethod.PAGO_MOVIL ||
        dto.paymentMethod === ConcertPaymentMethod.BANK_TRANSFER) &&
      !dto.paymentReference?.trim()
    ) {
      throw new BadRequestException("Indique número de referencia del pago");
    }

    const totals = this.sumSeatTotals(seats, event);
    const exchangeRate = event.organization.exchangeRate || 1;

    let paymentProofUrl: string | null = null;
    if (paymentProof) {
      paymentProofUrl = await this.uploadService.uploadFile(
        paymentProof,
        "private/concert/payments",
      );
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.concertOrder.create({
        data: {
          organizationId: event.organizationId,
          eventId: event.id,
          status: ConcertOrderStatus.PENDING_PAYMENT,
          paymentMethod: dto.paymentMethod,
          buyerName: dto.buyerName.trim(),
          buyerIdDocument: dto.buyerIdDocument.trim(),
          buyerPhone: dto.buyerPhone.trim(),
          buyerEmail: dto.buyerEmail?.trim() || null,
          amountUsd: totals.amountUsd,
          amountBs: totals.amountBs,
          exchangeRate,
          paymentReference: dto.paymentReference?.trim() || null,
          paymentProofUrl,
        },
      });

      await tx.concertSeat.updateMany({
        where: { id: { in: seats.map((s) => s.id) } },
        data: {
          status: ConcertSeatStatus.HELD,
          holdToken: null,
          heldUntil: null,
          orderId: created.id,
        },
      });

      return created;
    });

    const ownerSeatLines = this.buildOwnerSeatLines(seats, event);

    // Fire-and-forget: notify owner(s) of new pending order
    setImmediate(() => {
      this.emailService
        .sendConcertOrderPendingToOwner(order, event, ownerSeatLines)
        .catch((err) =>
          this.logger.error(
            `Failed to send order pending email: ${err.message}`,
          ),
        );
    });

    return {
      orderPublicToken: order.publicToken,
      status: order.status,
      amountUsd: order.amountUsd,
      amountBs: order.amountBs,
      message:
        dto.paymentMethod === ConcertPaymentMethod.CASH_USD
          ? "Reserva registrada. Acérquese a taquilla con efectivo en divisas para confirmar y recibir su QR."
          : "Pago en revisión. Recibirá su entrada digital cuando el organizador confirme el pago.",
    };
  }

  private async markOrderPaid(orderId: number, userId: number) {
    const order = await this.prisma.concertOrder.findUnique({
      where: { id: orderId },
      include: {
        event: true,
        tickets: true,
      },
    });
    if (!order) throw new NotFoundException("Orden no encontrada");
    if (order.status === ConcertOrderStatus.PAID) {
      return this.getOrderDetail(order.organizationId, order.publicToken);
    }
    if (order.status === ConcertOrderStatus.CANCELLED) {
      throw new BadRequestException("Orden cancelada");
    }

    const seats = await this.prisma.concertSeat.findMany({
      where: { orderId: order.id },
      include: { section: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.concertOrder.update({
        where: { id: order.id },
        data: {
          status: ConcertOrderStatus.PAID,
          paidAt: new Date(),
          confirmedById: userId,
        },
      });

      for (const seat of seats) {
        await tx.concertSeat.update({
          where: { id: seat.id },
          data: { status: ConcertSeatStatus.SOLD },
        });

        const existing = await tx.concertTicket.findUnique({
          where: { seatId: seat.id },
        });
        if (!existing) {
          const publicToken = randomUUID();
          const qrPayload = buildPublicTicketUrl(
            this.frontendUrl,
            order.event.slug,
            publicToken,
          );
          const seatLabel =
            seat.displayNumber != null && seat.mesaNumber != null
              ? `Mesa ${seat.mesaNumber} · Asiento ${seat.displayNumber}`
              : `${seat.rowLabel}-${seat.seatNumber}`;
          await tx.concertTicket.create({
            data: {
              orderId: order.id,
              seatId: seat.id,
              publicToken,
              qrPayload,
              seatLabel,
              sectionCode: seat.section.code,
            },
          });
        }
      }
    });

    // Fire-and-forget: send tickets to buyer after payment confirmation
    // Refresh tickets for email (created in transaction above)
    const paidOrder = await this.prisma.concertOrder.findUnique({
      where: { id: orderId },
      include: { event: true, tickets: true },
    });
    if (paidOrder) {
      setImmediate(() => {
        this.emailService
          .sendConcertTicketsToBuyer(
            paidOrder,
            paidOrder.event,
            paidOrder.tickets,
          )
          .then(async () => {
            await this.prisma.concertOrder.update({
              where: { id: orderId },
              data: {
                emailSentAt: new Date(),
                emailSentTo: paidOrder.buyerEmail,
              },
            });
          })
          .catch((err) =>
            this.logger.error(`Failed to send tickets email: ${err.message}`),
          );
      });
    }

    return this.getOrderDetail(order.organizationId, order.publicToken);
  }

  async getPublicOrder(slug: string, orderToken: string) {
    this.assertEnabled();
    const event = await this.getEventBySlug(slug);
    const order = await this.prisma.concertOrder.findFirst({
      where: {
        publicToken: orderToken,
        eventId: event.id,
        organizationId: event.organization.id,
      },
      include: { tickets: { orderBy: { id: "asc" } } },
    });
    if (!order) throw new NotFoundException("Orden no encontrada");

    if (order.status !== ConcertOrderStatus.PAID) {
      return {
        status: order.status,
        paid: false,
        buyerName: order.buyerName,
        amountUsd: order.amountUsd,
        amountBs: order.amountBs,
        message: "Pago pendiente de confirmación",
      };
    }

    return {
      status: order.status,
      paid: true,
      event: {
        title: event.title,
        subtitle: event.subtitle,
        venueName: event.venueName,
        eventStartsAt: event.eventStartsAt,
      },
      buyerName: order.buyerName,
      amountUsd: order.amountUsd,
      amountBs: order.amountBs,
      tickets: order.tickets.map((t) => ({
        publicToken: t.publicToken,
        seatLabel: t.seatLabel,
        sectionCode: t.sectionCode,
        qrPayload: resolveTicketQrPayload(t, event.slug, this.frontendUrl),
        ticketCode: formatTicketDisplayCode(t.publicToken),
        checkedIn: !!t.checkedInAt,
      })),
    };
  }

  async getPublicTicket(slug: string, ticketToken: string) {
    this.assertEnabled();
    const event = await this.getEventBySlug(slug);
    const ticket = await this.prisma.concertTicket.findFirst({
      where: { publicToken: ticketToken },
      include: {
        order: { include: { event: true } },
      },
    });

    if (!ticket || ticket.order.eventId !== event.id) {
      return {
        valid: false,
        status: "invalid" as const,
        title: "Entrada no encontrada",
        message: "Este código no corresponde a una entrada válida del evento.",
      };
    }

    const ticketCode = formatTicketDisplayCode(ticket.publicToken);
    const firstName =
      ticket.order.buyerName.trim().split(/\s+/)[0] || ticket.order.buyerName;

    if (ticket.order.status !== ConcertOrderStatus.PAID) {
      return {
        valid: false,
        status: "pending" as const,
        title: "Pago en revisión",
        message: `Hola ${firstName}, estamos confirmando tu pago. Te avisaremos por correo cuando tu entrada esté lista.`,
        buyerName: ticket.order.buyerName,
        ticketCode,
      };
    }

    const eventTitle = event.title || CONCERT_TICKET_EMAIL.eventName;
    const eventHeadline = event.subtitle ?? CONCERT_TICKET_EMAIL.eventHeadline;

    if (ticket.checkedInAt) {
      return {
        valid: true,
        status: "used" as const,
        title: "Entrada utilizada",
        greeting: `Hola, ${firstName}`,
        message:
          "Esta entrada ya fue utilizada para ingresar al evento. Si crees que es un error, contacta al organizador en la puerta.",
        buyerName: ticket.order.buyerName,
        ticketCode,
        seatLabel: ticket.seatLabel,
        sectionCode: ticket.sectionCode,
        checkedInAt: ticket.checkedInAt,
        event: {
          title: eventTitle,
          headline: eventHeadline,
          venueName: event.venueName ?? CONCERT_TICKET_EMAIL.venueDefault,
          eventStartsAt: event.eventStartsAt,
          entryTimeLabel: CONCERT_TICKET_EMAIL.entryTimeLabel,
          mainArtist: CONCERT_TICKET_EMAIL.mainArtist,
        },
      };
    }

    return {
      valid: true,
      status: "confirmed" as const,
      title: "¡Entrada confirmada!",
      greeting: `¡Gracias por tu compra, ${firstName}!`,
      message:
        "Tu entrada es válida. Nos vemos el día del evento — te esperamos en Bodegón Monddy. Presenta tu QR en la entrada.",
      buyerName: ticket.order.buyerName,
      ticketCode,
      seatLabel: ticket.seatLabel,
      sectionCode: ticket.sectionCode,
      event: {
        title: eventTitle,
        headline: eventHeadline,
        venueName: event.venueName ?? CONCERT_TICKET_EMAIL.venueDefault,
        eventStartsAt: event.eventStartsAt,
        entryTimeLabel: CONCERT_TICKET_EMAIL.entryTimeLabel,
        mainArtist: CONCERT_TICKET_EMAIL.mainArtist,
        lineup: CONCERT_TICKET_EMAIL.lineup,
      },
    };
  }

  async getAdminOverview(organizationId: number) {
    assertDbAvailable(this.prisma);
    await this.assertConcertForOrganizationId(organizationId);
    const event = await this.prisma.concertEvent.findFirst({
      where: { organizationId, isActive: true },
      orderBy: { eventStartsAt: "asc" },
    });
    if (!event) {
      return { configured: false };
    }

    const [available, held, sold, pendingOrders, paidOrders] =
      await Promise.all([
        this.prisma.concertSeat.count({
          where: {
            section: { eventId: event.id },
            status: ConcertSeatStatus.AVAILABLE,
          },
        }),
        this.prisma.concertSeat.count({
          where: {
            section: { eventId: event.id },
            status: ConcertSeatStatus.HELD,
          },
        }),
        this.prisma.concertSeat.count({
          where: {
            section: { eventId: event.id },
            status: ConcertSeatStatus.SOLD,
          },
        }),
        this.prisma.concertOrder.count({
          where: {
            eventId: event.id,
            status: ConcertOrderStatus.PENDING_PAYMENT,
          },
        }),
        this.prisma.concertOrder.count({
          where: { eventId: event.id, status: ConcertOrderStatus.PAID },
        }),
      ]);

    return {
      configured: true,
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        eventStartsAt: event.eventStartsAt,
        publicUrl: `/evento/${event.slug}`,
      },
      stats: {
        available,
        held,
        sold,
        pendingOrders,
        paidOrders,
        totalSeats: available + held + sold,
      },
    };
  }

  async listOrders(organizationId: number, status?: ConcertOrderStatus) {
    await this.assertConcertForOrganizationId(organizationId);
    const event = await this.prisma.concertEvent.findFirst({
      where: { organizationId, isActive: true },
    });
    if (!event) return [];

    return this.prisma.concertOrder.findMany({
      where: {
        organizationId,
        eventId: event.id,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        tickets: {
          select: {
            id: true,
            seatLabel: true,
            sectionCode: true,
            checkedInAt: true,
          },
        },
      },
    });
  }

  /**
   * Busca órdenes por nombre del comprador o número de documento (cédula).
   * Búsqueda case-insensitive partial match.
   *
   * @param organizationId ID de la organización (multi-tenant)
   * @param searchTerm Término de búsqueda (mínimo 2 caracteres)
   * @returns Lista de órdenes que coinciden con el criterio
   * @throws BadRequestException si el término de búsqueda es muy corto
   */
  async searchOrdersByCustomer(organizationId: number, searchTerm: string) {
    await this.assertConcertForOrganizationId(organizationId);

    if (!searchTerm || searchTerm.trim().length < 2) {
      throw new BadRequestException(
        "El término de búsqueda debe tener al menos 2 caracteres",
      );
    }

    const normalizedSearch = searchTerm.trim().toLowerCase();

    const orders = await this.prisma.concertOrder.findMany({
      where: {
        organizationId,
        OR: [
          { buyerName: { contains: normalizedSearch, mode: "insensitive" } },
          {
            buyerIdDocument: {
              contains: normalizedSearch,
              mode: "insensitive",
            },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        tickets: {
          select: {
            id: true,
            seatLabel: true,
            sectionCode: true,
            checkedInAt: true,
            publicToken: true,
          },
        },
        event: {
          select: {
            title: true,
            venueName: true,
            eventStartsAt: true,
          },
        },
      },
    });

    return {
      count: orders.length,
      orders,
      searchTerm: searchTerm.trim(),
    };
  }

  private async getOrderDetail(organizationId: number, orderToken: string) {
    const order = await this.prisma.concertOrder.findFirst({
      where: { publicToken: orderToken, organizationId },
      include: { tickets: true, event: true },
    });
    if (!order) throw new NotFoundException("Orden no encontrada");
    return order;
  }

  async confirmOrder(organizationId: number, orderId: number, userId: number) {
    await this.assertConcertForOrganizationId(organizationId);
    const order = await this.prisma.concertOrder.findFirst({
      where: { id: orderId, organizationId },
    });
    if (!order) throw new NotFoundException("Orden no encontrada");
    return this.markOrderPaid(order.id, userId);
  }

  async resendOrderEmail(organizationId: number, orderId: number) {
    const order = await this.prisma.concertOrder.findFirst({
      where: { id: orderId, organizationId, status: ConcertOrderStatus.PAID },
      include: { event: true, tickets: true },
    });
    if (!order) throw new NotFoundException("Orden no encontrada o no pagada");
    if (!order.buyerEmail)
      throw new BadRequestException("Email del comprador no registrado");

    try {
      await this.emailService.sendConcertTicketsToBuyer(
        order,
        order.event,
        order.tickets,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Resend tickets email failed for order ${orderId}: ${message}`,
      );
      throw new BadRequestException(
        "No se pudo reenviar el email. Intente nuevamente.",
      );
    }

    await this.prisma.concertOrder.update({
      where: { id: orderId },
      data: { emailSentAt: new Date(), emailSentTo: order.buyerEmail },
    });
    this.logger.log(
      `Tickets email re-sent for order ${orderId} to ${order.buyerEmail}`,
    );
    return { ok: true, message: "Email reenviado" };
  }

  async getOrderForProof(organizationId: number, orderId: number) {
    const order = await this.prisma.concertOrder.findFirst({
      where: { id: orderId, organizationId },
      select: { id: true, organizationId: true, paymentProofUrl: true },
    });
    return order;
  }

  async adminSell(organizationId: number, userId: number, dto: AdminSellDto) {
    await this.assertConcertForOrganizationId(organizationId);
    const event = await this.prisma.concertEvent.findFirst({
      where: { organizationId, isActive: true },
      include: { organization: true },
    });
    if (!event) throw new NotFoundException("Evento no configurado");

    const hold = await this.holdSeats(event.slug, dto.seatIds);
    const checkout = await this.checkoutPublic(event.slug, {
      holdToken: hold.holdToken,
      buyerName: dto.buyerName,
      buyerIdDocument: dto.buyerIdDocument,
      buyerPhone: dto.buyerPhone,
      buyerEmail: dto.buyerEmail,
      paymentMethod: dto.paymentMethod,
      paymentReference: dto.paymentReference,
    });

    const order = await this.prisma.concertOrder.findUnique({
      where: { publicToken: checkout.orderPublicToken },
    });
    if (!order) throw new NotFoundException("Orden no encontrada");

    return this.markOrderPaid(order.id, userId);
  }

  async scanTicket(organizationId: number, userId: number, qrPayload: string) {
    await this.assertConcertForOrganizationId(organizationId);
    const parsed = parseTicketScanInput(qrPayload);
    const ticket = await this.prisma.concertTicket.findFirst({
      where: parsed.publicToken
        ? { publicToken: parsed.publicToken }
        : { qrPayload: parsed.qrPayload ?? qrPayload.trim() },
      include: {
        order: { include: { event: true } },
      },
    });
    if (!ticket || ticket.order.organizationId !== organizationId) {
      throw new NotFoundException("Entrada no válida");
    }
    if (ticket.order.status !== ConcertOrderStatus.PAID) {
      throw new BadRequestException("Entrada sin pago confirmado");
    }
    if (ticket.checkedInAt) {
      return {
        ok: false,
        alreadyUsed: true,
        checkedInAt: ticket.checkedInAt,
        buyerName: ticket.order.buyerName,
        seatLabel: ticket.seatLabel,
        sectionCode: ticket.sectionCode,
        message: "Esta entrada ya fue utilizada",
      };
    }

    const updated = await this.prisma.concertTicket.update({
      where: { id: ticket.id },
      data: { checkedInAt: new Date(), checkedInBy: userId },
    });

    return {
      ok: true,
      alreadyUsed: false,
      checkedInAt: updated.checkedInAt,
      buyerName: ticket.order.buyerName,
      seatLabel: ticket.seatLabel,
      sectionCode: ticket.sectionCode,
      eventTitle: ticket.order.event.title,
      message: "Acceso autorizado",
    };
  }

  async cancelOrder(organizationId: number, orderId: number) {
    await this.assertConcertForOrganizationId(organizationId);
    const order = await this.prisma.concertOrder.findFirst({
      where: { id: orderId, organizationId },
      include: { tickets: true },
    });
    if (!order) throw new NotFoundException("Orden no encontrada");
    if (order.status !== ConcertOrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        "Solo se pueden cancelar órdenes pendientes",
      );
    }

    const seatIds = order.tickets.map((t) => t.seatId).filter(Boolean);
    if (seatIds.length > 0) {
      await this.prisma.concertSeat.updateMany({
        where: { id: { in: seatIds } },
        data: {
          status: ConcertSeatStatus.AVAILABLE,
          heldUntil: null,
          holdToken: null,
          orderId: null,
        },
      });
    }

    await this.prisma.concertOrder.update({
      where: { id: orderId },
      data: { status: ConcertOrderStatus.CANCELLED },
    });

    return { ok: true, message: "Orden cancelada" };
  }

  private catalogEntryToSeat(
    sectionId: number,
    entry: SeatCatalogEntry,
    positionInMesa: number,
  ): Prisma.ConcertSeatCreateManyInput {
    return {
      sectionId,
      rowLabel: `M${entry.mesaNumber}`,
      seatNumber: positionInMesa,
      mesaNumber: entry.mesaNumber,
      displayNumber: entry.displayNumber,
      priceUsd: entry.priceUsd,
      priceBs: entry.priceBs,
      tierCode: entry.tierCode,
      tierLabel: entry.tierLabel,
    };
  }

  private buildSeatRowsFromCatalog(
    sectionId: number,
    sectionCode: "SALON" | "VIP",
  ): Prisma.ConcertSeatCreateManyInput[] {
    const entries = HEMENEGILDA_SEAT_CATALOG.filter(
      (e) => e.sectionCode === sectionCode,
    );
    const byMesa = new Map<number, SeatCatalogEntry[]>();
    for (const e of entries) {
      const list = byMesa.get(e.mesaNumber) ?? [];
      list.push(e);
      byMesa.set(e.mesaNumber, list);
    }
    const rows: Prisma.ConcertSeatCreateManyInput[] = [];
    for (const [, mesaEntries] of byMesa) {
      mesaEntries
        .sort((a, b) => a.displayNumber - b.displayNumber)
        .forEach((entry, idx) => {
          rows.push(this.catalogEntryToSeat(sectionId, entry, idx + 1));
        });
    }
    return rows;
  }

  /** Reemplaza layout grid antiguo por mesas + precios si aún no hay ventas. */
  private async rebuildLayoutIfStale(eventId: number, organizationId: number) {
    const total = await this.prisma.concertSeat.count({
      where: { section: { eventId } },
    });
    if (total === 98) {
      await this.syncSeatCatalog(organizationId);
      return;
    }
    const sold = await this.prisma.concertSeat.count({
      where: { section: { eventId }, status: ConcertSeatStatus.SOLD },
    });
    if (sold > 0) {
      throw new BadRequestException(
        "El evento usa un layout anterior y ya hay asientos vendidos. Contacte soporte MARFYL.",
      );
    }
    await this.prisma.concertSeat.deleteMany({
      where: { section: { eventId } },
    });
    await this.prisma.concertSection.deleteMany({ where: { eventId } });

    const salon = await this.prisma.concertSection.create({
      data: {
        eventId,
        code: "SALON",
        label: "Salón de eventos",
        rows: 0,
        cols: 0,
        sortOrder: 1,
      },
    });
    const vip = await this.prisma.concertSection.create({
      data: {
        eventId,
        code: "VIP",
        label: "Salón VIP",
        rows: 0,
        cols: 0,
        sortOrder: 2,
      },
    });
    await this.prisma.concertSeat.createMany({
      data: [
        ...this.buildSeatRowsFromCatalog(salon.id, "SALON"),
        ...this.buildSeatRowsFromCatalog(vip.id, "VIP"),
      ],
    });
    await this.syncSeatCatalog(organizationId);
  }

  /** Aplica precios y mesas del catálogo a un evento ya creado (sin borrar ventas). */
  async syncSeatCatalog(organizationId: number) {
    await this.assertConcertForOrganizationId(organizationId);
    const slug = process.env.CONCERT_DEFAULT_SLUG || "hemenegilda-capacidad";
    const event = await this.prisma.concertEvent.findFirst({
      where: { organizationId, slug },
      include: { sections: { include: { seats: true } } },
    });
    if (!event)
      throw new NotFoundException("Evento no configurado. Use setup primero.");

    for (const section of event.sections) {
      const code = section.code as "SALON" | "VIP";
      for (const entry of HEMENEGILDA_SEAT_CATALOG.filter(
        (e) => e.sectionCode === code,
      )) {
        await this.prisma.concertSeat.updateMany({
          where: {
            sectionId: section.id,
            displayNumber: entry.displayNumber,
          },
          data: {
            mesaNumber: entry.mesaNumber,
            priceUsd: entry.priceUsd,
            priceBs: entry.priceBs,
            tierCode: entry.tierCode,
            tierLabel: entry.tierLabel,
            rowLabel: `M${entry.mesaNumber}`,
          },
        });
      }
    }

    await this.prisma.concertEvent.update({
      where: { id: event.id },
      data: {
        priceUsdStandard: 40,
        priceUsdVip: 70,
        priceBsVip: 85,
        title: "Horacio Blanco Acústico en Íntimo — Bodegón Monddy",
        venueName: "Av. Francisco Solano, Chacaíto, Caracas",
      },
    });

    return { ok: true, message: "Catálogo de precios y mesas actualizado" };
  }

  /** Seed layout for Hemenegilda — 66 + 32 seats con precios por planilla */
  async ensureDefaultEvent(organizationId: number) {
    assertDbAvailable(this.prisma);
    const orgRow = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true, concertModuleEnabled: true },
    });
    if (!orgRow) throw new NotFoundException("Organización no encontrada");
    this.assertConcertForOrganization(orgRow);
    const slug = process.env.CONCERT_DEFAULT_SLUG || "hemenegilda-capacidad";
    const existing = await this.prisma.concertEvent.findFirst({
      where: { organizationId, slug },
    });
    if (existing) {
      await this.rebuildLayoutIfStale(existing.id, organizationId);
      return this.prisma.concertEvent.findFirstOrThrow({
        where: { id: existing.id },
      });
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException("Organización no encontrada");

    const event = await this.prisma.concertEvent.create({
      data: {
        organizationId,
        slug,
        title: "Horacio Blanco Acústico en Íntimo — Bodegón Monddy",
        subtitle: "Venta digital de entradas",
        venueName: "Av. Francisco Solano, Chacaíto, Caracas",
        eventStartsAt: new Date("2026-06-15T20:00:00.000Z"),
        priceUsdStandard: 40,
        priceUsdVip: 70,
        priceBsVip: 85,
        bankAccountName: "Inversiones Hemenegilda Capacidad",
        bankAccountInfo:
          "Transferencia a cuenta titular Inversiones Hemenegilda Capacidad (solicite datos al organizador).",
        pagoMovilInfo:
          "Pago móvil a Inversiones Hemenegilda Capacidad — indique referencia al pagar.",
        cashInstructions:
          "Efectivo solo en divisas (USD) en taquilla del local.",
        publicNotes:
          "Pago completo obligatorio. No se aceptan cuentas ni medios de pago digital extranjeros. Precios en USD y Bs según zona y mesa.",
      },
    });

    const salon = await this.prisma.concertSection.create({
      data: {
        eventId: event.id,
        code: "SALON",
        label: "Salón de eventos",
        rows: 0,
        cols: 0,
        sortOrder: 1,
      },
    });

    const vip = await this.prisma.concertSection.create({
      data: {
        eventId: event.id,
        code: "VIP",
        label: "Salón VIP",
        rows: 0,
        cols: 0,
        sortOrder: 2,
      },
    });

    await this.prisma.concertSeat.createMany({
      data: [
        ...this.buildSeatRowsFromCatalog(salon.id, "SALON"),
        ...this.buildSeatRowsFromCatalog(vip.id, "VIP"),
      ],
    });

    return event;
  }
}
