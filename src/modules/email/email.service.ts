import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { ConcertOrder, ConcertEvent, ConcertTicket } from "@prisma/client";
import * as QRCode from "qrcode";

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly emailEnabled: boolean;
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly ownerNotifyEmail: string;
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
      this.config.get<string>("RESEND_FROM_EMAIL") || "entradas@marfyl.com";
    this.fromName =
      this.config.get<string>("RESEND_FROM_NAME") || "MARFYL Entradas";
    this.ownerNotifyEmail =
      this.config.get<string>("CONCERT_OWNER_NOTIFY_EMAIL") ||
      "owner@example.com";
    this.frontendUrl =
      this.config.get<string>("FRONTEND_URL") || "http://localhost:3003";
  }

  // ─────────────────────────────────────────────────────────────
  // 1. Notify owner of a new PENDING order
  // ─────────────────────────────────────────────────────────────
  async sendConcertOrderPendingToOwner(
    order: ConcertOrder & { event?: ConcertEvent },
    event: ConcertEvent,
  ): Promise<void> {
    const to = this.ownerNotifyEmail;
    const subject = `🔔 Nueva orden pendiente — ${event.title}`;

    const html = this.buildOrderPendingHtml(order, event);

    await this.sendEmail({ to, subject, html });
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Send tickets to buyer after payment confirmation
  // ─────────────────────────────────────────────────────────────
  async sendConcertTicketsToBuyer(
    order: ConcertOrder & { event?: ConcertEvent; tickets?: ConcertTicket[] },
    event: ConcertEvent,
    tickets: ConcertTicket[],
  ): Promise<void> {
    if (!order.buyerEmail) {
      this.logger.warn(
        `Cannot send tickets: buyerEmail is null for order ${order.id}`,
      );
      return;
    }

    const to = order.buyerEmail;
    const subject = `🎫 Tus entradas — ${event.title}`;

    // Generate QR codes server-side
    const ticketsWithQr = await Promise.all(
      tickets.map(async (ticket) => {
        const qrDataUrl = await QRCode.toDataURL(ticket.qrPayload, {
          errorCorrectionLevel: "M",
          type: "image/png",
          width: 200,
          margin: 2,
        });
        return { ...ticket, qrDataUrl };
      }),
    );

    const html = this.buildTicketsHtml(order, event, ticketsWithQr);

    await this.sendEmail({ to, subject, html });
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Re-send tickets for an existing PAID order
  // ─────────────────────────────────────────────────────────────
  async resendConcertTickets(orderId: number): Promise<void> {
    // This is called from the service layer which already has the order data
    // The service layer will call sendConcertTicketsToBuyer directly
    this.logger.log(`Resend requested for order ${orderId}`);
  }

  // ─────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────
  public async sendEmail(params: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `Email omitido (sin RESEND_API_KEY): ${params.subject} → ${params.to}`,
      );
      return;
    }
    try {
      const result = await this.resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: params.to,
        subject: params.subject,
        html: params.html,
      });

      if (result.error) {
        this.logger.error(`Resend error: ${JSON.stringify(result.error)}`);
      } else {
        this.logger.log(`Email sent to ${params.to}: ${params.subject}`);
      }
    } catch (err) {
      this.logger.error(`Failed to send email to ${params.to}`, err);
    }
  }

  private buildOrderPendingHtml(
    order: ConcertOrder & { event?: ConcertEvent },
    event: ConcertEvent,
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

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nueva orden pendiente</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
    .container { background: #ffffff; border-radius: 8px; max-width: 600px; margin: 0 auto; padding: 30px; }
    .header { background: #1a1a2e; color: #ffffff; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
    .header h1 { margin: 0; font-size: 20px; }
    .header p { margin: 5px 0 0; opacity: 0.8; font-size: 13px; }
    .section { padding: 20px; border-bottom: 1px solid #eee; }
    .section:last-child { border-bottom: none; }
    .label { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; margin: 0 0 4px; }
    .value { font-size: 16px; font-weight: bold; color: #1a1a2e; margin: 0; }
    .amount { font-size: 28px; color: #e94560; font-weight: bold; }
    .amount small { font-size: 14px; color: #888; font-weight: normal; }
    .badge { display: inline-block; background: #f59e0b; color: #fff; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    .footer { background: #f9f9f9; padding: 20px; text-align: center; font-size: 12px; color: #888; }
    .btn { display: inline-block; background: #e94560; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎫 MARFYL Entradas</h1>
      <p>Nueva orden pendiente de confirmación</p>
    </div>

    <div class="section">
      <p class="label">Estado</p>
      <p><span class="badge">PENDIENTE DE PAGO</span></p>
    </div>

    <div class="section">
      <p class="label">Evento</p>
      <p class="value">${event.title}</p>
      <p style="font-size:13px; color:#666; margin-top:4px;">📍 ${event.venueName}</p>
      <p style="font-size:13px; color:#666; margin-top:4px;">📅 ${new Date(event.eventStartsAt).toLocaleString("es-VE", { dateStyle: "long", timeStyle: "short" })}</p>
    </div>

    <div class="section">
      <p class="label">Datos del comprador</p>
      <p class="value">${order.buyerName}</p>
      <p style="margin:4px 0 0; color:#555;">📞 ${order.buyerPhone}</p>
      <p style="margin:4px 0 0; color:#555;">🪪 ${order.buyerIdDocument}</p>
      ${order.buyerEmail ? `<p style="margin:4px 0 0; color:#555;">✉️ ${order.buyerEmail}</p>` : ""}
    </div>

    <div class="section">
      <p class="label">Monto total</p>
      <p class="amount">${formatUsd(Number(order.amountUsd))} <small>(Bs ${formatBs(Number(order.amountBs))})</small></p>
      <p style="margin-top:8px; font-size:13px; color:#666;">💳 Método: ${paymentMethodLabels[order.paymentMethod] || order.paymentMethod}</p>
      ${order.paymentReference ? `<p style="margin:4px 0 0; font-size:13px; color:#666;">🔖 Referencia: ${order.paymentReference}</p>` : ""}
    </div>

    <div class="section" style="text-align:center;">
      <a href="${this.frontendUrl}/concierto/ordenes" class="btn">Verificar ordenes</a>
    </div>

    <div class="footer">
      <p>MARFYL — Sistema de boletería digital</p>
      <p>No responda este correo. Contacte al organizador del evento.</p>
    </div>
  </div>
</body>
</html>`;
  }

  private buildTicketsHtml(
    order: ConcertOrder & { event?: ConcertEvent },
    event: ConcertEvent,
    tickets: (ConcertTicket & { qrDataUrl: string })[],
  ): string {
    const ticketRows = tickets
      .map(
        (t) => `
      <tr>
        <td style="padding:12px; border-bottom:1px solid #eee;">
          <strong style="font-size:14px; color:#1a1a2e;">${t.seatLabel}</strong>
          <br/><span style="font-size:12px; color:#888;">Sección ${t.sectionCode}</span>
        </td>
        <td style="padding:12px; border-bottom:1px solid #eee; text-align:center;">
          <img src="${t.qrDataUrl}" alt="QR" width="80" height="80" style="border-radius:8px;" />
        </td>
        <td style="padding:12px; border-bottom:1px solid #eee; text-align:right;">
          <a href="${this.frontendUrl}/evento/${event.slug}/entrada/${t.publicToken}" style="color:#e94560; font-size:12px; text-decoration:none;">Ver entrada →</a>
        </td>
      </tr>`,
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title> Tus entradas — ${event.title}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
    .container { background: #ffffff; border-radius: 8px; max-width: 600px; margin: 0 auto; padding: 0; overflow: hidden; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #ffffff; padding: 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; font-weight: bold; }
    .header p { margin: 8px 0 0; opacity: 0.8; font-size: 13px; }
    .event-info { background: #e94560; color: #fff; padding: 16px 30px; text-align: center; }
    .event-info p { margin: 0; font-size: 14px; }
    .event-info .venue { opacity: 0.9; font-size: 12px; margin-top: 4px; }
    .tickets { padding: 20px; }
    .tickets table { width: 100%; border-collapse: collapse; }
    .instruction { background: #f0f8ff; border: 1px solid #d0e8ff; border-radius: 8px; padding: 16px; margin: 0 20px 20px; text-align: center; font-size: 13px; color: #333; }
    .instruction strong { color: #1a1a2e; }
    .footer { background: #f9f9f9; padding: 20px; text-align: center; font-size: 12px; color: #888; margin-top: 20px; }
    .ticket-card { background: #fafafa; border: 1px solid #eee; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
    .ticket-card-header { background: #1a1a2e; color: #fff; padding: 10px 16px; font-size: 12px; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎫 ¡Tus entradas!</h1>
      <p>Confirmación de pago #${order.publicToken.slice(0, 8).toUpperCase()}</p>
    </div>

    <div class="event-info">
      <p><strong>${event.title}</strong></p>
      <p class="venue">📍 ${event.venueName}</p>
      <p class="venue">📅 ${new Date(event.eventStartsAt).toLocaleString("es-VE", { dateStyle: "long", timeStyle: "short" })}</p>
    </div>

    <div class="instruction">
      <strong>📋 Instrucciones</strong><br/>
      Presente el código QR en la entrada del evento. Cada QR es válido para un (1) ingreso.
    </div>

    <div class="tickets">
      <p style="font-size:12px; text-transform:uppercase; color:#888; margin:0 0 12px; letter-spacing:0.5px;">Sus entradas (${tickets.length})</p>
      <table>${ticketRows}</table>
    </div>

    <div class="footer">
      <p>Comprador: ${order.buyerName} | ${order.buyerPhone}</p>
      <p style="margin-top:8px;">MARFYL — Sistema de boletería digital</p>
      <p>No responda este correo. Contacte al organizador del evento.</p>
    </div>
  </div>
</body>
</html>`;
  }
}
