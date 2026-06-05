/** URL pública que el cliente abre al escanear el QR con la cámara del teléfono. */
export function buildPublicTicketUrl(
  frontendUrl: string,
  eventSlug: string,
  ticketPublicToken: string,
): string {
  const base = frontendUrl.replace(/\/$/, "");
  return `${base}/evento/${eventSlug}/boleto/${ticketPublicToken}`;
}

export function formatTicketDisplayCode(publicToken: string): string {
  return `EV-${publicToken.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** Normaliza lo leído por el escáner (URL, token o payload legacy). */
export function parseTicketScanInput(raw: string): {
  publicToken?: string;
  qrPayload?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const fromUrl = trimmed.match(/\/boleto\/([0-9a-f-]{36})/i);
  if (fromUrl) return { publicToken: fromUrl[1] };

  if (/^[0-9a-f-]{36}$/i.test(trimmed)) {
    return { publicToken: trimmed };
  }

  return { qrPayload: trimmed };
}

export function resolveTicketQrPayload(
  ticket: { publicToken: string; qrPayload: string },
  eventSlug: string,
  frontendUrl: string,
): string {
  if (
    ticket.qrPayload.startsWith("http://") ||
    ticket.qrPayload.startsWith("https://")
  ) {
    return ticket.qrPayload;
  }
  return buildPublicTicketUrl(frontendUrl, eventSlug, ticket.publicToken);
}
