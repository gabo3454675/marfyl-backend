export interface TicketEmailTemplateParams {
  clientName: string;
  ticketCode: string;
  eventName: string;
  eventHeadline?: string;
  mainArtist?: string;
  lineup?: string;
  entryTimeLabel?: string;
  showTimeLabel?: string;
  eventVenue?: string;
  eventDateLabel?: string;
  seatsSummary?: string;
  seatLabel?: string;
  sectionCode?: string;
  orderReference?: string;
  qrContentId: string;
}

const ACCENT = "#5eead4";
const ACCENT_SOFT = "#d1fae5";
const HEADER_GRADIENT =
  "linear-gradient(135deg,#0f172a 0%,#1e1b4b 45%,#0a0a0f 100%)";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.45);">${esc(label)}</p>
      <p style="margin:6px 0 0;font-size:15px;font-weight:600;color:#ffffff;line-height:1.45;">${value}</p>
    </td>
  </tr>`;
}

function buildEmailHeader(params: {
  mainArtist?: string;
  eventHeadline?: string;
  entryTimeLabel?: string;
  showTimeLabel?: string;
  eventDateLabel?: string;
  eventVenue?: string;
  venueLabel?: string;
}): string {
  const heroTitle =
    params.mainArtist || params.eventHeadline || "Concierto en vivo";
  const subtitle =
    params.mainArtist &&
    params.eventHeadline &&
    params.eventHeadline !== params.mainArtist
      ? params.eventHeadline
      : "";

  const scheduleParts: string[] = [];
  if (params.entryTimeLabel)
    scheduleParts.push(`Ingreso ${esc(params.entryTimeLabel)}`);
  if (params.showTimeLabel)
    scheduleParts.push(`Show ${esc(params.showTimeLabel)}`);
  else if (params.eventDateLabel)
    scheduleParts.push(esc(params.eventDateLabel));

  const scheduleLine = scheduleParts.join(" · ");
  const venueLine = [params.eventVenue, params.venueLabel]
    .filter(Boolean)
    .map(esc)
    .join(" · ");

  return `<tr>
    <td style="padding:28px 28px 20px;background:${HEADER_GRADIENT};border-bottom:1px solid rgba(94,234,212,0.15);">
      <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};">MARFYL · Boletería digital</p>
      <h1 style="margin:0;font-size:28px;line-height:1.2;font-weight:800;color:#ffffff;">${esc(heroTitle)}</h1>
      ${subtitle ? `<p style="margin:10px 0 0;font-size:16px;font-weight:600;color:rgba(255,255,255,0.88);">${esc(subtitle)}</p>` : ""}
      ${
        scheduleLine
          ? `<p style="margin:14px 0 0;font-size:17px;font-weight:700;color:${ACCENT};">${scheduleLine}</p>`
          : ""
      }
      ${
        venueLine
          ? `<p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.55);">📍 ${venueLine}</p>`
          : ""
      }
    </td>
  </tr>`;
}

function buildInstructionsBlock(text: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px;background:rgba(94,234,212,0.08);border:1px solid rgba(94,234,212,0.18);border-radius:14px;">
    <tr>
      <td style="padding:16px 18px;">
        <p style="margin:0;font-size:14px;line-height:1.6;color:${ACCENT_SOFT};">
          <strong style="color:${ACCENT};">Instrucciones:</strong>
          ${text}
        </p>
      </td>
    </tr>
  </table>`;
}

