/** Negocios del grupo fundador: suscripción siempre gratuita. */
export const FOUNDING_ORG_SLUGS = [
  "el-rancho-de-german",
  "monddy",
  "davean",
] as const;

export type FoundingOrgSlug = (typeof FOUNDING_ORG_SLUGS)[number];

/** Única org con módulo de concierto / boletería temporal. */
export const CONCERT_ORG_SLUG = "monddy";

/** Org sin cálculo ni cobro de IVA en ventas (precio = total). */
export const IVA_DISABLED_ORG_SLUG = "el-rancho-de-german";

export function isFoundingOrgSlug(slug: string): boolean {
  return (FOUNDING_ORG_SLUGS as readonly string[]).includes(slug);
}

export function isIvaDisabledOrgSlug(slug: string | null | undefined): boolean {
  return slug === IVA_DISABLED_ORG_SLUG;
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
  // Solo el flag de la org. El slug monddy ya no fuerza el módulo encendido.
  return org.concertModuleEnabled === true;
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
