/** Unidades por tobo (balde) de cerveza. */
export const BOTTLES_PER_TOBO = 12;
/** Tobos que forman una caja de cerveza. */
export const TOBOS_PER_CASE = 3;
export const BOTTLES_PER_CASE = BOTTLES_PER_TOBO * TOBOS_PER_CASE;

export type LiquorBucket =
  | "cerveza_light"
  | "cerveza_negra"
  | "whisky"
  | "otros_licores";

export function packFromBottles(bottles: number) {
  const fullTobos = Math.floor(bottles / BOTTLES_PER_TOBO);
  const looseBottles = bottles % BOTTLES_PER_TOBO;
  const fullCases = Math.floor(fullTobos / TOBOS_PER_CASE);
  const leftoverTobos = fullTobos % TOBOS_PER_CASE;
  return {
    bottles,
    tobos: fullTobos,
    looseBottles,
    cajas: fullCases,
    tobosSueltos: leftoverTobos,
    tobosExact: Math.round((bottles / BOTTLES_PER_TOBO) * 100) / 100,
    cajasExact: Math.round((bottles / BOTTLES_PER_CASE) * 100) / 100,
  };
}

function norm(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Excluye falsos positivos (malta, refrescos light, etc.). */
function isExcluded(n: string) {
  if (/\bMALTIN\b|\bMALTA\b/.test(n)) return true;
  if (/\bPEPSI\b|\bCOCA\b|\b7UP\b|\bREFRESCO\b|\bGATORADE\b|\bAGUA\b/.test(n))
    return true;
  if (/\bHELADO\b|\bQUESO\b|\bJABON\b/.test(n)) return true;
  return false;
}

function isBeer(n: string) {
  return (
    /\bCERVEZA\b/.test(n) ||
    /\bPILSEN\b/.test(n) ||
    /\bSOLERA\b/.test(n) ||
    (/BOTELLA RETORNABLE/.test(n) &&
      (/\bPOLAR\b/.test(n) || /\bLIGHT\b/.test(n) || /\bCLASSIC\b/.test(n)))
  );
}

function isWhisky(n: string) {
  return (
    /\bWHISK/.test(n) ||
    /\bBUCHAN/.test(n) ||
    /\bOLD\s*PARR?\b/.test(n) ||
    /\bFAMOUS GROUSE\b/.test(n) ||
    /\bGRANTS\b/.test(n) ||
    /\bDEWARS\b/.test(n) ||
    /\bBLACK\s*&\s*WHITE\b/.test(n) ||
    /\bJACK DANIEL/.test(n)
  );
}

function isOtherLiquor(n: string) {
  return (
    /\bRON\b/.test(n) ||
    /\bVINO\b/.test(n) ||
    /\bCARORE/.test(n) ||
    /\bANIS\b/.test(n) ||
    /\bVIDKA\b|\bVODKA\b/.test(n) ||
    /\bGIN\b|\bTEQUILA\b|\bBRANDY\b|\bCOGNAC\b/.test(n) ||
    /\bLICOR\b|\bCREMA DE\b/.test(n) ||
    /\bMOJITO\b/.test(n) ||
    /\bSANGRIA\b/.test(n)
  );
}

export function classifyLiquorProduct(name: string): LiquorBucket | null {
  const n = norm(name);
  if (!n || isExcluded(n)) return null;

  if (isBeer(n)) {
    return /\bLIGHT\b/.test(n) ? "cerveza_light" : "cerveza_negra";
  }
  if (isWhisky(n)) return "whisky";
  if (isOtherLiquor(n)) return "otros_licores";
  return null;
}

export const LIQUOR_BUCKET_LABELS: Record<LiquorBucket, string> = {
  cerveza_light: "Cerveza light",
  cerveza_negra: "Cerveza negra / pilsen",
  whisky: "Whisky",
  otros_licores: "Otros licores",
};
