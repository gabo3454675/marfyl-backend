import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { FiscalQueryService } from "./fiscal-query.service";
import { FiscalAuditLogger } from "./audit/fiscal-audit.logger";

// Evita cargar el PrismaService real (que importa tenant-isolation.extension
// con alias @/ no resueltos por jest). El servicio sólo usa el tipo.
jest.mock("../../../common/prisma/prisma.service", () => ({
  PrismaService: class {},
}));
import type { PrismaService } from "../../../common/prisma/prisma.service";

type PrismaMock = {
  libroVentaLineFindMany: jest.Mock;
  libroCompraLineFindMany: jest.Mock;
  expenseFindMany: jest.Mock;
};

/**
 * Construye un mock de PrismaService donde los métodos usados por el
 * catálogo son jest.Mock. Se exponen las refs para llamar a
 * `.mockResolvedValue` sin chocar con el tipado real de Prisma.
 */
function makePrismaMock(): { prisma: PrismaService; mock: PrismaMock } {
  const mock: PrismaMock = {
    libroVentaLineFindMany: jest.fn(),
    libroCompraLineFindMany: jest.fn(),
    expenseFindMany: jest.fn(),
  };
  const prisma = {
    libroVentaLine: { findMany: mock.libroVentaLineFindMany },
    libroCompraLine: { findMany: mock.libroCompraLineFindMany },
    expense: { findMany: mock.expenseFindMany },
  } as unknown as PrismaService;
  return { prisma, mock };
}

function makeService(prisma: PrismaService, audit?: FiscalAuditLogger) {
  const auditLogger =
    audit ??
    ({
      log: jest.fn(),
    } as unknown as FiscalAuditLogger);
  return {
    service: new FiscalQueryService(prisma, auditLogger),
    auditLogger,
  };
}

function ctx(role: Role = Role.ADMIN) {
  return {
    organizationId: 1,
    userId: 7,
    role,
    correlationId: "corr-123",
  };
}

