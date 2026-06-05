import { isConcertModuleEnabledForOrg } from "@/common/founding-orgs";

export function isConcertFeatureEnabled(): boolean {
  if (process.env.CONCERT_FEATURE_ENABLED === "false") return false;
  return (
    process.env.CONCERT_FEATURE_ENABLED === "true" ||
    process.env.NODE_ENV !== "production"
  );
}

export function isConcertEnabledForOrganization(org: {
  slug: string;
  concertModuleEnabled?: boolean;
}): boolean {
  if (!isConcertFeatureEnabled()) return false;
  return isConcertModuleEnabledForOrg(org);
}

export const CONCERT_HOLD_MINUTES = 12;
