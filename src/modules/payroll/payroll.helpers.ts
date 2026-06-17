import {
  PayrollPayType,
  PayrollProfileStatus,
  type PayrollProfile,
} from "@prisma/client";

export const PAYROLL_CATEGORY_NAME = "Nómina";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SELLER: "Cajero/Vendedor",
  WAREHOUSE: "Almacén",
  FISCAL: "Fiscal",
};

const DEFAULT_BY_ROLE: Record<
  string,
  { payType: PayrollPayType; baseSalary: number; commissionPct?: number }
> = {
  SUPER_ADMIN: { payType: "FIXED", baseSalary: 800 },
  ADMIN: { payType: "FIXED", baseSalary: 800 },
  MANAGER: { payType: "FIXED", baseSalary: 600 },
  SELLER: { payType: "COMMISSION", baseSalary: 120, commissionPct: 5 },
  WAREHOUSE: { payType: "FIXED", baseSalary: 380 },
};

export function roleToLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function defaultProfileForRole(role: string) {
  return (
    DEFAULT_BY_ROLE[role] ?? { payType: "FIXED" as PayrollPayType, baseSalary: 400 }
  );
}

export function num(v: unknown): number {
  if (v == null) return 0;
  if (
    typeof v === "object" &&
    v !== null &&
    "toNumber" in v &&
    typeof (v as { toNumber: () => number }).toNumber === "function"
  ) {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function calculateNetAmount(profile: {
  payType: PayrollPayType;
  baseSalary: unknown;
  commissionPct?: unknown | null;
  hoursWorked?: unknown | null;
  bonuses: unknown;
  deductions: unknown;
}): number {
  let base = num(profile.baseSalary);
  if (profile.payType === "HOURLY" && profile.hoursWorked != null) {
    base = base * num(profile.hoursWorked);
  } else if (profile.payType === "COMMISSION") {
    base = base + base * (num(profile.commissionPct) / 100);
  }
  return Math.round((base + num(profile.bonuses) - num(profile.deductions)) * 100) / 100;
}

export function mapProfileStatus(
  status: PayrollProfileStatus,
): "paid" | "pending" | "review" {
  switch (status) {
    case "PAID":
      return "paid";
    case "REVIEW":
      return "review";
    default:
      return "pending";
  }
}

export function mapPayTypeToFrontend(
  payType: PayrollPayType,
): "fixed" | "commission" | "hourly" {
  switch (payType) {
    case "COMMISSION":
      return "commission";
    case "HOURLY":
      return "hourly";
    default:
      return "fixed";
  }
}

export function mapPayTypeFromFrontend(
  type: "fixed" | "commission" | "hourly",
): PayrollPayType {
  switch (type) {
    case "commission":
      return "COMMISSION";
    case "hourly":
      return "HOURLY";
    default:
      return "FIXED";
  }
}

export function mapStatusFromFrontend(
  status: "paid" | "pending" | "review",
): PayrollProfileStatus {
  switch (status) {
    case "paid":
      return "PAID";
    case "review":
      return "REVIEW";
    default:
      return "PENDING";
  }
}

export type PayrollProfileWithMember = PayrollProfile & {
  member: {
    id: number;
    role: string;
    status: string;
    user: {
      id: number;
      email: string;
      fullName: string | null;
      avatarUrl: string | null;
    };
  };
};
