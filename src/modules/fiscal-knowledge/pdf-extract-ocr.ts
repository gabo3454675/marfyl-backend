import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker, type Worker } from "tesseract.js";
import { extractPdfText } from "./pdf-extract";

const nodeRequire = createRequire(__filename);
const pdfjsRoot = path.dirname(nodeRequire.resolve("pdfjs-dist/package.json"));
GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(pdfjsRoot, "legacy/build/pdf.worker.mjs"),
).href;

const PDFJS_WASM_URL = pathToFileURL(path.join(pdfjsRoot, "wasm/")).href;
const PDFJS_STANDARD_FONTS_URL = pathToFileURL(
  path.join(pdfjsRoot, "standard_fonts/"),
).href;

const MIN_NATIVE_TEXT_CHARS = 120;
const DEFAULT_OCR_LANG = "spa";
const RENDER_SCALE = 2;

export interface ExtractPdfOptions {
  forceOcr?: boolean;
  maxPages?: number;
  onProgress?: (message: string) => void;
}

let sharedWorker: Worker | null = null;

async function getOcrWorker(): Promise<Worker> {
  if (sharedWorker) return sharedWorker;
  sharedWorker = await createWorker(DEFAULT_OCR_LANG, 1, {
    logger: () => undefined,
  });
  return sharedWorker;
}

export async function terminateOcrWorker(): Promise<void> {
  if (sharedWorker) {
    await sharedWorker.terminate();
    sharedWorker = null;
  }
}

async function renderPdfPagesToPng(
  filePath: string,
  maxPages: number,
): Promise<Buffer[]> {
  const data = new Uint8Array(await fs.readFile(filePath));
  const doc = await getDocument({
    data,
    useSystemFonts: true,
    wasmUrl: PDFJS_WASM_URL,
    standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
  }).promise;
  const total = doc.numPages;
  const limit = maxPages > 0 ? Math.min(maxPages, total) : total;
  const images: Buffer[] = [];

  for (let pageNum = 1; pageNum <= limit; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const ctx = canvas.getContext("2d");
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;
    images.push(canvas.toBuffer("image/png"));
  }

  return images;
}

export async function extractPdfTextWithOcr(
  filePath: string,
  options: ExtractPdfOptions = {},
): Promise<{ text: string; usedOcr: boolean; pageCount: number }> {
  const log = options.onProgress ?? (() => undefined);
  const native = await extractPdfText(filePath);

  if (!options.forceOcr && native.trim().length >= MIN_NATIVE_TEXT_CHARS) {
    return { text: native, usedOcr: false, pageCount: 0 };
  }

  log(
    native.trim().length > 0
      ? `[ocr] Texto nativo insuficiente (${native.trim().length} chars), aplicando OCR…`
      : "[ocr] PDF sin capa de texto, aplicando OCR…",
  );

  const pageImages = await renderPdfPagesToPng(
    filePath,
    options.maxPages ?? 0,
  );
  log(`[ocr] ${pageImages.length} página(s) a procesar…`);

  const worker = await getOcrWorker();
  const parts: string[] = [];

  for (let i = 0; i < pageImages.length; i++) {
    const pageNum = i + 1;
    log(`[ocr] Página ${pageNum}/${pageImages.length}…`);
    const { data } = await worker.recognize(pageImages[i]);
    const pageText = data.text?.trim();
    if (pageText) parts.push(pageText);
  }

  const text = parts.join("\n\n").trim();
  if (!text) {
    throw new Error("OCR no extrajo texto legible del PDF");
  }

  return {
    text,
    usedOcr: true,
    pageCount: pageImages.length,
  };
}
