import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Groq } from "groq-sdk";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ExpensesService } from "./expenses.service";
import { getCompanyIdFromOrganization } from "@/common/helpers/organization.helper";

/** Modelos Groq con visión (OCR). llama-3.1-8b-instant NO soporta imágenes. */
const DEFAULT_GROQ_VISION_PRIMARY = "meta-llama/llama-4-scout-17b-16e-instruct";
const DEFAULT_GROQ_VISION_FALLBACK = "meta-llama/llama-4-maverick-17b-128e-instruct";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash-lite";

const RECEIPT_OCR_PROMPT = `Analiza esta factura o recibo comercial venezolano (puede ser foto inclinada).
Responde SOLO con un objeto JSON válido (sin markdown ni texto extra) con esta estructura:
{
  "vendorName": string|null,
  "vendorTaxId": string|null,
  "documentNumber": string|null,
  "issueDate": "YYYY-MM-DD"|null,
  "condition": "CONTADO"|"CREDITO"|null,
  "totalUsd": number|null,
  "totalBs": number|null,
  "referenceFactor": number|null,
  "lines": [
    {
      "name": string,
      "quantity": number,
      "unit": string|null,
      "unitCostUsd": number|null,
      "lineTotalUsd": number|null
    }
  ],
  "warnings": string[]
}
Reglas:
- quantity >= 1 entero cuando sea posible.
- unitCostUsd: precio unitario en USD/ref si aparece; si solo hay Bs, estima con referenceFactor si existe.
- lineTotalUsd: total de la línea en USD/ref.
- Ignora filas vacías o encabezados.
- Si no puedes leer un campo, usa null y agrega warning.`;

export type ScannedReceiptLine = {
  name: string;
  quantity: number;
  unit: string | null;
  unitCostUsd: number | null;
  lineTotalUsd: number | null;
  matchedProductId: number | null;
  matchedProductName: string | null;
  action: "match" | "create";
};

export type ScannedReceiptResult = {
  vendorName: string | null;
  vendorTaxId: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  condition: string | null;
  totalUsd: number | null;
  totalBs: number | null;
  referenceFactor: number | null;
  lines: ScannedReceiptLine[];
  warnings: string[];
};

@Injectable()
export class ReceiptScanService {
  private readonly logger = new Logger(ReceiptScanService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly expensesService: ExpensesService,
  ) {}

