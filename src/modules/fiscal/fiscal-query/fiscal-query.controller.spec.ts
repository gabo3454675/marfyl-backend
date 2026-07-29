import { ForbiddenException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { FiscalQueryController } from "./fiscal-query.controller";
import { FiscalQueryService } from "./fiscal-query.service";

// Stubs para que jest no cargue los guards reales (que tiran de alias @/
// no resueltos en jest). El controlador sólo referencia las clases en
// @UseGuards; no invoca su lógica en estos tests unitarios.
jest.mock("../../../common/guards/jwt-auth.guard", () => ({
  JwtAuthGuard: class {},
}));
jest.mock("../../../common/guards/organization.guard", () => ({
  OrganizationGuard: class {},
}));
// Evita cargar PrismaService real (alias @/ no resueltos en jest).
jest.mock("../../../common/prisma/prisma.service", () => ({
  PrismaService: class {},
}));

function makeReq(
  overrides: Partial<{
    user: { id: number };
    activeOrganizationId: number;
    activeOrganizationMembership: { role: Role };
    headers: Record<string, string>;
  }> = {},
) {
  // Spread merge: un override con `undefined` explícito prevalece sobre el
  // default (Object spread conserva la clave con valor undefined).
  const base = {
    user: { id: 7 },
    activeOrganizationId: 1,
    activeOrganizationMembership: { role: Role.ADMIN },
    headers: {},
  };
  return { ...base, ...overrides } as never;
}

describe("FiscalQueryController", () => {
  it("delegua al servicio con correlation-id del header", async () => {
    const execute = jest.fn().mockResolvedValue({ query: "ok" });
    const service = { execute } as unknown as FiscalQueryService;
    const controller = new FiscalQueryController(service);

    const result = await controller.query(
      { query: "vat_debts_by_month", params: { year: 2024 } } as never,
      makeReq({ headers: { "x-correlation-id": "abc-123" } }),
    );

    expect(result).toEqual({ query: "ok" });
    expect(execute).toHaveBeenCalledTimes(1);
    const call = execute.mock.calls[0];
    expect(call[1]).toEqual({
      organizationId: 1,
      userId: 7,
      role: Role.ADMIN,
      correlationId: "abc-123",
    });
  });

  it("genera correlation-id si no viene en header", async () => {
    const execute = jest.fn().mockResolvedValue({});
    const service = { execute } as unknown as FiscalQueryService;
    const controller = new FiscalQueryController(service);

    await controller.query(
      { query: "vat_debts_by_month", params: { year: 2024 } } as never,
      makeReq(),
    );

    const correlationId = execute.mock.calls[0][1].correlationId;
    expect(typeof correlationId).toBe("string");
    expect(correlationId.length).toBeGreaterThan(8);
  });

  it("rechaza 403 si no hay membresía", async () => {
    const service = {} as unknown as FiscalQueryService;
    const controller = new FiscalQueryController(service);
    await expect(
      controller.query(
        { query: "x", params: {} } as never,
        makeReq({ activeOrganizationMembership: undefined as never }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rechaza 403 si no hay user.id", async () => {
    const service = {} as unknown as FiscalQueryService;
    const controller = new FiscalQueryController(service);
    await expect(
      controller.query(
        { query: "x", params: {} } as never,
        makeReq({ user: { id: undefined as never } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
