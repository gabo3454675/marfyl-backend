import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

jest.mock("../prisma/prisma.service", () => ({
  PrismaService: class PrismaService {},
}));
jest.mock("../billing/organization-billing.service", () => ({
  OrganizationBillingService: class OrganizationBillingService {},
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OrganizationGuard } = require("./organization.guard") as {
  OrganizationGuard: new (
    prisma: unknown,
    billing: unknown,
  ) => {
    canActivate(context: ExecutionContext): Promise<boolean>;
  };
};

function mockHttpExecutionContext(
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

function makePrismaMock(
  memberFindFirst: jest.Mock,
  overrides: Record<string, unknown> = {},
) {
  return {
    member: { findFirst: memberFindFirst },
    ...overrides,
  };
}

function makeBillingMock() {
  return {
    assertOrganizationBillingActive: jest.fn().mockResolvedValue(undefined),
  };
}

describe("OrganizationGuard — rama isInternalAgent (TASK-B1)", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_DEV_PREVIEW = process.env.DEV_PREVIEW_AUTH;

  beforeEach(() => {
    // Asegurar que la rama dev-preview NO interfiera con los tests del agente interno.
    process.env.NODE_ENV = "production";
    process.env.DEV_PREVIEW_AUTH = "false";
  });

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_DEV_PREVIEW === undefined) delete process.env.DEV_PREVIEW_AUTH;
    else process.env.DEV_PREVIEW_AUTH = ORIGINAL_DEV_PREVIEW;
    jest.restoreAllMocks();
  });

  function internalAgentRequest(
    organizationId: number,
    userId: number,
  ): Record<string, unknown> {
    return {
      headers: {},
      user: {
        id: userId,
        email: "agent@internal.marfyl",
        isSuperAdmin: false,
        organizationId,
        tenantId: organizationId,
        isInternalAgent: true,
      },
    };
  }

  it("pasa con membresía activa y pobla el rol real del miembro (no SUPER_ADMIN sintético)", async () => {
    const organization = {
      id: 9,
      slug: "acme",
      billingExempt: true,
      plan: "PRO",
      name: "Acme",
    };
    const membership = {
      id: 42,
      userId: 15,
      organizationId: 9,
      role: "FISCAL",
      status: "ACTIVE",
      joinedAt: new Date(),
      organization,
    };
    const memberFindFirst = jest.fn().mockResolvedValue(membership);
    const prisma = makePrismaMock(memberFindFirst);
    const billing = makeBillingMock();
    const guard = new OrganizationGuard(prisma, billing);
    const request = internalAgentRequest(9, 15);

    await expect(
      guard.canActivate(mockHttpExecutionContext(request)),
    ).resolves.toBe(true);

    expect(memberFindFirst).toHaveBeenCalledWith({
      where: { userId: 15, organizationId: 9, status: "ACTIVE" },
      include: { organization: true },
    });
    expect(request.activeOrganizationId).toBe(9);
    expect(request.activeOrganization).toBe(organization);
    expect(request.activeOrganizationMembership).toBe(membership);
    expect(
      (request.activeOrganizationMembership as { role: string }).role,
    ).toBe("FISCAL");
    expect(billing.assertOrganizationBillingActive).toHaveBeenCalledWith(9, {
      slug: "acme",
      billingExempt: true,
      plan: "PRO",
    });
  });

  it("lanza ForbiddenException cuando no existe membresía activa", async () => {
    const memberFindFirst = jest.fn().mockResolvedValue(null);
    const prisma = makePrismaMock(memberFindFirst);
    const billing = makeBillingMock();
    const guard = new OrganizationGuard(prisma, billing);
    const request = internalAgentRequest(9, 15);

    await expect(
      guard.canActivate(mockHttpExecutionContext(request)),
    ).rejects.toThrow(ForbiddenException);
    expect(memberFindFirst).toHaveBeenCalledWith({
      where: { userId: 15, organizationId: 9, status: "ACTIVE" },
      include: { organization: true },
    });
    expect(billing.assertOrganizationBillingActive).not.toHaveBeenCalled();
  });

  it("lanza ForbiddenException cuando la membresía existe pero está inactiva (status != ACTIVE)", async () => {
    // El where filtra por status ACTIVE, así que una membresía SUSPENDED no se devuelve.
    const memberFindFirst = jest.fn().mockResolvedValue(null);
    const prisma = makePrismaMock(memberFindFirst);
    const billing = makeBillingMock();
    const guard = new OrganizationGuard(prisma, billing);
    const request = internalAgentRequest(9, 15);

    await expect(
      guard.canActivate(mockHttpExecutionContext(request)),
    ).rejects.toThrow(ForbiddenException);
    expect(memberFindFirst).toHaveBeenCalledWith({
      where: { userId: 15, organizationId: 9, status: "ACTIVE" },
      include: { organization: true },
    });
  });

  it("lanza BadRequestException cuando falta X-User-Id (user.id = -1 sintético)", async () => {
    const memberFindFirst = jest.fn();
    const prisma = makePrismaMock(memberFindFirst);
    const billing = makeBillingMock();
    const guard = new OrganizationGuard(prisma, billing);
    const request = internalAgentRequest(9, -1);

    await expect(
      guard.canActivate(mockHttpExecutionContext(request)),
    ).rejects.toThrow(BadRequestException);
    expect(memberFindFirst).not.toHaveBeenCalled();
    expect(billing.assertOrganizationBillingActive).not.toHaveBeenCalled();
  });

  it("lanza BadRequestException cuando X-Organization-Id es inválido (<= 0)", async () => {
    const memberFindFirst = jest.fn();
    const prisma = makePrismaMock(memberFindFirst);
    const billing = makeBillingMock();
    const guard = new OrganizationGuard(prisma, billing);
    const request = internalAgentRequest(0, 15);

    await expect(
      guard.canActivate(mockHttpExecutionContext(request)),
    ).rejects.toThrow(BadRequestException);
    expect(memberFindFirst).not.toHaveBeenCalled();
  });
});

