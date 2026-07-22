import { timingSafeEqual } from "crypto";
import { UnauthorizedException, BadRequestException } from "@nestjs/common";

/** Header compartido con el agente Python (NestJSClient). */
export const INTERNAL_SECRET_HEADER = "x-internal-secret";
export const INTERNAL_ORGANIZATION_HEADER = "x-organization-id";
export const INTERNAL_USER_HEADER = "x-user-id";

/** userId sintético cuando el agente no envía X-User-Id (no usar 0: reservado a dev-preview). */
export const INTERNAL_AGENT_DEFAULT_USER_ID = -1;

export type InternalAgentUser = {
  id: number;
  email: string;
  isSuperAdmin: boolean;
  organizationId: number;
  tenantId: number;
  isInternalAgent: true;
};

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0]?.toString().trim();
  if (raw == null) return undefined;
  return String(raw).trim();
}

/**
 * Comparación timing-safe de secretos.
 * Longitudes distintas → false (sin filtrar el valor esperado).
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function getAgentSecret(): string | undefined {
  const secret = process.env.AGENT_SECRET?.trim();
  return secret && secret.length > 0 ? secret : undefined;
}

export function parsePositiveIntHeader(
  value: string | undefined,
  label: string,
): number {
  if (value == null || value === "") {
    throw new BadRequestException(`Header ${label} es obligatorio`);
  }
  if (!/^\d+$/.test(value)) {
    throw new BadRequestException(
      `Header ${label} debe ser un entero positivo (no se permite 0)`,
    );
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException(
      `Header ${label} debe ser un entero positivo (no se permite 0)`,
    );
  }
  return n;
}

export function parseOptionalPositiveIntHeader(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value == null || value === "") return undefined;
  return parsePositiveIntHeader(value, label);
}

/**
 * Si la request trae X-Internal-Secret, valida contra AGENT_SECRET y puebla request.user.
 * - Header ausente → false (continuar con JWT).
 * - Header presente e inválido / AGENT_SECRET no configurado → UnauthorizedException.
 * - Válido → true (request.user listo; OrganizationGuard debe respetar isInternalAgent).
 */
export function tryAuthenticateInternalAgent(request: {
  headers?: Record<string, unknown>;
  user?: unknown;
}): boolean {
  const provided = headerValue(request.headers, INTERNAL_SECRET_HEADER);
  if (provided == null || provided === "") {
    return false;
  }

  const expected = getAgentSecret();
  if (!expected || !timingSafeEqualString(provided, expected)) {
    throw new UnauthorizedException("Invalid internal agent secret");
  }

  const orgRaw = headerValue(request.headers, INTERNAL_ORGANIZATION_HEADER);
  const organizationId = parsePositiveIntHeader(
    orgRaw,
    "X-Organization-Id",
  );

  const userRaw = headerValue(request.headers, INTERNAL_USER_HEADER);
  const userId =
    parseOptionalPositiveIntHeader(userRaw, "X-User-Id") ??
    INTERNAL_AGENT_DEFAULT_USER_ID;

  const user: InternalAgentUser = {
    id: userId,
    email: "agent@internal.marfyl",
    // Plataforma: false — AGENT_SECRET no es llave de SuperAdmin global.
    // Acceso tenant: isInternalAgent + membership SUPER_ADMIN en OrganizationGuard.
    isSuperAdmin: false,
    organizationId,
    tenantId: organizationId,
    isInternalAgent: true,
  };

  request.user = user;
  return true;
}
