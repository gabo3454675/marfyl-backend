/**
 * Fuerza DATABASE_URL = STAGING_DB antes de que Nest/Prisma arranquen.
 * Abort si apunta a producción (ep-super-art) o no es staging (ep-curly-star).
 */
import * as fs from "fs";
import * as path from "path";

const STAGING_HOST_MARKER = "ep-curly-star";
const PROD_HOST_MARKER = "ep-super-art";

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = parseEnvFile(path.join(__dirname, "..", ".env"));
const stagingUrl = process.env.STAGING_DB || fileEnv.STAGING_DB || "";

if (!stagingUrl) {
  throw new Error(
    "[e2e] STAGING_DB no definido en process.env ni en .env — abortando.",
  );
}
if (stagingUrl.includes(PROD_HOST_MARKER)) {
  throw new Error(
    `[e2e] Abortado: STAGING_DB apunta a producción (${PROD_HOST_MARKER}).`,
  );
}
if (!stagingUrl.includes(STAGING_HOST_MARKER)) {
  throw new Error(
    `[e2e] Abortado: STAGING_DB debe contener ${STAGING_HOST_MARKER} (staging).`,
  );
}

process.env.STAGING_DB = stagingUrl;
process.env.DATABASE_URL = stagingUrl;
