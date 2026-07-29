import {
  PLANB_SOURCE_HASH,
} from "./planb-reconcile.planner";
import {
  EXTRA_SOURCE_MISMATCH,
  buildPlanBRemediation,
} from "./planb-remediate.planner";

describe("buildPlanBRemediation", () => {
  it("SUPERSEDE orphans ACTIVE con sourceHash null o distinto del planB", () => {
    const result = buildPlanBRemediation({
      sourceHash: PLANB_SOURCE_HASH,
      facs: [
        { documentNumber: "00000001", headerNet: "10.00" },
        { documentNumber: "00000002", headerNet: "5.00" },
      ],
      existingInvoices: [
        {
          id: 1,
          legacyImportKey: "FAC-00000001",
          totalAmount: "10.00",
          deletedAt: null,
        },
        {
          id: 2,
          legacyImportKey: "FAC-00000002",
          totalAmount: "5.00",
          deletedAt: null,
        },
      ],
      existingItems: [
        {
          id: 100,
          invoiceId: 1,
          sourceHash: PLANB_SOURCE_HASH,
          lineageStatus: "ACTIVE",
        },
        {
          id: 101,
          invoiceId: 1,
          sourceHash: null,
          lineageStatus: "ACTIVE",
        },
        {
          id: 102,
          invoiceId: 1,
          sourceHash: "other-hash",
          lineageStatus: "ACTIVE",
        },
        {
          id: 103,
          invoiceId: 1,
          sourceHash: null,
          lineageStatus: "SUPERSEDED",
        },
        {
          id: 200,
          invoiceId: 2,
          sourceHash: PLANB_SOURCE_HASH,
          lineageStatus: "ACTIVE",
        },
      ],
    });

    expect(result.counters.orphansToSupersede).toBe(2);
    expect(result.supersedeItemIds.sort((a, b) => a - b)).toEqual([101, 102]);
    expect(
      result.actions.filter((a) => a.action === "SUPERSEDE_ORPHAN"),
    ).toHaveLength(2);
    for (const a of result.actions.filter(
      (x) => x.action === "SUPERSEDE_ORPHAN",
    )) {
      expect(a.reason).toBe(EXTRA_SOURCE_MISMATCH);
    }
    expect(result.counters.totalsToFix).toBe(0);
    expect(result.counters.totalsAlreadyOk).toBe(2);
    expect(result.counters.netAfter).toBe("15.00");
    expect(result.counters.expectedNet).toBe("15.00");
  });

  it("UPDATE totalAmount = headerNet cuando difiere (sin inventar bases/IVA)", () => {
    const result = buildPlanBRemediation({
      sourceHash: PLANB_SOURCE_HASH,
      facs: [
        { documentNumber: "00000010", headerNet: "12.50" },
        { documentNumber: "00000011", headerNet: "3.00" },
      ],
      existingInvoices: [
        {
          id: 10,
          legacyImportKey: "FAC-00000010",
          totalAmount: "10.00",
          deletedAt: null,
        },
        {
          id: 11,
          legacyImportKey: "FAC-00000011",
          totalAmount: "3.00",
          deletedAt: null,
        },
      ],
      existingItems: [
        {
          id: 1000,
          invoiceId: 10,
          sourceHash: PLANB_SOURCE_HASH,
          lineageStatus: "ACTIVE",
        },
      ],
    });

    expect(result.counters.totalsToFix).toBe(1);
    expect(result.counters.totalsAlreadyOk).toBe(1);
    expect(result.counters.orphansToSupersede).toBe(0);
    expect(result.totalUpdates).toEqual([
      { invoiceId: 10, totalAmount: "12.50" },
    ]);
    const upd = result.actions.find(
      (a) => a.action === "UPDATE_TOTAL_HEADER_NET",
    );
    expect(upd).toEqual({
      action: "UPDATE_TOTAL_HEADER_NET",
      invoiceId: 10,
      documentNumber: "00000010",
      fromTotal: "10.00",
      toTotal: "12.50",
    });
    expect(result.counters.netBefore).toBe("13.00");
    expect(result.counters.netAfter).toBe("15.50");
    expect(result.counters.expectedNet).toBe("15.50");
  });

  it("proyecta counters del lote: orphans + totals + expectedNet", () => {
    const result = buildPlanBRemediation({
      facs: [
        { documentNumber: "A", headerNet: "100.00" },
        { documentNumber: "B", headerNet: "50.18" },
        { documentNumber: "C", headerNet: "7.00" }, // missing in DB
      ],
      existingInvoices: [
        {
          id: 1,
          legacyImportKey: "FAC-A",
          totalAmount: "90.00",
          deletedAt: null,
        },
        {
          id: 2,
          legacyImportKey: "FAC-B",
          totalAmount: "50.18",
          deletedAt: null,
        },
      ],
      existingItems: [
        {
          id: 1,
          invoiceId: 1,
          sourceHash: null,
          lineageStatus: "ACTIVE",
        },
        {
          id: 2,
          invoiceId: 1,
          sourceHash: PLANB_SOURCE_HASH,
          lineageStatus: "ACTIVE",
        },
        {
          id: 3,
          invoiceId: 2,
          sourceHash: "x",
          lineageStatus: "ACTIVE",
        },
      ],
    });

    expect(result.counters.facInBatch).toBe(3);
    expect(result.counters.facFoundInDb).toBe(2);
    expect(result.counters.facMissingInDb).toBe(1);
    expect(result.counters.orphansToSupersede).toBe(2);
    expect(result.counters.totalsToFix).toBe(1);
    expect(result.counters.totalsAlreadyOk).toBe(1);
    expect(result.counters.netBefore).toBe("140.18");
    expect(result.counters.netAfter).toBe("150.18");
    expect(result.counters.expectedNet).toBe("157.18");
  });
});
