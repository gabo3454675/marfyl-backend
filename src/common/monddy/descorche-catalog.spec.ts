import {
  DESCORCHE_TARIFFS,
  EMPTY_DESCORCHE_BOM,
  EXISTING_DESCORCHE_SKUS,
  VIP_FALLBACK_SKU,
  allComboDescorcheHints,
  resolveComboDescorcheHint,
  resolveReusableSku,
  suggestedDescorcheSkuForTariff,
} from "./descorche-catalog";

describe("descorche-catalog", () => {
  it("define 4 tarifas de cartel + VINO (sin cervezas)", () => {
    const prices = DESCORCHE_TARIFFS.map((t) => t.salePrice).sort(
      (a, b) => a - b,
    );
    expect(prices).toEqual([10, 10, 15, 20, 30]);
    expect(DESCORCHE_TARIFFS.every((t) => t.role === "tariff")).toBe(true);
    expect(EMPTY_DESCORCHE_BOM).toEqual([]);
  });

  it("mapea combos → tarifa / SKU según matriz locked", () => {
    expect(resolveComboDescorcheHint("COMBO-01")).toEqual({
      comboSku: "COMBO-01",
      tariffUsd: 30,
      suggestedDescorcheSku: "DESCORCHE-30",
    });
    expect(resolveComboDescorcheHint("COMBO-02")?.suggestedDescorcheSku).toBe(
      EXISTING_DESCORCHE_SKUS.vip,
    );
    expect(resolveComboDescorcheHint("COMBO-04")?.tariffUsd).toBe(20);
    expect(resolveComboDescorcheHint("COMBO-05")?.suggestedDescorcheSku).toBe(
      "DESCORCHE-15",
    );
    expect(resolveComboDescorcheHint("COMBO-08")?.suggestedDescorcheSku).toBe(
      "DESCORCHE-10",
    );
    expect(resolveComboDescorcheHint("COMBO-12")?.suggestedDescorcheSku).toBe(
      EXISTING_DESCORCHE_SKUS.vino,
    );
    expect(resolveComboDescorcheHint("COMBO-13")?.suggestedDescorcheSku).toBe(
      EXISTING_DESCORCHE_SKUS.vino,
    );
    expect(resolveComboDescorcheHint("COMBO-09")).toBeNull();
    expect(resolveComboDescorcheHint("COMBO-14")).toBeNull();
  });

  it("usa VIP resuelto (fallback) en hints 02–04", () => {
    const hint = resolveComboDescorcheHint("COMBO-03", {
      vipResolvedSku: VIP_FALLBACK_SKU,
    });
    expect(hint?.suggestedDescorcheSku).toBe(VIP_FALLBACK_SKU);
  });

  it("resolveReusableSku: reusa si precio coincide; fallback si no", () => {
    expect(
      resolveReusableSku({
        preferredSku: EXISTING_DESCORCHE_SKUS.vip,
        fallbackSku: VIP_FALLBACK_SKU,
        targetPrice: 20,
        existingSalePrice: null,
      }),
    ).toEqual({ sku: EXISTING_DESCORCHE_SKUS.vip, reason: "create_preferred" });

    expect(
      resolveReusableSku({
        preferredSku: EXISTING_DESCORCHE_SKUS.vip,
        fallbackSku: VIP_FALLBACK_SKU,
        targetPrice: 20,
        existingSalePrice: 20,
      }),
    ).toEqual({ sku: EXISTING_DESCORCHE_SKUS.vip, reason: "reuse" });

    expect(
      resolveReusableSku({
        preferredSku: EXISTING_DESCORCHE_SKUS.vip,
        fallbackSku: VIP_FALLBACK_SKU,
        targetPrice: 20,
        existingSalePrice: 25,
      }),
    ).toEqual({
      sku: VIP_FALLBACK_SKU,
      reason: "fallback_price_mismatch",
    });
  });

  it("suggestedDescorcheSkuForTariff distingue vino vs genérico $10", () => {
    expect(suggestedDescorcheSkuForTariff(10)).toBe("DESCORCHE-10");
    expect(suggestedDescorcheSkuForTariff(10, { wine: true })).toBe(
      EXISTING_DESCORCHE_SKUS.vino,
    );
  });

  it("allComboDescorcheHints cubre los 16 combos conocidos", () => {
    const all = allComboDescorcheHints();
    expect(all).toHaveLength(16);
    // 01 + 02–04 + 05–07 + 08 + 12 + 13 = 10
    const withTariff = all.filter((h) => h.tariffUsd != null);
    expect(withTariff).toHaveLength(10);
  });
});