describe("FiscalQueryService", () => {
  it("ejecuta una query válida (vat_debts_by_month) y registra auditoría", async () => {
    const { prisma, mock } = makePrismaMock();
    mock.libroVentaLineFindMany.mockResolvedValue([
      { periodMonth: 1, ivaAmount: 100 },
      { periodMonth: 2, ivaAmount: 200 },
    ]);
    mock.libroCompraLineFindMany.mockResolvedValue([
      { periodMonth: 1, ivaAmount: 40 },
    ]);
    const { service, auditLogger } = makeService(prisma);

    const result = await service.execute(
      { query: "vat_debts_by_month", params: { year: 2024 } },
      ctx(),
    );

    expect(result.query).toBe("vat_debts_by_month");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      month: 1,
      debit: 100,
      credit: 40,
      net: 60,
    });
    expect(result.rows[1]).toEqual({
      month: 2,
      debit: 200,
      credit: 0,
      net: 200,
    });
    expect(result.truncated).toBe(false);
    expect(auditLogger.log).toHaveBeenCalledTimes(1);
    const record = (auditLogger.log as jest.Mock).mock.calls[0][0];
    expect(record.catalog_query_id).toBe("vat_debts_by_month");
    expect(record.user_id).toBe(7);
    expect(record.organization_id).toBe(1);
    expect(record.correlation_id).toBe("corr-123");
    expect(record.row_count).toBe(2);
    expect(record.truncated).toBe(false);
    expect(record.status).toBe("OK");
    expect(typeof record.params_hash).toBe("string");
    expect(record.params_hash).toHaveLength(64); // SHA-256 hex
    expect(record.roles_granted).toEqual([Role.ADMIN]);
    // 11 campos esperados
    expect(Object.keys(record).sort()).toEqual(
      [
        "correlation_id",
        "timestamp",
        "user_id",
        "organization_id",
        "catalog_query_id",
        "params_hash",
        "roles_granted",
        "row_count",
        "truncated",
        "duration_ms",
        "status",
      ].sort(),
    );
  });

  it("rechaza query no presente en el catálogo (allow-list)", async () => {
    const { prisma } = makePrismaMock();
    const { service } = makeService(prisma);
    await expect(
      service.execute({ query: "drop_table_please", params: {} }, ctx()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rechaza params inválidos (year string en vez de int)", async () => {
    const { prisma } = makePrismaMock();
    const { service } = makeService(prisma);
    await expect(
      service.execute(
        { query: "vat_debts_by_month", params: { year: "nope" } },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rechaza params faltantes", async () => {
    const { prisma } = makePrismaMock();
    const { service } = makeService(prisma);
    await expect(
      service.execute({ query: "vat_debts_by_month", params: {} }, ctx()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("deniega RBAC cuando el rol no está en entry.roles (SELLER)", async () => {
    const { prisma } = makePrismaMock();
    const { service } = makeService(prisma);
    await expect(
      service.execute(
        { query: "vat_debts_by_month", params: { year: 2024 } },
        ctx(Role.SELLER),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("marca truncated: true cuando se alcanza el row cap (1000)", async () => {
    const { prisma, mock } = makePrismaMock();
    const debitRows = Array.from({ length: 1000 }, (_, i) => ({
      periodMonth: i + 1,
      ivaAmount: 1,
    }));
    mock.libroVentaLineFindMany.mockResolvedValue(debitRows);
    mock.libroCompraLineFindMany.mockResolvedValue([]);
    const { service, auditLogger } = makeService(prisma);

    const result = await service.execute(
      { query: "vat_debts_by_month", params: { year: 2024 } },
      ctx(),
    );

    expect(result.rowCount).toBe(1000);
    expect(result.truncated).toBe(true);
    const record = (auditLogger.log as jest.Mock).mock.calls[0][0];
    expect(record.truncated).toBe(true);
    expect(record.row_count).toBe(1000);
  });

  it("aplica paginación (page/pageSize) sobre las filas", async () => {
    const { prisma, mock } = makePrismaMock();
    const debitRows = Array.from({ length: 5 }, (_, i) => ({
      periodMonth: i + 1,
      ivaAmount: 10,
    }));
    mock.libroVentaLineFindMany.mockResolvedValue(debitRows);
    mock.libroCompraLineFindMany.mockResolvedValue([]);
    const { service } = makeService(prisma);

    const result = await service.execute(
      {
        query: "vat_debts_by_month",
        params: { year: 2024 },
        page: 2,
        pageSize: 2,
      },
      ctx(),
    );
    expect(result.rows).toHaveLength(2);
    expect((result.rows[0] as { month: number }).month).toBe(3);
  });

  it("limita pageSize a 100 (cap C1)", async () => {
    const { prisma, mock } = makePrismaMock();
    mock.libroVentaLineFindMany.mockResolvedValue([]);
    mock.libroCompraLineFindMany.mockResolvedValue([]);
    const { service } = makeService(prisma);
    const result = await service.execute(
      {
        query: "vat_debts_by_month",
        params: { year: 2024 },
        pageSize: 9999,
      },
      ctx(),
    );
    expect(result.pageSize).toBe(100);
  });

  it("withholding_summary_by_supplier: valida rango fromDate<=toDate", async () => {
    const { prisma } = makePrismaMock();
    const { service } = makeService(prisma);
    await expect(
      service.execute(
        {
          query: "withholding_summary_by_supplier",
          params: { fromDate: "2024-02-01", toDate: "2024-01-01" },
        },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("withholding_summary_by_supplier: agrega por proveedor", async () => {
    const { prisma, mock } = makePrismaMock();
    mock.expenseFindMany.mockResolvedValue([
      {
        supplierId: 1,
        withholdingIvaAmount: 10,
        supplier: { id: 1, name: "A" },
      },
      {
        supplierId: 1,
        withholdingIvaAmount: 5,
        supplier: { id: 1, name: "A" },
      },
      {
        supplierId: 2,
        withholdingIvaAmount: 20,
        supplier: { id: 2, name: "B" },
      },
    ]);
    const { service } = makeService(prisma);
    const result = await service.execute(
      {
        query: "withholding_summary_by_supplier",
        params: { fromDate: "2024-01-01", toDate: "2024-12-31" },
      },
      ctx(),
    );
    expect(result.rows).toHaveLength(2);
    const a = result.rows.find(
      (r: { supplierId: number }) => r.supplierId === 1,
    ) as { totalRetained: number; count: number };
    expect(a.totalRetained).toBe(15);
    expect(a.count).toBe(2);
  });

  it("params_hash NO loguea valores en claro (solo hash hex)", async () => {
    const { prisma, mock } = makePrismaMock();
    mock.libroVentaLineFindMany.mockResolvedValue([]);
    mock.libroCompraLineFindMany.mockResolvedValue([]);
    const { service, auditLogger } = makeService(prisma);
    // Valor distintivo (1999) que no aparece en timestamp actual (2026)
    // ni en correlation_id ni en catalog_query_id.
    await service.execute(
      { query: "vat_debts_by_month", params: { year: 1999 } },
      ctx(),
    );
    const record = (auditLogger.log as jest.Mock).mock.calls[0][0];
    expect(record.params).toBeUndefined();
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("1999");
    expect(typeof record.params_hash).toBe("string");
    expect(record.params_hash).toHaveLength(64);
  });

  describe("getCatalogResponse (C5)", () => {
    it("devuelve catalogVersion (SHA-256 hex de 64) y entradas saneadas", () => {
      const { prisma } = makePrismaMock();
      const { service } = makeService(prisma);

      const response = service.getCatalogResponse();

      expect(typeof response.catalogVersion).toBe("string");
      expect(response.catalogVersion).toHaveLength(64);
      expect(response.entries).toHaveLength(2);

      const ids = response.entries.map((e) => e.id).sort();
      expect(ids).toEqual(
        ["vat_debts_by_month", "withholding_summary_by_supplier"].sort(),
      );
    });

    it("NO expone SQL, tablas, run ni paramsClass en la respuesta", () => {
      const { prisma } = makePrismaMock();
      const { service } = makeService(prisma);

      const serialized = JSON.stringify(service.getCatalogResponse());

      expect(serialized).not.toContain("run");
      expect(serialized).not.toContain("paramsClass");
      expect(serialized).not.toContain("select");
      expect(serialized).not.toContain("where");
      expect(serialized).not.toContain("libroVentaLine");
      expect(serialized).not.toContain("libroCompraLine");
      expect(serialized).not.toContain("expense");
      expect(serialized).not.toContain("prisma");
    });

    it("paramsSchema expone campos + tipos + required para cada entrada", () => {
      const { prisma } = makePrismaMock();
      const { service } = makeService(prisma);

      const response = service.getCatalogResponse();
      const vat = response.entries.find((e) => e.id === "vat_debts_by_month")!;
      const withholding = response.entries.find(
        (e) => e.id === "withholding_summary_by_supplier",
      )!;

      expect(vat.paramsSchema).toEqual([
        { name: "year", type: "integer", required: true },
      ]);
      expect(withholding.paramsSchema).toEqual([
        { name: "fromDate", type: "date", required: true },
        { name: "toDate", type: "date", required: true },
      ]);
    });

    it("roles se exponen por entrada", () => {
      const { prisma } = makePrismaMock();
      const { service } = makeService(prisma);

      const response = service.getCatalogResponse();
      for (const entry of response.entries) {
        expect(entry.roles).toEqual([Role.ADMIN, Role.FISCAL]);
      }
    });

    it("catalogVersion es determinista (mismo catálogo → mismo hash)", () => {
      const { prisma } = makePrismaMock();
      const { service } = makeService(prisma);

      const a = service.getCatalogResponse().catalogVersion;
      const b = service.getCatalogResponse().catalogVersion;
      expect(a).toBe(b);
    });
  });
});
