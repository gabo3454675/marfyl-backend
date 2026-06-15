import "dotenv/config";
import * as path from "node:path";
import {
  extractPdfTextWithOcr,
  terminateOcrWorker,
} from "../../src/modules/fiscal-knowledge/pdf-extract-ocr";

async function main() {
  const file = process.argv[2] ?? "Providencia-0071.pdf";
  const full = path.join("conocimiento fiscal", file);
  const result = await extractPdfTextWithOcr(full, {
    onProgress: (m) => console.log(m),
  });
  console.log("\n--- resultado ---");
  console.log("usedOcr:", result.usedOcr);
  console.log("pages:", result.pageCount);
  console.log("chars:", result.text.length);
  console.log("preview:\n", result.text.slice(0, 500));
  await terminateOcrWorker();
}

main().catch(async (e) => {
  console.error(e);
  await terminateOcrWorker();
  process.exit(1);
});
