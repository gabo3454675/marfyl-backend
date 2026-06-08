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

/** Reserva temporal mientras el comprador completa el formulario (sin orden creada). */
export const CONCERT_HOLD_MINUTES = 12;

/** Tras enviar la compra sin confirmar pago, la orden pendiente expira y libera asientos. */
export const CONCERT_PENDING_ORDER_HOURS = Number(
  process.env.CONCERT_PENDING_ORDER_HOURS ?? 2,
);
