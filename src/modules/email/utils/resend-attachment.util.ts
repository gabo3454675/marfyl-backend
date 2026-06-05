/** Formato que espera la API de Resend para imágenes inline (CID). */
export interface ResendApiAttachment {
  filename: string;
  content: string;
  content_type: string;
  content_id: string;
}

export function toResendInlineAttachment(
  buffer: Buffer,
  contentId: string,
  filename: string,
  contentType = "image/png",
): ResendApiAttachment {
  return {
    filename,
    content: buffer.toString("base64"),
    content_type: contentType,
    content_id: contentId,
  };
}
