import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { ConcertOrder, ConcertEvent, ConcertTicket } from "@prisma/client";
import {
  OwnerOrderSeatLine,
  SendEmailParams,
  TicketEmailOptions,
} from "./email.types";
import { generateTicketQr } from "./utils/qr-code.util";
import {
  buildMultiTicketEmailHtml,
  buildTicketEmailHtml,
  formatEventDateLabel,
  formatShowTimeLabel,
} from "./templates/ticket-email.template";
import {
  buildSeatsSummary,
  CONCERT_TICKET_EMAIL,
} from "./concert-ticket-email.constants";
import { resolveTicketQrPayload } from "@/common/utils/concert-ticket-qr.util";
import { toResendInlineAttachment } from "./utils/resend-attachment.util";

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly emailEnabled: boolean;
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly ownerNotifyEmails: string[];
  private readonly frontendUrl: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    this.emailEnabled = !!apiKey?.trim();
    this.resend = this.emailEnabled ? new Resend(apiKey) : null;
    if (!this.emailEnabled) {
      this.logger.warn(
        "RESEND_API_KEY no configurada — emails desactivados (dev local OK).",
      );
    }
    this.fromEmail =
      this.config.get<string>("RESEND_FROM_EMAIL") || "entradas@marfyl.site";
    this.fromName =
      this.config.get<string>("RESEND_FROM_NAME") || "MARFYL Entradas";
    this.ownerNotifyEmails = this.parseOwnerNotifyEmails(
      this.config.get<string>("CONCERT_OWNER_NOTIFY_EMAIL"),
    );
    this.frontendUrl =
      this.config.get<string>("FRONTEND_URL") || "http://localhost:3003";
  }

  /** Bienvenida tras alta self-service de cliente SaaS. */
  async sendWelcomeEmail(
    to: string,
    fullName: string,
    organizationName: string,
  ): Promise<boolean> {
    const recipient = to?.trim();
    if (!recipient) return false;

    const panelUrl = `${this.frontendUrl.replace(/\/$/, "")}/`;
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
        <h1 style="font-size:22px;margin-bottom:8px">Bienvenido a MARFYL</h1>
        <p>Hola <strong>${this.escapeHtml(fullName)}</strong>,</p>
        <p>Tu espacio <strong>${this.escapeHtml(organizationName)}</strong> está listo.</p>
        <p>Ya podés cargar productos, facturar, gestionar inventario e invitar a tu equipo.</p>
        <p style="margin:28px 0">
          <a href="${panelUrl}" style="background:#0d9488;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            Ir al panel
          </a>
        </p>
        <p style="font-size:13px;color:#64748b">Si no creaste esta cuenta, ignorá este correo.</p>
      </div>`;

    return this.dispatchEmail({
      to: recipient,
      subject: `Tu empresa ${organizationName} ya está activa en MARFYL`,
      html,
    });
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Envío genérico (invitaciones, notificaciones, etc.). */
  async sendEmail(params: {
    to: string;
    subject: string;
    html: string;
  }): Promise<boolean> {
    const recipient = params.to?.trim();
    if (!recipient) {
      this.logger.warn("sendEmail omitido: destinatario vacío");
      return false;
    }
    return this.dispatchEmail({
      to: recipient,
      subject: params.subject,
      html: params.html,
    });
  }

  async sendTicketEmail(
    to: string,
    clientName: string,
    ticketCode: string,
    options: TicketEmailOptions = {},
  ): Promise<boolean> {
    const recipient = to?.trim();
    if (!recipient) {
      this.logger.warn("sendTicketEmail omitido: destinatario vacío");
      return false;
    }

    try {
      const qrPayload = options.qrPayload?.trim() || ticketCode;
      const qrScanValue =
        options.eventSlug && options.ticketPublicToken
          ? resolveTicketQrPayload(
              { publicToken: options.ticketPublicToken, qrPayload },
              options.eventSlug,
              this.frontendUrl,
            )
          : qrPayload;
      const contentId = this.sanitizeContentId(`marfyl-qr-${ticketCode}`);
      const qr = await generateTicketQr(qrScanValue, contentId);

      const eventName =
        options.eventName?.trim() || CONCERT_TICKET_EMAIL.eventName;
      const emailSubjectArtist =
        options.mainArtist || options.eventHeadline || eventName;
      const html = buildTicketEmailHtml({
        clientName,
        ticketCode,
        eventName,
        eventHeadline:
          options.eventHeadline ?? CONCERT_TICKET_EMAIL.eventHeadline,
        mainArtist: options.mainArtist ?? CONCERT_TICKET_EMAIL.mainArtist,
        lineup: options.lineup ?? CONCERT_TICKET_EMAIL.lineup,
        entryTimeLabel:
          options.entryTimeLabel ?? CONCERT_TICKET_EMAIL.entryTimeLabel,
        showTimeLabel:
          options.showTimeLabel ?? formatShowTimeLabel(options.eventDate),
        eventVenue: options.eventVenue ?? CONCERT_TICKET_EMAIL.venueDefault,
        eventDateLabel: formatEventDateLabel(options.eventDate),
        seatsSummary: options.seatsSummary,
        seatLabel: options.seatLabel,
        sectionCode: options.sectionCode,
        orderReference: options.orderReference,
        qrContentId: qr.contentId,
      });

      return await this.dispatchEmail({
        to: recipient,
        subject: `🎫 Tu boleto — ${emailSubjectArtist}`,
        html,
        attachments: [
          {
            filename: `qr-${ticketCode}.png`,
            content: qr.buffer,
            contentId: qr.contentId,
            contentType: "image/png",
          },
        ],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `sendTicketEmail falló (${recipient}, ${ticketCode}): ${message}`,
      );
      return false;
    }
  }

  async sendConcertOrderPendingToOwner(
    order: ConcertOrder & { event?: ConcertEvent },
    event: ConcertEvent,
    seats: OwnerOrderSeatLine[] = [],
  ): Promise<boolean> {
    if (this.ownerNotifyEmails.length === 0) {
      this.logger.warn(
        "CONCERT_OWNER_NOTIFY_EMAIL vacío — no se notifica al owner.",
      );
      return false;
    }
    try {
      const html = this.buildOrderPendingHtml(order, event, seats);
      return await this.dispatchEmail({
        to: this.ownerNotifyEmails,
        subject: `🔔 Nueva compra en boletería — ${this.resolveEventDisplayName(event)}`,
        html,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `sendConcertOrderPendingToOwner falló (orden ${order.id}): ${message}`,
      );
      return false;
    }
  }

  private parseOwnerNotifyEmails(raw?: string): string[] {
    if (!raw?.trim()) return [];
    return raw
      .split(/[,;]/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@"));
  }

  async sendConcertTicketsToBuyer(
    order: ConcertOrder & { event?: ConcertEvent; tickets?: ConcertTicket[] },
    event: ConcertEvent,
    tickets: ConcertTicket[],
  ): Promise<boolean> {
    if (!order.buyerEmail?.trim()) {
      this.logger.warn(
        `No se envían boletos: buyerEmail vacío en orden ${order.id}`,
      );
      return false;
    }

    if (tickets.length === 0) {
      this.logger.warn(`No se envían boletos: orden ${order.id} sin tickets`);
      return false;
    }

    const emailContext = this.buildConcertEmailContext(event, tickets);

    try {
      if (tickets.length === 1) {
        const ticket = tickets[0];
        return await this.sendTicketEmail(
          order.buyerEmail,
          order.buyerName,
          this.formatTicketCode(ticket),
          {
            ...emailContext,
            seatLabel: ticket.seatLabel,
            sectionCode: ticket.sectionCode,
            qrPayload: ticket.qrPayload,
            eventSlug: event.slug,
            ticketPublicToken: ticket.publicToken,
            orderReference: order.publicToken.slice(0, 8).toUpperCase(),
          },
        );
      }

      const attachments: NonNullable<SendEmailParams["attachments"]> = [];
      const blocks = await Promise.all(
        tickets.map(async (ticket) => {
          const ticketCode = this.formatTicketCode(ticket);
          const contentId = this.sanitizeContentId(`marfyl-qr-${ticket.id}`);
          const qrScanValue = resolveTicketQrPayload(
            ticket,
            event.slug,
            this.frontendUrl,
          );
          const qr = await generateTicketQr(qrScanValue, contentId);
          attachments.push({
            filename: `qr-${ticketCode}.png`,
            content: qr.buffer,
            contentId: qr.contentId,
            contentType: "image/png",
          });
          return {
            ticketCode,
            seatLabel: ticket.seatLabel,
            sectionCode: ticket.sectionCode,
            qrContentId: qr.contentId,
          };
        }),
      );

      const html = buildMultiTicketEmailHtml(
        order.buyerName,
        {
          eventName: emailContext.eventName ?? CONCERT_TICKET_EMAIL.eventName,
          eventHeadline: emailContext.eventHeadline,
          mainArtist: emailContext.mainArtist,
          lineup: emailContext.lineup,
          entryTimeLabel: emailContext.entryTimeLabel,
          showTimeLabel: emailContext.showTimeLabel,
          eventVenue: emailContext.eventVenue,
          eventDateLabel: formatEventDateLabel(emailContext.eventDate),
          seatsSummary: emailContext.seatsSummary,
          orderReference: order.publicToken.slice(0, 8).toUpperCase(),
        },
        blocks,
      );

      return await this.dispatchEmail({
        to: order.buyerEmail.trim(),
        subject: `🎫 Tus entradas (${tickets.length}) — ${emailContext.mainArtist ?? emailContext.eventHeadline ?? emailContext.eventName}`,
        html,
        attachments,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `sendConcertTicketsToBuyer falló (orden ${order.id}): ${message}`,
      );
      return false;
    }
  }

  async resendConcertTickets(orderId: number): Promise<void> {
    this.logger.log(
      `Reenvío solicitado para orden ${orderId} — use ConcertService.resendOrderEmail`,
    );
  }

  private buildConcertEmailContext(
    event: ConcertEvent,
    tickets: ConcertTicket[],
  ): Omit<
    TicketEmailOptions,
    "seatLabel" | "sectionCode" | "qrPayload" | "orderReference"
  > {
    return {
      eventName: this.resolveEventDisplayName(event),
      eventHeadline: event.subtitle ?? CONCERT_TICKET_EMAIL.eventHeadline,
      mainArtist: CONCERT_TICKET_EMAIL.mainArtist,
      lineup: CONCERT_TICKET_EMAIL.lineup,
      entryTimeLabel: CONCERT_TICKET_EMAIL.entryTimeLabel,
      showTimeLabel: formatShowTimeLabel(event.eventStartsAt),
      eventVenue: event.venueName ?? CONCERT_TICKET_EMAIL.venueDefault,
      eventDate: event.eventStartsAt,
      seatsSummary: buildSeatsSummary(
        tickets.map((t) => ({
          seatLabel: t.seatLabel,
          sectionCode: t.sectionCode,
        })),
      ),
    };
  }

  private resolveEventDisplayName(event: ConcertEvent): string {
    if (
      event.title.toLowerCase().includes("bodegón") ||
      event.title.toLowerCase().includes("bodegon")
    ) {
      return CONCERT_TICKET_EMAIL.eventName;
    }
    return event.title || CONCERT_TICKET_EMAIL.eventName;
  }

  private sanitizeContentId(raw: string): string {
    const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
    return cleaned || "marfyl-ticket-qr";
  }

  private formatTicketCode(ticket: ConcertTicket): string {
    const shortToken = ticket.publicToken
      .replace(/-/g, "")
      .slice(0, 8)
      .toUpperCase();
    return `EV-${shortToken}`;
  }

  private async dispatchEmail(params: SendEmailParams): Promise<boolean> {
    if (!this.resend) {
      this.logger.warn(
        `Email omitido (sin RESEND_API_KEY): ${params.subject} → ${params.to}`,
      );
      return false;
    }

    try {
      const result = await this.resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: params.to,
        subject: params.subject,
        html: params.html,
        attachments: params.attachments?.map((a) =>
          toResendInlineAttachment(
            a.content,
            a.contentId,
            a.filename,
            a.contentType,
          ),
        ),
      } as Parameters<NonNullable<typeof this.resend>["emails"]["send"]>[0]);

      if (result.error) {
        this.logger.error(
          `Resend error (${params.to}): ${result.error.message ?? JSON.stringify(result.error)}`,
        );
        return false;
      }

      this.logger.log(`Email enviado → ${params.to}: ${params.subject}`);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error al enviar email a ${params.to}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    }
  }

  private buildOrderPendingHtml(
    order: ConcertOrder & { event?: ConcertEvent },
    event: ConcertEvent,
    seats: OwnerOrderSeatLine[] = [],
  ): string {
    const formatBs = (amount: number) =>
      new Intl.NumberFormat("es-VE", {
        style: "currency",
        currency: "VES",
      }).format(amount);
    const formatUsd = (amount: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amount);

    const paymentMethodLabels: Record<string, string> = {
      CASH_USD: "Efectivo USD",
      PAGO_MOVIL: "Pago Móvil",
      BANK_TRANSFER: "Transferencia bancaria",
    };

    const eventName = this.resolveEventDisplayName(event);
    const artistLine = CONCERT_TICKET_EMAIL.mainArtist;
    const headlineLine = event.subtitle ?? CONCERT_TICKET_EMAIL.eventHeadline;
    const seatsSummary = buildSeatsSummary(seats);
    const seatRows =
      seats.length > 0
        ? seats
            .map((s) => {
              const section = s.sectionCode ? ` · ${s.sectionCode}` : "";
              const price =
                s.priceUsd != null
                  ? ` — ${formatUsd(s.priceUsd)}`
                  : "";
              return `<li style="margin:6px 0;font-size:13px;">🪑 ${s.seatLabel}${section}${price}</li>`;
            })
            .join("")
        : `<li style="margin:6px 0;font-size:13px;color:rgba(255,255,255,0.55);">Asientos por confirmar</li>`;
    const paymentRef = order.paymentReference?.trim();
    const proofLine = order.paymentProofUrl?.trim()
      ? `<p style="margin:4px 0;font-size:13px;">📎 <a href="${order.paymentProofUrl}" style="color:#5eead4;">Comprobante de pago</a></p>`
      : "";
    const orderRef = order.publicToken?.slice(0, 8).toUpperCase() ?? String(order.id);

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8" /><meta name="color-scheme" content="dark" /></head>
<body style="margin:0;padding:24px;background:#050508;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#12121a;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
    <tr><td style="padding:24px;background:linear-gradient(135deg,#0f172a,#1e1b4b);color:#fff;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#5eead4;">MARFYL · Boletería</p>
      <h1 style="margin:0;font-size:22px;">🔔 Nueva orden pendiente</h1>
      <p style="margin:12px 0 0;font-size:20px;font-weight:700;color:#fff;">${artistLine}</p>
      <p style="margin:4px 0 0;font-size:14px;color:rgba(255,255,255,0.75);">${headlineLine}</p>
      <p style="margin:10px 0 0;font-size:15px;font-weight:600;color:#5eead4;">Ingreso ${CONCERT_TICKET_EMAIL.entryTimeLabel}</p>
    </td></tr>
    <tr><td style="padding:24px;color:rgba(255,255,255,0.85);">
      <p style="margin:0 0 8px;font-size:12px;color:#99f6e4;font-weight:700;letter-spacing:0.06em;">PENDIENTE DE PAGO</p>
      <p style="margin:4px 0;font-size:13px;color:rgba(255,255,255,0.6);">📍 ${event.venueName ?? CONCERT_TICKET_EMAIL.venueDefault}</p>
      <p style="margin:4px 0;font-size:13px;color:rgba(255,255,255,0.55);">${eventName}</p>
      <p style="margin:4px 0 16px;font-size:13px;color:rgba(255,255,255,0.6);">📅 ${formatEventDateLabel(event.eventStartsAt)}</p>
      <p style="margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.45);letter-spacing:0.08em;">ORDEN #${orderRef}</p>
      <p style="margin:0 0 4px;font-size:13px;"><strong>Comprador:</strong> ${order.buyerName}</p>
      <p style="margin:4px 0;font-size:13px;">📞 ${order.buyerPhone} · 🪪 ${order.buyerIdDocument}</p>
      ${order.buyerEmail ? `<p style="margin:4px 0;font-size:13px;">✉️ ${order.buyerEmail}</p>` : ""}
      <p style="margin:16px 0 8px;font-size:12px;font-weight:700;color:#99f6e4;letter-spacing:0.06em;">ASIENTOS (${seats.length || "—"})</p>
      <ul style="margin:0 0 16px;padding-left:18px;list-style:none;">${seatRows}</ul>
      <p style="margin:0 0 4px;font-size:12px;color:rgba(255,255,255,0.5);">Resumen: ${seatsSummary}</p>
      <p style="margin:16px 0 4px;font-size:24px;font-weight:800;color:#5eead4;">${formatUsd(Number(order.amountUsd))}</p>
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.55);">Bs ${formatBs(Number(order.amountBs))} · Tasa ${Number(order.exchangeRate).toFixed(2)}</p>
      <p style="margin:8px 0 0;font-size:13px;">💳 ${paymentMethodLabels[order.paymentMethod] || order.paymentMethod}</p>
      ${paymentRef ? `<p style="margin:4px 0;font-size:13px;">🔖 Referencia: <strong>${paymentRef}</strong></p>` : ""}
      ${proofLine}
      <p style="margin:20px 0 0;text-align:center;"><a href="${this.frontendUrl}/concierto/ordenes" style="display:inline-block;background:#5eead4;color:#0a0a0f;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700;">Verificar y confirmar pago</a></p>
    </td></tr>
  </table>
</body></html>`;
  }
}
