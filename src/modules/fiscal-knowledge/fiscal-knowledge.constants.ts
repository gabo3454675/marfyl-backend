export interface FiscalPdfCatalogEntry {
  /** Nombre del archivo en disco (carpeta conocimiento fiscal) */
  file: string;
  /** Código corto de la norma */
  ley: string;
  /** Título legible para metadata */
  title: string;
  /** Alias del prompt original (si renombran el PDF) */
  aliases?: string[];
}

/**
 * Catálogo adaptado a los PDF reales del repo.
 * Si renombran archivos al esquema del prompt (cot_2020.pdf, etc.), los aliases los resuelven.
 */
export const FISCAL_PDF_CATALOG: FiscalPdfCatalogEntry[] = [
  {
    file: "cot actualizado.pdf",
    ley: "COT",
    title: "Código Orgánico Tributario",
    aliases: ["cot_2020.pdf"],
  },
  {
    file: "ley del iva 1.pdf",
    ley: "LIVA",
    title: "Ley del Impuesto al Valor Agregado",
    aliases: ["liva_2020.pdf"],
  },
  {
    file: "Reglamento_Ley_de_IVA_1999-1.pdf",
    ley: "RIVA",
    title: "Reglamento de la Ley del IVA",
    aliases: ["riva_1999.pdf"],
  },
  {
    file: "Providencia-0071.pdf",
    ley: "PROV_0071",
    title: "Providencia Administrativa SNAT/0071",
    aliases: ["prov_0071.pdf"],
  },
  {
    file: "ley islr.pdf",
    ley: "LISLR",
    title: "Ley de Impuesto Sobre la Renta",
    aliases: ["lislr_2015.pdf"],
  },
  {
    file: "reglamento islr.pdf",
    ley: "RISLR",
    title: "Reglamento de la Ley ISLR",
    aliases: ["rislr_2003.pdf"],
  },
  {
    file: "goe-6.687.pdfreforma-igtf-02-2022-1.pdf",
    ley: "LIGTF",
    title: "Ley de Impuesto a las Grandes Transacciones Financieras (IGTF)",
    aliases: ["ligtf_2022.pdf"],
  },
  {
    file: "PA-2024-121.pdf",
    ley: "CALENDARIO_2026",
    title: "Calendario y obligaciones fiscales especiales",
    aliases: ["calendario_especiales_2026.pdf"],
  },
  {
    file: "PROVIDENCIA-SNAT-0141-1.pdf",
    ley: "PROV_SNAT_0141",
    title: "Providencia Administrativa SNAT/0141",
  },
];

export const FISCAL_LEY_LABELS: Record<string, string> = {
  COT: "Código Orgánico Tributario",
  LIVA: "Ley del IVA",
  RIVA: "Reglamento del IVA",
  PROV_0071: "Providencia SNAT/0071",
  LISLR: "Ley ISLR",
  RISLR: "Reglamento ISLR",
  LIGTF: "Ley IGTF",
  CALENDARIO_2026: "Calendario fiscal",
  PROV_SNAT_0141: "Providencia SNAT/0141",
};

export const DEFAULT_EMBEDDING_MODEL =
  "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";
export const EMBEDDING_DIMENSIONS = 384;

export const DEFAULT_KNOWLEDGE_DIR = "conocimiento fiscal";
