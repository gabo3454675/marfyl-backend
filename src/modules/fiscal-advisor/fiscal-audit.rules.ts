export type AuditSeverity = "critical" | "high" | "medium";

export interface PerfilEmpresa {
  RIF: string;
  esEspecial: boolean;
  actividadPrincipal: string;
  tipoFacturacion: string;
}

export interface ResumenOperativo {
  totalFacturadoMes: number;
  pagosDivisasEfectivo: number;
  igtfRecaudado: number;
  ultimaDeclaracionIVA: string | Date | null;
  facturasSinMaquinaFiscal: number;
}

export interface AuditWarning {
  code: string;
  severity: AuditSeverity;
  title: string;
  message: string;
  accionMarfyl?: string;
  referenciaLegal?: string;
}

/** Terminal del RIF (último dígito numérico). */
export function rifTerminalDigit(rif: string): number | null {
  const digits = rif.replace(/\D/g, "");
  if (!digits.length) return null;
  return Number.parseInt(digits.slice(-1), 10);
}

/**
 * Calendario simplificado de contribuyentes especiales (Prov. SNAT/0141):
 * día límite de declaración IVA según terminal del RIF (días 10–19 del mes).
 */
export function ivaDeadlineForTerminal(
  terminal: number,
  year: number,
  month: number,
): Date {
  const day = Math.min(10 + terminal, 28);
  return new Date(year, month, day, 23, 59, 59, 999);
}

export function evaluateIgtfAlert(resumen: ResumenOperativo): AuditWarning | null {
  if (resumen.pagosDivisasEfectivo > 0 && resumen.igtfRecaudado === 0) {
    return {
      code: "IGTF_NO_PERCIBIDO",
      severity: "critical",
      title: "Riesgo IGTF (3%)",
      message:
        "Riesgo de multa por no percibir el IGTF (3%) en pagos con divisas en efectivo según la LIGTF.",
      accionMarfyl:
        "Active el impuesto IGTF en la configuración de cajas y registre el 3% en cada cobro en divisas.",
      referenciaLegal: "LIGTF — Impuesto a las Grandes Transacciones Financieras",
    };
  }
  return null;
}

export function evaluateProvidencia0071Alert(
  perfil: PerfilEmpresa,
  resumen: ResumenOperativo,
): AuditWarning | null {
  const formatoLibre = /formato\s*libre/i.test(perfil.tipoFacturacion);
  if (
    formatoLibre &&
    perfil.esEspecial &&
    resumen.facturasSinMaquinaFiscal > 0
  ) {
    return {
      code: "PROV_0071_MAQUINA_FISCAL",
      severity: "critical",
      title: "Máquina fiscal obligatoria",
      message: `Como contribuyente especial con ${resumen.facturasSinMaquinaFiscal} factura(s) sin máquina fiscal, existe riesgo de sanción o clausura según el Art. 101 del COT y la Providencia 0071.`,
      accionMarfyl:
        "Emita facturas solo con máquina fiscal homologada o migre a formato digital autorizado por el SENIAT.",
      referenciaLegal: "COT Art. 101 · Providencia Administrativa SNAT/0071",
    };
  }
  return null;
}

export function evaluateCalendario0141Alert(
  perfil: PerfilEmpresa,
  resumen: ResumenOperativo,
  now = new Date(),
): AuditWarning | null {
  if (!perfil.esEspecial) return null;

  const terminal = rifTerminalDigit(perfil.RIF);
  if (terminal === null) return null;

  const year = now.getFullYear();
  const month = now.getMonth();
  const deadline = ivaDeadlineForTerminal(terminal, year, month);
  const msLeft = deadline.getTime() - now.getTime();
  const daysLeft = Math.ceil(msLeft / 86_400_000);

  if (daysLeft < 0 || daysLeft > 3) return null;

  const ultima = resumen.ultimaDeclaracionIVA
    ? new Date(resumen.ultimaDeclaracionIVA)
    : null;

  if (
    ultima &&
    ultima.getFullYear() === year &&
    ultima.getMonth() === month
  ) {
    return null;
  }

  return {
    code: "CALENDARIO_0141_VENCIMIENTO",
    severity: daysLeft <= 1 ? "critical" : "high",
    title: "Vencimiento IVA inminente",
    message: `Faltan ${daysLeft} día(s) para el vencimiento de su declaración de IVA (terminal RIF ${terminal}, límite ${deadline.toLocaleDateString("es-VE")}) según calendario de especiales (Prov. SNAT/0141).`,
    accionMarfyl:
      "Prepare el libro de ventas y declare en el módulo Fiscal de MARFYL antes del vencimiento.",
    referenciaLegal: "Providencia Administrativa SNAT/0141 · Calendario de Especiales",
  };
}

export function runPreventiveAudit(
  perfil: PerfilEmpresa,
  resumen: ResumenOperativo,
  now = new Date(),
): AuditWarning[] {
  const warnings: AuditWarning[] = [];
  for (const rule of [
    evaluateIgtfAlert(resumen),
    evaluateProvidencia0071Alert(perfil, resumen),
    evaluateCalendario0141Alert(perfil, resumen, now),
  ]) {
    if (rule) warnings.push(rule);
  }
  return warnings;
}
