import * as QRCode from "qrcode";
import { GeneratedQrImage } from "../email.types";

const QR_OPTIONS: QRCode.QRCodeToBufferOptions = {
  errorCorrectionLevel: "M",
  type: "png",
  width: 280,
  margin: 2,
  color: {
    dark: "#0a0a0f",
    light: "#ffffff",
  },
};

export async function generateTicketQr(
  payload: string,
  contentId = "marfyl-ticket-qr",
): Promise<GeneratedQrImage> {
  const buffer = await QRCode.toBuffer(payload, QR_OPTIONS);
  const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
  return { buffer, dataUrl, contentId };
}
