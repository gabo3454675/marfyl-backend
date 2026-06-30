/** Negocios del grupo fundador: suscripción siempre gratuita. */
export const FOUNDING_ORG_SLUGS = [
  "el-rancho-de-german",
  "monddy",
  "davean",
] as const;

export type FoundingOrgSlug = (typeof FOUNDING_ORG_SLUGS)[number];

/** Única org con módulo de concierto / boletería temporal. */
export const CONCERT_ORG_SLUG = "monddy";

export function isFoundingOrgSlug(slug: string): boolean {
  return (FOUNDING_ORG_SLUGS as readonly string[]).includes(slug);
}

export function isBillingExemptOrg(org: {
  slug: string;
  billingExempt?: boolean;
}): boolean {
  return org.billingExempt === true || isFoundingOrgSlug(org.slug);
}

export function isConcertModuleEnabledForOrg(org: {
  slug: string;
  concertModuleEnabled?: boolean;
}): boolean {
  return org.concertModuleEnabled === true || org.slug === CONCERT_ORG_SLUG;
}

/** Todos los usuarios ven TODAS sus membresías. */
export function filterOrganizationsForLogin<T extends { slug: string }>(
  organizations: T[],
  options: { isPlatformSuperAdmin: boolean },
): T[] {
  if (options.isPlatformSuperAdmin) {
    return organizations;
  }
  // Todos los usuarios ven TODAS sus membresías (sin filtrar por founding org)
  return organizations;
}
