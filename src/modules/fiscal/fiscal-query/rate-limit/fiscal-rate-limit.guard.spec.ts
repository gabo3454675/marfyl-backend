import { HttpException } from "@nestjs/common";
import { FiscalRateLimitGuard } from "./fiscal-rate-limit.guard";

function makeContext(orgId: number, userId: number) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        activeOrganizationId: orgId,
        user: { id: userId },
      }),
    }),
  } as never;
}

describe("FiscalRateLimitGuard", () => {
  it("permite bajo el límite (user 30/min, org 60/min)", () => {
    const guard = new FiscalRateLimitGuard();
    for (let i = 0; i < 30; i++) {
      expect(guard.canActivate(makeContext(1, 10))).toBe(true);
    }
  });

  it("bloquea con 429 al superar el límite de usuario (30/min)", () => {
    const guard = new FiscalRateLimitGuard();
    for (let i = 0; i < 30; i++) {
      guard.canActivate(makeContext(1, 10));
    }
    expect(() => guard.canActivate(makeContext(1, 10))).toThrow(HttpException);
  });

  it("bloquea con 429 al superar el límite de organización (60/min)", () => {
    const guard = new FiscalRateLimitGuard();
    // 60 req de 60 usuarios distintos (cada user bajo su cap de 30)
    for (let u = 0; u < 60; u++) {
      guard.canActivate(makeContext(1, 1000 + u));
    }
    // req 61 de un user nuevo → excede org cap (60)
    expect(() => guard.canActivate(makeContext(1, 2000))).toThrow(
      HttpException,
    );
  });

  it("aisla contadores por organización", () => {
    const guard = new FiscalRateLimitGuard();
    // Llena el cap de org 1 (60 reqs de 60 users distintos, cada user 1 req).
    for (let u = 0; u < 60; u++) {
      expect(guard.canActivate(makeContext(1, 1000 + u))).toBe(true);
    }
    // Org 1 está en su cap (60) → la 61ª de org 1 debe bloquear.
    expect(() => guard.canActivate(makeContext(1, 2000))).toThrow(
      HttpException,
    );
    // Org 2 tiene contador independiente → una req nueva pasa.
    expect(guard.canActivate(makeContext(2, 3000))).toBe(true);
  });
});
