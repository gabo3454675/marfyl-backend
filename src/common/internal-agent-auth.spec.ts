import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { SuperAdminGuard } from "./guards/super-admin.guard";
import {
  getAgentSecret,
  INTERNAL_AGENT_DEFAULT_USER_ID,
  parsePositiveIntHeader,
  timingSafeEqualString,
  tryAuthenticateInternalAgent,
} from "./internal-agent-auth";

jest.mock("./prisma/prisma.service", () => ({
  PrismaService: class PrismaService {},
}));
jest.mock("./billing/organization-billing.service", () => ({
  OrganizationBillingService: class OrganizationBillingService {},
}));

// Import after mocks so OrganizationGuard does not load real Prisma/path aliases.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OrganizationGuard } = require("./guards/organization.guard") as {
  OrganizationGuard: new (
    prisma: unknown,
    billing: unknown,
  ) => {
    canActivate(context: ExecutionContext): Promise<boolean>;
  };
};

function mockHttpExecutionContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

describe("internal-agent-auth", () => {
  const ORIGINAL_SECRET = process.env.AGENT_SECRET;

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.AGENT_SECRET;
    } else {
      process.env.AGENT_SECRET = ORIGINAL_SECRET;
    }
  });

  describe("timingSafeEqualString", () => {
    it("acepta secretos iguales", () => {
      expect(timingSafeEqualString("abc", "abc")).toBe(true);
    });

    it("rechaza secretos distintos o de distinta longitud", () => {
      expect(timingSafeEqualString("abc", "abd")).toBe(false);
      expect(timingSafeEqualString("abc", "ab")).toBe(false);
    });
  });

  describe("parsePositiveIntHeader", () => {
    it("parsea enteros positivos", () => {
      expect(parsePositiveIntHeader("42", "X-Organization-Id")).toBe(42);
    });

    it("rechaza 0 y valores inválidos", () => {
      expect(() => parsePositiveIntHeader("0", "X-Organization-Id")).toThrow(
        BadRequestException,
      );
      expect(() => parsePositiveIntHeader("-1", "X-Organization-Id")).toThrow(
        BadRequestException,
      );
      expect(() => parsePositiveIntHeader("x", "X-Organization-Id")).toThrow(
        BadRequestException,
      );
    });
  });

  describe("tryAuthenticateInternalAgent", () => {
    it("retorna false si no hay header de secret", () => {
      process.env.AGENT_SECRET = "test-secret";
      const request = { headers: {} };
      expect(tryAuthenticateInternalAgent(request)).toBe(false);
      expect(request).not.toHaveProperty("user");
    });

    it("rechaza secret inválido", () => {
      process.env.AGENT_SECRET = "test-secret";
      const request = {
        headers: {
          "x-internal-secret": "wrong",
          "x-organization-id": "3",
        },
      };
      expect(() => tryAuthenticateInternalAgent(request)).toThrow(
        UnauthorizedException,
      );
    });

    it("rechaza si AGENT_SECRET no está configurado", () => {
      delete process.env.AGENT_SECRET;
      const request = {
        headers: {
          "x-internal-secret": "anything",
          "x-organization-id": "3",
        },
      };
      expect(() => tryAuthenticateInternalAgent(request)).toThrow(
        UnauthorizedException,
      );
      expect(getAgentSecret()).toBeUndefined();
    });

    it("puebla request.user con isInternalAgent cuando el secret es válido", () => {
      process.env.AGENT_SECRET = "shared-agent-secret";
      const request: { headers: Record<string, string>; user?: unknown } = {
        headers: {
          "x-internal-secret": "shared-agent-secret",
          "x-organization-id": "7",
          "x-user-id": "15",
        },
      };

      expect(tryAuthenticateInternalAgent(request)).toBe(true);
      expect(request.user).toEqual({
        id: 15,
        email: "agent@internal.marfyl",
        isSuperAdmin: false,
        organizationId: 7,
        tenantId: 7,
        isInternalAgent: true,
      });
    });

    it("usa userId sintético si falta X-User-Id", () => {
      process.env.AGENT_SECRET = "shared-agent-secret";
      const request: { headers: Record<string, string>; user?: { id: number } } =
        {
          headers: {
            "x-internal-secret": "shared-agent-secret",
            "x-organization-id": "2",
          },
        };

      expect(tryAuthenticateInternalAgent(request)).toBe(true);
      expect(request.user?.id).toBe(INTERNAL_AGENT_DEFAULT_USER_ID);
    });

    it("con secret válido: SuperAdminGuard rechaza; OrganizationGuard da acceso tenant", async () => {
      process.env.AGENT_SECRET = "shared-agent-secret";
      const request: Record<string, unknown> = {
        headers: {
          "x-internal-secret": "shared-agent-secret",
          "x-organization-id": "9",
        },
      };

      expect(tryAuthenticateInternalAgent(request)).toBe(true);
      const user = request.user as {
        isSuperAdmin: boolean;
        isInternalAgent: boolean;
        organizationId: number;
      };
      expect(user.isSuperAdmin).toBe(false);
      expect(user.isInternalAgent).toBe(true);

      const superAdminGuard = new SuperAdminGuard();
      expect(() =>
        superAdminGuard.canActivate(mockHttpExecutionContext(request)),
      ).toThrow(ForbiddenException);

      const organization = {
        id: 9,
        slug: "acme",
        billingExempt: true,
        plan: "PRO",
        name: "Acme",
      };
      const prisma = {
        organization: {
          findUnique: jest.fn().mockResolvedValue(organization),
        },
      };
      const billing = {
        assertOrganizationBillingActive: jest.fn().mockResolvedValue(undefined),
      };
      const organizationGuard = new OrganizationGuard(prisma, billing);

      await expect(
        organizationGuard.canActivate(mockHttpExecutionContext(request)),
      ).resolves.toBe(true);

      expect(request.activeOrganizationId).toBe(9);
      expect(
        (request.activeOrganizationMembership as { role: string }).role,
      ).toBe("SUPER_ADMIN");
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 9 },
      });
    });
  });
});
