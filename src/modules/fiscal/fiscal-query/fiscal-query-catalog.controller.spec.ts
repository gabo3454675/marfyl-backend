import { UnauthorizedException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { InternalAuthGuard } from "../../../common/guards/internal-auth.guard";
import { FiscalQueryCatalogController } from "./fiscal-query-catalog.controller";
import { FiscalQueryService } from "./fiscal-query.service";
import type { CatalogResponse } from "./catalog/fiscal-catalog.types";

// Evita cargar PrismaService real (alias @/ no resueltos en jest).
jest.mock("../../../common/prisma/prisma.service", () => ({
  PrismaService: class {},
}));

function buildResponse(): CatalogResponse {
  return {
    catalogVersion: "abc123",
    entries: [
      {
        id: "vat_debts_by_month",
        description: "IVA por mes",
        paramsSchema: [{ name: "year", type: "integer", required: true }],
        roles: [Role.ADMIN, Role.FISCAL],
      },
    ],
  };
}

describe("FiscalQueryCatalogController", () => {
  it("devuelve la respuesta saneada del servicio", () => {
    const getCatalogResponse = jest.fn().mockReturnValue(buildResponse());
    const service = { getCatalogResponse } as unknown as FiscalQueryService;
    const controller = new FiscalQueryCatalogController(service);

    const result = controller.getCatalog();

    expect(getCatalogResponse).toHaveBeenCalledTimes(1);
    expect(result.catalogVersion).toBe("abc123");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe("vat_debts_by_month");
    expect(result.entries[0].paramsSchema[0]).toEqual({
      name: "year",
      type: "integer",
      required: true,
    });
  });

  it("la respuesta NO expone SQL, tablas, run ni paramsClass", () => {
    const getCatalogResponse = jest.fn().mockReturnValue(buildResponse());
    const service = { getCatalogResponse } as unknown as FiscalQueryService;
    const controller = new FiscalQueryCatalogController(service);

    const result = controller.getCatalog();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("run");
    expect(serialized).not.toContain("paramsClass");
    expect(serialized).not.toContain("select");
    expect(serialized).not.toContain("where");
    expect(serialized).not.toContain("libroVentaLine");
    expect(serialized).not.toContain("expense");
    expect(serialized).not.toContain("prisma");
  });

  it("el guard InternalAuthGuard rechaza 401 si falta el secret", () => {
    // Prueba directa del guard con request sin headers (simula agente sin secret).
    const guard = new InternalAuthGuard();
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as never;
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("el guard InternalAuthGuard deja pasar con secret válido + org_id", () => {
    process.env.AGENT_SECRET = "test-agent-secret";
    try {
      const guard = new InternalAuthGuard();
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {
              "x-internal-secret": "test-agent-secret",
              "x-organization-id": "1",
            },
          }),
        }),
      } as never;
      expect(guard.canActivate(ctx)).toBe(true);
    } finally {
      delete process.env.AGENT_SECRET;
    }
  });
});
