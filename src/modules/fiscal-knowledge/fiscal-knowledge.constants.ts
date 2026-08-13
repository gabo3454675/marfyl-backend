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

export interface FiscalMarkdownCatalogEntry {
  /** Ruta relativa bajo ENTRENAMIENTO IA/04-markdown (o FISCAL_MARKDOWN_DIR) */
  file: string;
  ley: string;
  title: string;
}

/**
 * Corpus Markdown reconstruido (ENTRENAMIENTO IA → pdf-inspector).
 * Preferido sobre PDFs legacy para embeddings.
 */
export const FISCAL_MARKDOWN_CATALOG: FiscalMarkdownCatalogEntry[] = [
  {
    file: "01-tributario/cot/COT_GOE-6507_2020.md",
    ley: "COT",
    title: "Código Orgánico Tributario",
  },
  {
    file: "01-tributario/islr/LISLR_GOE-6210_2015.md",
    ley: "LISLR",
    title: "Ley de Impuesto Sobre la Renta",
  },
  {
    file: "01-tributario/islr/RISLR_GOE-5662_2003.md",
    ley: "RISLR",
    title: "Reglamento de la Ley ISLR",
  },
  {
    file: "01-tributario/iva/LIVA_texto_unico.md",
    ley: "LIVA",
    title: "Ley del Impuesto al Valor Agregado (texto único)",
  },
  {
    file: "01-tributario/iva/RIVA_GOE-5363_1999.md",
    ley: "RIVA",
    title: "Reglamento de la Ley del IVA",
  },
  {
    file: "01-tributario/igtf/LIGTF_GOE-6687_2022.md",
    ley: "LIGTF",
    title: "Ley de Impuesto a las Grandes Transacciones Financieras",
  },
  {
    file: "01-tributario/aduanas/LOA_GOE-6507_2020.md",
    ley: "LOA",
    title: "Ley Orgánica de Aduanas",
  },
  {
    file: "01-tributario/seniat-operativo/PROV_SNAT_0071_GO-39795.md",
    ley: "PROV_0071",
    title: "Providencia Administrativa SNAT/0071 — Facturación",
  },
  {
    file: "01-tributario/seniat-operativo/SNAT_2025_000054_GrantThornton_retencion_IVA.md",
    ley: "RET_IVA_2025",
    title: "SNAT/2025/000054 — Agentes de retención IVA (nota técnica)",
  },
  {
    file: "02-contable/ba-ven-nif/BA-VEN-NIF-0_v6.md",
    ley: "BA0",
    title: "BA VEN-NIF 0 — Acuerdo marco NIIF",
  },
  {
    file: "02-contable/ba-ven-nif/BA-VEN-NIF-2_v4.md",
    ley: "BA2",
    title: "BA VEN-NIF 2 — Inflación",
  },
  {
    file: "02-contable/ba-ven-nif/BA-VEN-NIF-4_v1.md",
    ley: "BA4",
    title: "BA VEN-NIF 4 — Fecha de autorización EEFF",
  },
  {
    file: "02-contable/ba-ven-nif/BA-VEN-NIF-5_v3.md",
    ley: "BA5",
    title: "BA VEN-NIF 5 — Resultado integral",
  },
  {
    file: "02-contable/ba-ven-nif/BA-VEN-NIF-8_v10.md",
    ley: "BA8",
    title: "BA VEN-NIF 8 — PCGA Venezuela (VEN-NIF)",
  },
  {
    file: "03-conexion-fiscal-contable/FCCPV_tips_cierres_2025.md",
    ley: "CIERRE2025",
    title: "FCCPV — Tips cierres contables 2025",
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
  LOA: "Ley Orgánica de Aduanas",
  CALENDARIO_2026: "Calendario fiscal",
  PROV_SNAT_0141: "Providencia SNAT/0141",
  BA0: "BA VEN-NIF 0",
  BA2: "BA VEN-NIF 2",
  BA4: "BA VEN-NIF 4",
  BA5: "BA VEN-NIF 5",
  BA8: "BA VEN-NIF 8",
  CIERRE2025: "Tips cierres contables FCCPV 2025",
  IGTF: "Ley IGTF",
  RET_IVA_2025: "Retención IVA SNAT/2025/000054",
};

export const DEFAULT_EMBEDDING_MODEL =
  "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";
export const EMBEDDING_DIMENSIONS = 384;

export const DEFAULT_KNOWLEDGE_DIR = "conocimiento fiscal";
