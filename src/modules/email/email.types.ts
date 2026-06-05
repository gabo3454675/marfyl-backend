export interface TicketEmailOptions {
  eventName?: string;
  eventHeadline?: string;
  mainArtist?: string;
  lineup?: string;
  entryTimeLabel?: string;
  showTimeLabel?: string;
  eventVenue?: string;
  eventDate?: Date | string;
  seatsSummary?: string;
  seatLabel?: string;
  sectionCode?: string;
  qrPayload?: string;
  eventSlug?: string;
  ticketPublicToken?: string;
  orderReference?: string;
}

export interface EmailAttachmentInline {
  filename: string;
  content: Buffer;
  contentId: string;
  contentType?: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachmentInline[];
}

export interface GeneratedQrImage {
  buffer: Buffer;
  dataUrl: string;
  contentId: string;
}
