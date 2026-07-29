import { BadRequestException } from "@nestjs/common";
import {
  applyInvoiceIssueDateGuard,
  parseSaleDate,
  requireImportIssueDate,
  resolveOperationalIssueDate,
} from "./issue-date";

describe("issue-date helpers", () => {
  describe("parseSaleDate", () => {
    it("parsea DD/MM/YYYY válido", () => {
      const d = parseSaleDate("08/07/2026");
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(6);
      expect(d.getDate()).toBe(8);
    });

    it("rechaza formato inválido", () => {
      expect(Number.isNaN(parseSaleDate("2026-07-08").getTime())).toBe(true);
      expect(Number.isNaN(parseSaleDate("").getTime())).toBe(true);
      expect(Number.isNaN(parseSaleDate("32/01/2026").getTime())).toBe(true);
    });
  });

  describe("requireImportIssueDate", () => {
    it("devuelve Date para saleDate válido", () => {
      const d = requireImportIssueDate("15/07/2026", "FAC-00009840");
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(6);
      expect(d.getDate()).toBe(15);
    });

    it("falla si saleDate falta", () => {
      expect(() => requireImportIssueDate("", "FAC-00009840")).toThrow(
        "FAC-00009840 sin fecha de venta (saleDate)",
      );
    });

    it("falla si saleDate es inválido", () => {
      expect(() =>
        requireImportIssueDate("no-fecha", "FAC-00009605"),
      ).toThrow("FAC-00009605 sin fecha de venta (saleDate)");
    });
  });

  describe("resolveOperationalIssueDate", () => {
    it("usa now si input vacío", () => {
      const before = Date.now();
      const d = resolveOperationalIssueDate(null);
      expect(d.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it("respeta Date/string válido", () => {
      const iso = "2026-07-15T12:00:00.000Z";
      expect(resolveOperationalIssueDate(iso).toISOString()).toBe(iso);
      expect(
        resolveOperationalIssueDate(new Date(iso)).toISOString(),
      ).toBe(iso);
    });

    it("lanza BadRequest si inválido", () => {
      expect(() => resolveOperationalIssueDate("no-es-fecha")).toThrow(
        BadRequestException,
      );
    });
  });

  describe("applyInvoiceIssueDateGuard", () => {
    it("setea now en operativa sin issueDate", () => {
      const data: Record<string, unknown> = { totalAmount: 10 };
      applyInvoiceIssueDateGuard(data);
      expect(data.issueDate).toBeInstanceOf(Date);
      expect(
        Number.isNaN((data.issueDate as Date).getTime()),
      ).toBe(false);
    });

    it("no sobrescribe issueDate presente", () => {
      const fixed = new Date("2026-07-10T16:00:00.000Z");
      const data: Record<string, unknown> = { issueDate: fixed };
      applyInvoiceIssueDateGuard(data);
      expect(data.issueDate).toBe(fixed);
    });

    it("lanza si legacy sin issueDate (isLegacyImport)", () => {
      expect(() =>
        applyInvoiceIssueDateGuard({
          isLegacyImport: true,
          legacyImportKey: "FAC-1",
        }),
      ).toThrow("invoice.create legacy requiere issueDate (fail-closed)");
    });

    it("lanza si hay importSource sin issueDate", () => {
      expect(() =>
        applyInvoiceIssueDateGuard({ importSource: "fastreport" }),
      ).toThrow("invoice.create legacy requiere issueDate (fail-closed)");
    });

    it("lanza si hay legacyImportKey sin issueDate", () => {
      expect(() =>
        applyInvoiceIssueDateGuard({ legacyImportKey: "FAC-00009605" }),
      ).toThrow("invoice.create legacy requiere issueDate (fail-closed)");
    });
  });
});