export function buildTicketEmailHtml(
  params: TicketEmailTemplateParams,
): string {
  const {
    clientName,
    ticketCode,
    eventName,
    eventHeadline,
    mainArtist,
    lineup,
    entryTimeLabel,
    showTimeLabel,
    eventVenue,
    eventDateLabel,
    seatsSummary,
    seatLabel,
    sectionCode,
    orderReference,
    qrContentId,
  } = params;

  const seatsText =
    seatsSummary ||
    (seatLabel
      ? `${seatLabel}${sectionCode ? ` · Sección ${sectionCode}` : ""}`
      : undefined);

  const detailsRows = [
    lineup ? detailRow("Artistas invitados", esc(lineup)) : "",
    seatsText ? detailRow("Tu(s) silla(s)", esc(seatsText)) : "",
  ]
    .filter(Boolean)
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${esc(mainArtist || eventHeadline || eventName)} — Boleto MARFYL</title>
</head>
<body style="margin:0;padding:0;background:#050508;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050508;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:linear-gradient(180deg,#12121a 0%,#0a0a0f 100%);border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.55);">
          ${buildEmailHeader({
            mainArtist,
            eventHeadline,
            entryTimeLabel,
            showTimeLabel,
            eventDateLabel,
            eventVenue,
            venueLabel: eventName,
          })}

          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 6px;font-size:15px;color:rgba(255,255,255,0.72);">Hola,</p>
              <p style="margin:0 0 22px;font-size:20px;font-weight:700;color:#ffffff;">${esc(clientName)}</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:rgba(255,255,255,0.78);">
                Gracias por tu compra. Tu boleto está confirmado — nos vemos el día del evento. Presenta el QR en la entrada.
              </p>

              ${
                detailsRows
                  ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:22px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;">
                <tr><td style="padding:18px 20px;">${detailsRows}</td></tr>
              </table>`
                  : ""
              }

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;">
                <tr>
                  <td style="padding:22px;text-align:center;">
                    <p style="margin:0 0 14px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.45);">Código del boleto</p>
                    <p style="margin:0 0 20px;font-size:28px;font-weight:800;letter-spacing:0.06em;color:${ACCENT};font-family:Consolas,Monaco,monospace;">${esc(ticketCode)}</p>
                    <img
                      src="cid:${esc(qrContentId)}"
                      alt="Código QR del boleto ${esc(ticketCode)}"
                      width="220"
                      height="220"
                      style="display:block;margin:0 auto;border-radius:14px;background:#ffffff;padding:10px;border:1px solid rgba(255,255,255,0.12);"
                    />
                  </td>
                </tr>
              </table>

              ${buildInstructionsBlock("Presenta este código QR en la entrada del evento para validar tu acceso. Cada QR es válido para un (1) ingreso.")}

              ${orderReference ? `<p style="margin:20px 0 0;font-size:12px;color:rgba(255,255,255,0.38);text-align:center;">Referencia: ${esc(orderReference)}</p>` : ""}
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px 26px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.38);">
                MARFYL — Facturación y control tributario<br/>
                Evento 18+ · No respondas a este mensaje.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export interface MultiTicketBlock {
  ticketCode: string;
  seatLabel?: string;
  sectionCode?: string;
  qrContentId: string;
}

export function buildMultiTicketEmailHtml(
  clientName: string,
  params: Omit<
    TicketEmailTemplateParams,
    "clientName" | "ticketCode" | "qrContentId"
  >,
  tickets: MultiTicketBlock[],
): string {
  const ticketSections = tickets
    .map(
      (t, index) => `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:${index === 0 ? "0" : "18px"};background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;">
        <tr>
          <td style="padding:20px;text-align:center;">
            <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.45);">Entrada ${index + 1}</p>
            <p style="margin:0 0 6px;font-size:14px;color:rgba(255,255,255,0.75);">${esc(t.seatLabel ?? "General")}${t.sectionCode ? ` · ${esc(t.sectionCode)}` : ""}</p>
            <p style="margin:0 0 16px;font-size:22px;font-weight:800;letter-spacing:0.05em;color:${ACCENT};font-family:Consolas,Monaco,monospace;">${esc(t.ticketCode)}</p>
            <img src="cid:${esc(t.qrContentId)}" alt="QR ${esc(t.ticketCode)}" width="180" height="180" style="display:block;margin:0 auto;border-radius:12px;background:#ffffff;padding:8px;" />
          </td>
        </tr>
      </table>`,
    )
    .join("");

  const detailsRows = [
    params.lineup ? detailRow("Artistas invitados", esc(params.lineup)) : "",
    params.seatsSummary
      ? detailRow("Tus sillas", esc(params.seatsSummary))
      : "",
  ]
    .filter(Boolean)
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="dark" />
  <title>${esc(params.mainArtist || params.eventHeadline || params.eventName)} — Entradas MARFYL</title>
</head>
<body style="margin:0;padding:0;background:#050508;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050508;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:linear-gradient(180deg,#12121a 0%,#0a0a0f 100%);border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;">
          ${buildEmailHeader({
            mainArtist: params.mainArtist,
            eventHeadline: params.eventHeadline,
            entryTimeLabel: params.entryTimeLabel,
            showTimeLabel: params.showTimeLabel,
            eventDateLabel: params.eventDateLabel,
            eventVenue: params.eventVenue,
            venueLabel: params.eventName,
          })}
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 6px;font-size:15px;color:rgba(255,255,255,0.72);">Hola,</p>
              <p style="margin:0 0 18px;font-size:20px;font-weight:700;color:#ffffff;">${esc(clientName)}</p>
              ${
                detailsRows
                  ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;"><tr><td style="padding:18px 20px;">${detailsRows}</td></tr></table>`
                  : ""
              }
              <p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:rgba(255,255,255,0.78);">
                Tus <strong style="color:#fff;">${tickets.length}</strong> entrada(s) confirmada(s):
              </p>
              ${ticketSections}
              ${buildInstructionsBlock("Presenta cada código QR en la entrada del evento para validar tu acceso.")}
              ${params.orderReference ? `<p style="margin:18px 0 0;font-size:12px;color:rgba(255,255,255,0.38);text-align:center;">Referencia: ${esc(params.orderReference)}</p>` : ""}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 26px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.38);">MARFYL · Evento 18+</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function formatEventDateLabel(
  date: Date | string | undefined,
): string | undefined {
  if (!date) return undefined;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleString("es-VE", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Caracas",
  });
}

export function formatShowTimeLabel(
  date: Date | string | undefined,
): string | undefined {
  if (!date) return undefined;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleString("es-VE", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Caracas",
  });
}

export function formatShowDateShort(
  date: Date | string | undefined,
): string | undefined {
  if (!date) return undefined;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("es-VE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Caracas",
  });
}