describe("OrganizationGuard — flujo JWT frontend (no isInternalAgent) sin cambios", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_DEV_PREVIEW = process.env.DEV_PREVIEW_AUTH;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    process.env.DEV_PREVIEW_AUTH = "false";
  });

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_DEV_PREVIEW === undefined) delete process.env.DEV_PREVIEW_AUTH;
    else process.env.DEV_PREVIEW_AUTH = ORIGINAL_DEV_PREVIEW;
    jest.restoreAllMocks();
  });

  it("pasa con membresía activa del JWT y pobla el rol real", async () => {
    const organization = {
      id: 5,
      slug: "tenant-a",
      billingExempt: false,
      plan: "BASIC",
      name: "Tenant A",
    };
    const membership = {
      id: 7,
      userId: 3,
      organizationId: 5,
      role: "ADMIN",
      status: "ACTIVE",
      joinedAt: new Date(),
      organization,
    };
    const memberFindFirst = jest.fn().mockResolvedValue(membership);
    const prisma = makePrismaMock(memberFindFirst);
    const billing = makeBillingMock();
    const guard = new OrganizationGuard(prisma, billing);
    const request: Record<string, unknown> = {
      headers: {},
      user: { id: 3, email: "user@tenant.a", organizationId: 5, tenantId: 5 },
    };

    await expect(
      guard.canActivate(mockHttpExecutionContext(request)),
    ).resolves.toBe(true);

    expect(memberFindFirst).toHaveBeenCalledWith({
      where: { userId: 3, organizationId: 5, status: "ACTIVE" },
      include: { organization: true },
    });
    expect(request.activeOrganizationId).toBe(5);
    expect(
      (request.activeOrganizationMembership as { role: string }).role,
    ).toBe("ADMIN");
  });

  it("lanza ForbiddenException cuando el usuario JWT no es miembro activo de la organización", async () => {
    const memberFindFirst = jest.fn().mockResolvedValue(null);
    const prisma = makePrismaMock(memberFindFirst, {
      user: {
        findUnique: jest.fn().mockResolvedValue({ isSuperAdmin: false }),
      },
    });
    const billing = makeBillingMock();
    const guard = new OrganizationGuard(prisma, billing);
    const request: Record<string, unknown> = {
      headers: {},
      user: { id: 3, email: "user@tenant.a", organizationId: 5, tenantId: 5 },
    };

    await expect(
      guard.canActivate(mockHttpExecutionContext(request)),
    ).rejects.toThrow(ForbiddenException);
  });

  it("lanza BadRequestException cuando el JWT no trae organización activa", async () => {
    const memberFindFirst = jest.fn();
    const prisma = makePrismaMock(memberFindFirst);
    const billing = makeBillingMock();
    const guard = new OrganizationGuard(prisma, billing);
    const request: Record<string, unknown> = {
      headers: {},
      user: { id: 3, email: "user@tenant.a" },
    };

    await expect(
      guard.canActivate(mockHttpExecutionContext(request)),
    ).rejects.toThrow(BadRequestException);
    expect(memberFindFirst).not.toHaveBeenCalled();
  });
});
