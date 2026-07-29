import {
  isFlexibleDateString,
  parseQueryDate,
} from "./parse-query-date";

describe("parseQueryDate", () => {
  it("parsea DD/MM/YYYY a inicio de día UTC", () => {
    const d = parseQueryDate("01/07/2026", "start");
    expect(d.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("parsea DD/MM/YYYY a fin de día UTC", () => {
    const d = parseQueryDate("22/07/2026", "end");
    expect(d.toISOString()).toBe("2026-07-22T23:59:59.999Z");
  });

  // Compat FE→BE: el cliente envía YYYY-MM-DD (también válido para @IsDateString en prod legacy).
  it("parsea YYYY-MM-DD a inicio/fin UTC", () => {
    expect(parseQueryDate("2026-07-01", "start").toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    expect(parseQueryDate("2026-07-22", "end").toISOString()).toBe(
      "2026-07-22T23:59:59.999Z",
    );
  });

  it("parsea ISO datetime y normaliza al día UTC", () => {
    expect(
      parseQueryDate("2026-07-01T00:00:00.000Z", "start").toISOString(),
    ).toBe("2026-07-01T00:00:00.000Z");
    expect(
      parseQueryDate("2026-07-22T23:59:59.999Z", "end").toISOString(),
    ).toBe("2026-07-22T23:59:59.999Z");
  });

  it("rechaza fecha inexistente DD/MM/YYYY", () => {
    expect(() => parseQueryDate("32/13/2026", "start")).toThrow();
    expect(() => parseQueryDate("31/02/2026", "start")).toThrow();
  });

  it("rechaza formato inválido", () => {
    expect(() => parseQueryDate("not-a-date", "start")).toThrow();
    expect(() => parseQueryDate("", "start")).toThrow();
  });
});

describe("isFlexibleDateString", () => {
  it("acepta DD/MM/YYYY, YYYY-MM-DD e ISO", () => {
    expect(isFlexibleDateString("01/07/2026")).toBe(true);
    expect(isFlexibleDateString("2026-07-01")).toBe(true);
    expect(isFlexibleDateString("2026-07-01T00:00:00.000Z")).toBe(true);
  });

  it("rechaza inválidos", () => {
    expect(isFlexibleDateString("32/13/2026")).toBe(false);
    expect(isFlexibleDateString("abc")).toBe(false);
  });
});
