import { caracasDayUtcRange } from "./liquor-sales.util";

describe("caracasDayUtcRange", () => {
  it("medianoche Caracas = 04:00 UTC del mismo día civil", () => {
    expect(caracasDayUtcRange("2026-08-16")).toEqual({
      startIso: "2026-08-16T04:00:00.000Z",
      endIso: "2026-08-17T04:00:00.000Z",
    });
  });

  it("cruza mes y año", () => {
    expect(caracasDayUtcRange("2025-12-31")).toEqual({
      startIso: "2025-12-31T04:00:00.000Z",
      endIso: "2026-01-01T04:00:00.000Z",
    });
  });
});
