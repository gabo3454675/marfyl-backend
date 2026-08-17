import { EXISTING_DESCORCHE_SKUS } from "./descorche-catalog";
import {
  COMBO_SHARED_SKUS,
  DESCORCHE_SKU_BLOCKLIST,
  LIQUOR_COMBOS,
  allComboComponentSkus,
  assertNoDescorcheSkusInBom,
  comboBomSkuLines,
  formatComboDescorcheDescription,
  liquorComboMatrix,
} from "./liquor-combo-catalog";

describe("liquor-combo-catalog", () => {
  it("define exactamente 16 combos COMBO-01…15B", () => {
    expect(LIQUOR_COMBOS).toHaveLength(16);
    expect(LIQUOR_COMBOS.map((c) => c.sku)).toEqual([
      "COMBO-01",
      "COMBO-02",
      "COMBO-03",
      "COMBO-04",
      "COMBO-05",
      "COMBO-06",
      "COMBO-07",
      "COMBO-08",
      "COMBO-09",
      "COMBO-10",
      "COMBO-11",
      "COMBO-12",
      "COMBO-13",
      "COMBO-14",
      "COMBO-15A",
      "COMBO-15B",
    ]);
  });

  it("salePrice Ref USD y media hielo 00001256×1 + vasos×4 en cada BOM", () => {
    expect(COMBO_SHARED_SKUS.halfIce).toBe("00001256");
    for (const combo of LIQUOR_COMBOS) {
      const bom = comboBomSkuLines(combo);
      expect(bom.find((l) => l.role === "bottle")?.quantity).toBe(1);
      expect(bom.find((l) => l.role === "cups")).toEqual({
        sku: COMBO_SHARED_SKUS.cups,
        quantity: 4,
        role: "cups",
      });
      expect(bom.find((l) => l.role === "ice")).toEqual({
        sku: COMBO_SHARED_SKUS.halfIce,
        quantity: 1,
        role: "ice",
      });
      expect(combo.salePrice).toBeGreaterThan(0);
    }
    expect(LIQUOR_COMBOS.find((c) => c.sku === "COMBO-01")?.salePrice).toBe(180);
    expect(LIQUOR_COMBOS.find((c) => c.sku === "COMBO-14")?.salePrice).toBe(12);
  });

  it("BOM nunca incluye SKUs de descorche", () => {
    for (const combo of LIQUOR_COMBOS) {
      const skus = comboBomSkuLines(combo).map((l) => l.sku);
      expect(skus.some((s) => DESCORCHE_SKU_BLOCKLIST.has(s))).toBe(false);
      expect(() => assertNoDescorcheSkusInBom(skus)).not.toThrow();
    }
    expect(() =>
      assertNoDescorcheSkusInBom([EXISTING_DESCORCHE_SKUS.vip]),
    ).toThrow(/descorche/);
  });

  it("matriz alinea suggestedDescorcheSku vía resolveComboDescorcheHint", () => {
    const matrix = liquorComboMatrix();
    expect(matrix).toHaveLength(16);

    const bySku = Object.fromEntries(matrix.map((r) => [r.sku, r]));
    expect(bySku["COMBO-01"].descorcheHint).toEqual({
      comboSku: "COMBO-01",
      tariffUsd: 30,
      suggestedDescorcheSku: "DESCORCHE-30",
    });
    expect(bySku["COMBO-01"].description).toContain("DESCORCHE-30");
    expect(bySku["COMBO-02"].descorcheHint?.suggestedDescorcheSku).toBe(
      EXISTING_DESCORCHE_SKUS.vip,
    );
    expect(bySku["COMBO-05"].descorcheHint?.tariffUsd).toBe(15);
    expect(bySku["COMBO-08"].descorcheHint?.suggestedDescorcheSku).toBe(
      "DESCORCHE-10",
    );
    expect(bySku["COMBO-12"].descorcheHint?.suggestedDescorcheSku).toBe(
      EXISTING_DESCORCHE_SKUS.vino,
    );
    expect(bySku["COMBO-13"].descorcheHint?.suggestedDescorcheSku).toBe(
      EXISTING_DESCORCHE_SKUS.vino,
    );
    expect(bySku["COMBO-13"].alternateBottleSku).toBe("7808704700140");
    expect(bySku["COMBO-09"].descorcheHint).toBeNull();
    expect(bySku["COMBO-09"].description).toBeNull();
    expect(bySku["COMBO-15B"].descorcheHint).toBeNull();
  });

  it("formatComboDescorcheDescription y allComboComponentSkus", () => {
    expect(formatComboDescorcheDescription("COMBO-04")).toBe(
      "suggestedDescorcheSku=0000112 tariffUsd=20",
    );
    expect(formatComboDescorcheDescription("COMBO-11")).toBeNull();
    const skus = allComboComponentSkus();
    expect(skus).toContain(COMBO_SHARED_SKUS.halfIce);
    expect(skus).toContain("7808704700140");
    expect(skus.some((s) => DESCORCHE_SKU_BLOCKLIST.has(s))).toBe(false);
  });

  it("comboBomSkuLines respeta bottleSkuOverride (alt. Misiones)", () => {
    const combo = LIQUOR_COMBOS.find((c) => c.sku === "COMBO-13")!;
    const bom = comboBomSkuLines(combo, {
      bottleSkuOverride: combo.alternateBottleSku,
    });
    expect(bom.find((l) => l.role === "bottle")?.sku).toBe("7808704700140");
  });
});
