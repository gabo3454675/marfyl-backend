import {
  isConcertModuleEnabledForOrg,
  isBillingExemptOrg,
} from "./founding-orgs";

export function mapOrganizationForClient(
  org: {
    id: number;
    nombre: string;
    slug: string;
    plan: string;
    currencyCode?: string | null;
    currencySymbol?: string | null;
    exchangeRate?: number | null;
    rateUpdatedAt?: Date | null;
    billingExempt?: boolean;
    concertModuleEnabled?: boolean;
  },
  role: string,
) {
  return {
    id: org.id,
    name: org.nombre,
    slug: org.slug,
    plan: org.plan,
    currencyCode: org.currencyCode ?? "USD",
    currencySymbol: org.currencySymbol ?? "$",
    exchangeRate: org.exchangeRate ?? 1,
    rateUpdatedAt: org.rateUpdatedAt ?? null,
    role,
    billingExempt: isBillingExemptOrg(org),
    concertModuleEnabled: isConcertModuleEnabledForOrg(org),
  };
}

export const organizationSelectForAuth = {
  id: true,
  nombre: true,
  slug: true,
  plan: true,
  currencyCode: true,
  currencySymbol: true,
  exchangeRate: true,
  rateUpdatedAt: true,
  billingExempt: true,
  concertModuleEnabled: true,
} as const;
