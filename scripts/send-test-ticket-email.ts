/**
 * Envío de prueba de boleto(s) con QR inline (CID + base64 para Resend/Gmail).
 * Uso:
 *   npx tsx scripts/send-test-ticket-email.ts [email] [nombre] [cantidad]
 * Ejemplo 2 entradas: npx tsx scripts/send-test-ticket-email.ts glonga10@gmail.com "Germán Longa" 2
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';
import { generateTicketQr } from '../src/modules/email/utils/qr-code.util';
import {
  buildMultiTicketEmailHtml,
  buildTicketEmailHtml,
  formatEventDateLabel,
  formatShowTimeLabel,
} from '../src/modules/email/templates/ticket-email.template';
import { CONCERT_TICKET_EMAIL } from '../src/modules/email/concert-ticket-email.constants';
import { buildPublicTicketUrl } from '../src/common/utils/concert-ticket-qr.util';
import { toResendInlineAttachment } from '../src/modules/email/utils/resend-attachment.util';

function loadEnvFile() {
  try {
    const raw = readFileSync(resolve(__dirname, '../.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* .env opcional */
  }
}

loadEnvFile();

async function main() {
  const to = process.argv[2]?.trim() || 'glonga10@gmail.com';
  const clientName = process.argv[3]?.trim() || 'Germán Longa';
  const ticketCount = Math.min(Math.max(parseInt(process.argv[4] ?? '1', 10) || 1, 1), 10);
  const eventDate = new Date('2026-06-15T22:00:00.000Z');
  const slug = process.env.CONCERT_DEFAULT_SLUG || 'hemenegilda-capacidad';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3003';

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error('❌ RESEND_API_KEY no definida en .env');
    process.exit(1);
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const fromName = process.env.RESEND_FROM_NAME || 'MARFYL Entradas';
  const resend = new Resend(apiKey);

  const emailBase = {
    eventName: CONCERT_TICKET_EMAIL.eventName,
    eventHeadline: CONCERT_TICKET_EMAIL.eventHeadline,
    mainArtist: CONCERT_TICKET_EMAIL.mainArtist,
    lineup: CONCERT_TICKET_EMAIL.lineup,
    entryTimeLabel: CONCERT_TICKET_EMAIL.entryTimeLabel,
    showTimeLabel: formatShowTimeLabel(eventDate),
    eventVenue: CONCERT_TICKET_EMAIL.venueDefault,
    eventDateLabel: formatEventDateLabel(eventDate),
  };

  if (ticketCount === 1) {
    const ticketPublicToken = randomUUID();
    const ticketCode = `EV-${ticketPublicToken.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const qrScanUrl = buildPublicTicketUrl(frontendUrl, slug, ticketPublicToken);
    const contentId = 'marfyl-qr-1';
    const qr = await generateTicketQr(qrScanUrl, contentId);
    const html = buildTicketEmailHtml({
      clientName,
      ticketCode,
      ...emailBase,
      seatsSummary: 'Mesa 3 · Asiento 12 (VIP)',
      orderReference: ticketCode,
      qrContentId: contentId,
    });

    const result = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to,
      subject: `🎫 Tu boleto — ${CONCERT_TICKET_EMAIL.mainArtist}`,
      html,
      attachments: [toResendInlineAttachment(qr.buffer, contentId, `qr-${ticketCode}.png`)],
    } as Parameters<typeof resend.emails.send>[0]);

    if (result.error) {
      console.error('❌ Resend error:', result.error);
      process.exit(1);
    }

    console.log(`✅ Email (1 entrada) enviado a ${to}`);
    console.log(`   ID: ${result.data?.id}`);
    console.log(`   Boleto: ${ticketCode}`);
    return;
  }

  const attachments: ReturnType<typeof toResendInlineAttachment>[] = [];
  const blocks = await Promise.all(
    Array.from({ length: ticketCount }, async (_, index) => {
      const ticketPublicToken = randomUUID();
      const ticketCode = `EV-${ticketPublicToken.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      const qrScanUrl = buildPublicTicketUrl(frontendUrl, slug, ticketPublicToken);
      const contentId = `marfyl-qr-${index + 1}`;
      const qr = await generateTicketQr(qrScanUrl, contentId);
      attachments.push(toResendInlineAttachment(qr.buffer, contentId, `qr-${ticketCode}.png`));
      return {
        ticketCode,
        seatLabel: `Asiento ${index + 1}`,
        sectionCode: index === 0 ? 'VIP' : 'SALON',
        qrContentId: contentId,
      };
    }),
  );

  const html = buildMultiTicketEmailHtml(
    clientName,
    {
      ...emailBase,
      seatsSummary: blocks.map((b) => `${b.sectionCode} · ${b.seatLabel}`).join(' · '),
      orderReference: 'TEST-MULTI',
    },
    blocks,
  );

  const result = await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to,
    subject: `🎫 Tus entradas (${ticketCount}) — ${CONCERT_TICKET_EMAIL.mainArtist}`,
    html,
    attachments,
  } as Parameters<typeof resend.emails.send>[0]);

  if (result.error) {
    console.error('❌ Resend error:', result.error);
    process.exit(1);
  }

  console.log(`✅ Email (${ticketCount} entradas) enviado a ${to}`);
  console.log(`   ID: ${result.data?.id}`);
  console.log(`   Boletos: ${blocks.map((b) => b.ticketCode).join(', ')}`);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
