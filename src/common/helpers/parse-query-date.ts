/**
 * Parseo flexible de fechas en query params (historial, reportes, etc.).
 * Acepta: DD/MM/YYYY, YYYY-MM-DD, ISO 8601 datetime.
 * Devuelve Date en bound UTC de día (00:00:00.000Z o 23:59:59.999Z).
 */

export type QueryDateBound = "start" | "end";

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function utcDayBound(
  year: number,
  month: number,
  day: number,
  bound: QueryDateBound,
): Date {
  if (bound === "start") {
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
}

/**
 * Parsea una fecha de query a Date UTC (inicio o fin de día).
 * @throws Error si el formato es inválido o la fecha no existe en el calendario.
 */
export function parseQueryDate(
  value: string,
  bound: QueryDateBound = "start",
): Date {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error("Fecha vacía");
  }

  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (!isValidCalendarDate(year, month, day)) {
      throw new Error(`Fecha inválida: ${trimmed}`);
    }
    return utcDayBound(year, month, day, bound);
  }

  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (!isValidCalendarDate(year, month, day)) {
      throw new Error(`Fecha inválida: ${trimmed}`);
    }
    return utcDayBound(year, month, day, bound);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Fecha no reconocida: ${trimmed}`);
  }
  return utcDayBound(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate(),
    bound,
  );
}

/** True si el string es una fecha flexible válida (sin lanzar). */
export function isFlexibleDateString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    parseQueryDate(value, "start");
    return true;
  } catch {
    return false;
  }
}