  async scanReceiptImage(file: Express.Multer.File): Promise<ScannedReceiptResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Imagen no válida");
    }
    const mime = file.mimetype || "image/jpeg";
    if (!mime.startsWith("image/")) {
      throw new BadRequestException("Solo se admiten imágenes (JPEG, PNG, WebP).");
    }

    try {
      const text = await this.extractReceiptJsonText(file, mime);
      const parsed = this.parseReceiptJson(text);
      return this.normalizeScanResult(parsed);
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) {
        throw err;
      }
      this.logger.warn(`Receipt OCR failed: ${String(err)}`);
      throw new BadRequestException(
        "No se pudo interpretar la imagen. Intente con mejor luz y encuadre.",
      );
    }
  }

  /** Groq Vision (Scout → Maverick) → Gemini Vision (fallback opcional). */
  private async extractReceiptJsonText(
    file: Express.Multer.File,
    mime: string,
  ): Promise<string> {
    const groqKey = this.config.get<string>("GROQ_API_KEY")?.trim();
    if (groqKey) {
      const visionModels = this.resolveGroqVisionModels();
      let lastErr: unknown;
      for (const model of visionModels) {
        try {
          return await this.extractWithGroq(file, mime, groqKey, model);
        } catch (err) {
          lastErr = err;
          this.logger.warn(`Groq OCR (${model}) failed: ${String(err)}`);
        }
      }
      const geminiKey = this.config.get<string>("GEMINI_API_KEY")?.trim();
      if (geminiKey) {
        this.logger.warn("Todos los modelos Groq visión fallaron; probando Gemini…");
        return this.extractWithGemini(file, mime, geminiKey);
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    }

    const geminiKey = this.config.get<string>("GEMINI_API_KEY")?.trim();
    if (geminiKey) {
      return this.extractWithGemini(file, mime, geminiKey);
    }

    throw new ServiceUnavailableException(
      "OCR no configurado. Defina GROQ_API_KEY (visión: Scout/Maverick) o GEMINI_API_KEY en el servidor.",
    );
  }

  /** Primary + fallbacks: env GROQ_VISION_MODEL, GROQ_VISION_MODEL_FALLBACK (csv), defaults Scout→Maverick. */
  private resolveGroqVisionModels(): string[] {
    const primary =
      this.config.get<string>("GROQ_VISION_MODEL")?.trim() ||
      DEFAULT_GROQ_VISION_PRIMARY;
    const extraRaw =
      this.config.get<string>("GROQ_VISION_MODEL_FALLBACK")?.trim() || "";
    const extras = extraRaw
      ? extraRaw.split(",").map((m) => m.trim()).filter(Boolean)
      : [DEFAULT_GROQ_VISION_FALLBACK];
    return [...new Set([primary, ...extras])];
  }

  private async extractWithGroq(
    file: Express.Multer.File,
    mime: string,
    apiKey: string,
    model: string,
  ): Promise<string> {
    const groq = new Groq({ apiKey });
    const dataUrl = `data:${mime};base64,${file.buffer.toString("base64")}`;

    const completion = await groq.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: RECEIPT_OCR_PROMPT },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      top_p: 1,
      max_completion_tokens: 4096,
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      throw new BadRequestException(
        `Groq (${model}) no devolvió contenido para la imagen.`,
      );
    }
    this.logger.log(`Receipt OCR OK via Groq model ${model}`);
    return text;
  }

  private async extractWithGemini(
    file: Express.Multer.File,
    mime: string,
    apiKey: string,
  ): Promise<string> {
    const modelName =
      this.config.get<string>("GEMINI_MODEL")?.trim() || DEFAULT_GEMINI_MODEL;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent([
      {
        inlineData: {
          data: file.buffer.toString("base64"),
          mimeType: mime,
        },
      },
      { text: RECEIPT_OCR_PROMPT },
    ]);
    const text = result.response.text().trim();
    if (!text) {
      throw new BadRequestException("Gemini no devolvió contenido para la imagen.");
    }
    return text;
  }

  private parseReceiptJson(text: string): Partial<ScannedReceiptResult> {
    const jsonStr = text.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(jsonStr) as Partial<ScannedReceiptResult>;
  }

  private normalizeScanResult(raw: Partial<ScannedReceiptResult>): ScannedReceiptResult {
    const lines = (raw.lines ?? [])
      .map((l) => ({
        name: String(l?.name ?? "").trim(),
        quantity: Math.max(1, Math.round(Number(l?.quantity) || 1)),
        unit: l?.unit ? String(l.unit).trim() : null,
        unitCostUsd:
          l?.unitCostUsd != null && Number.isFinite(Number(l.unitCostUsd))
            ? Number(l.unitCostUsd)
            : null,
        lineTotalUsd:
          l?.lineTotalUsd != null && Number.isFinite(Number(l.lineTotalUsd))
            ? Number(l.lineTotalUsd)
            : null,
        matchedProductId: null,
        matchedProductName: null,
        action: "create" as const,
      }))
      .filter((l) => l.name.length > 0);

    return {
      vendorName: raw.vendorName ? String(raw.vendorName).trim() : null,
      vendorTaxId: raw.vendorTaxId ? String(raw.vendorTaxId).trim() : null,
      documentNumber: raw.documentNumber ? String(raw.documentNumber).trim() : null,
      issueDate: raw.issueDate ? String(raw.issueDate).trim() : null,
      condition: raw.condition ? String(raw.condition).trim() : null,
      totalUsd:
        raw.totalUsd != null && Number.isFinite(Number(raw.totalUsd))
          ? Number(raw.totalUsd)
          : null,
      totalBs:
        raw.totalBs != null && Number.isFinite(Number(raw.totalBs))
          ? Number(raw.totalBs)
          : null,
      referenceFactor:
        raw.referenceFactor != null && Number.isFinite(Number(raw.referenceFactor))
          ? Number(raw.referenceFactor)
          : null,
      lines,
      warnings: Array.isArray(raw.warnings)
        ? raw.warnings.map((w) => String(w))
        : [],
    };
  }

  async matchLinesToCatalog(
    organizationId: number,
    scan: ScannedReceiptResult,
  ): Promise<ScannedReceiptResult> {
    const products = await this.prisma.product.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, name: true, sku: true, barcode: true },
    });

    const normalize = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const lines = scan.lines.map((line) => {
      const key = normalize(line.name);
      let best: (typeof products)[0] | null = null;
      let bestScore = 0;
      for (const p of products) {
        const pn = normalize(p.name);
        if (pn === key) {
          best = p;
          bestScore = 100;
          break;
        }
        if (pn.includes(key) || key.includes(pn)) {
          const score = Math.min(pn.length, key.length);
          if (score > bestScore) {
            bestScore = score;
            best = p;
          }
        }
      }
      if (best && bestScore >= 8) {
        return {
          ...line,
          matchedProductId: best.id,
          matchedProductName: best.name,
          action: "match" as const,
        };
      }
      return { ...line, action: "create" as const };
    });

    return { ...scan, lines };
  }

  async confirmReceipt(params: {
    organizationId: number;
    userId: number;
    mode: "inventory" | "expense";
    scan: ScannedReceiptResult;
    categoryId?: number;
    supplierId?: number;
    status?: "PAID" | "PENDING";
  }) {
    const { organizationId, userId, mode, scan } = params;
    if (!scan.lines.length) {
      throw new BadRequestException("No hay líneas para registrar.");
    }

    const companyId = await getCompanyIdFromOrganization(
      this.prisma,
      organizationId,
    );

    if (mode === "inventory") {
      const purchaseLines: {
        productId: number;
        quantity: number;
        unitCostUsd?: number;
      }[] = [];

      for (const line of scan.lines) {
        let productId = line.matchedProductId;
        const unitCost =
          line.unitCostUsd ??
          (line.lineTotalUsd != null && line.quantity > 0
            ? line.lineTotalUsd / line.quantity
            : 0);

        if (!productId) {
          const created = await this.prisma.product.create({
            data: {
              companyId,
              organizationId,
              name: line.name.slice(0, 200),
              costPrice: unitCost,
              salePrice: unitCost > 0 ? unitCost * 1.3 : 0,
              stock: 0,
              minStock: 5,
            },
          });
          productId = created.id;
        }

        purchaseLines.push({
          productId,
          quantity: line.quantity,
          unitCostUsd: unitCost > 0 ? unitCost : undefined,
        });
      }

      const totalAmount =
        scan.totalUsd ??
        purchaseLines.reduce((sum, pl, i) => {
          const line = scan.lines[i];
          const unit =
            pl.unitCostUsd ??
            (line.lineTotalUsd != null && line.quantity > 0
              ? line.lineTotalUsd / line.quantity
              : 0);
          return sum + unit * pl.quantity;
        }, 0);

      if (!params.categoryId) {
        throw new BadRequestException("categoryId es obligatorio para compra/inventario.");
      }

      return this.expensesService.create(
        {
          date: scan.issueDate ?? new Date().toISOString().slice(0, 10),
          amount: Math.max(0.01, totalAmount),
          description:
            scan.vendorName
              ? `Compra ${scan.vendorName}${scan.documentNumber ? ` #${scan.documentNumber}` : ""}`
              : `Compra por escaneo OCR`,
          categoryId: params.categoryId,
          supplierId: params.supplierId,
          referenceNumber: scan.documentNumber ?? undefined,
          supplierInvoiceNumber: scan.documentNumber ?? undefined,
          status: params.status ?? (scan.condition === "CREDITO" ? "PENDING" : "PAID"),
          purchaseLines,
        },
        organizationId,
        userId,
      );
    }

    if (!params.categoryId) {
      throw new BadRequestException("categoryId es obligatorio para gasto operativo.");
    }

    const amount =
      scan.totalUsd ??
      scan.lines.reduce((s, l) => s + (l.lineTotalUsd ?? 0), 0);

    return this.expensesService.create(
      {
        date: scan.issueDate ?? new Date().toISOString().slice(0, 10),
        amount: Math.max(0.01, amount),
        description:
          scan.vendorName
            ? `Gasto ${scan.vendorName}${scan.documentNumber ? ` #${scan.documentNumber}` : ""}`
            : "Gasto operativo por escaneo OCR",
        categoryId: params.categoryId,
        supplierId: params.supplierId,
        referenceNumber: scan.documentNumber ?? undefined,
        status: params.status ?? (scan.condition === "CREDITO" ? "PENDING" : "PAID"),
      },
      organizationId,
      userId,
    );
  }
}
