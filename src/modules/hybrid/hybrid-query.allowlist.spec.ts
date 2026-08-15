import {
  HYBRID_LIST_QUERY_KEYS,
  HYBRID_VENTAS_QUERY_KEYS,
  pickAllowlistedQuery,
} from "./hybrid-query.allowlist";

describe("pickAllowlistedQuery", () => {
  it("solo retiene claves allowlisted", () => {
    const result = pickAllowlistedQuery(
      { q: "abc", limit: "10", offset: "0", secret: "nope", evil: "x" },
      HYBRID_LIST_QUERY_KEYS,
    );
    expect(result).toEqual({ q: "abc", limit: "10", offset: "0" });
    expect(result).not.toHaveProperty("secret");
    expect(result).not.toHaveProperty("evil");
  });

  it("omite vacíos y null", () => {
    expect(
      pickAllowlistedQuery(
        { q: "", limit: null, offset: "5" },
        HYBRID_LIST_QUERY_KEYS,
      ),
    ).toEqual({ offset: "5" });
  });

  it("soporta allowlist de ventas", () => {
    const result = pickAllowlistedQuery(
      {
        q: "x",
        desde: "2024-01-01",
        hasta: "2024-01-31",
        rif: "J123",
        ignored: "1",
      },
      HYBRID_VENTAS_QUERY_KEYS,
    );
    expect(result).toEqual({
      q: "x",
      desde: "2024-01-01",
      hasta: "2024-01-31",
      rif: "J123",
    });
  });
});
