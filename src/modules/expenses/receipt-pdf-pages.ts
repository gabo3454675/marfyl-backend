import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

const nodeRequire = createRequire(__filename);
const pdfjsRoot = path.dirname(nodeRequire.resolve("pdfjs-dist/package.json"));
GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(pdfjsRoot, "legacy/build/pdf.worker.mjs"),
).href;

const PDFJS_WASM_URL = pathToFileURL(path.join(pdfjsRoot, "wasm/")).href;
const PDFJS_STANDARD_FONTS_URL = pathToFileURL(
  path.join(pdfjsRoot, "standard_fonts/"),
).href;

const MAX_PAGES = 2;
const MAX_EDGE = 1600;

/** Renderiza las primeras páginas de un PDF a JPEG para visión OCR. */
export async function renderPdfBufferToJpegs(
  buffer: Buffer,
  maxPages = MAX_PAGES,
): Promise<Buffer[]> {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    wasmUrl: PDFJS_WASM_URL,
    standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
  }).promise;
  const limit = Math.min(Math.max(1, maxPages), doc.numPages);
  const images: Buffer[] = [];

  for (let pageNum = 1; pageNum <= limit; pageNum++) {
    const page = await doc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, MAX_EDGE / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale: Math.max(1, scale) });
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
    images.push(canvas.toBuffer("image/jpeg", 82));
  }

  return images;
}
