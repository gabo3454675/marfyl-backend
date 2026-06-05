/** Metadatos del evento temporal para correos de boletería. */
export const CONCERT_TICKET_EMAIL = {
  eventName: "Bodegón Monddy en Concierto",
  eventHeadline: "Horacio Blanco Acústico en Íntimo",
  mainArtist: "Horacio Blanco",
  lineup: "Horacio Blanco, Frederick Dyan, Génesis Rodd · Music by DJ Jaspe",
  entryTimeLabel: "5:30 PM",
  venueDefault: "Av. Francisco Solano, Chacaíto, Caracas",
  ageRestriction: "18+",
} as const;

export function buildSeatsSummary(
  seats: Array<{ seatLabel: string; sectionCode?: string }>,
): string {
  if (seats.length === 0) return "Por confirmar";
  return seats
    .map((s) => {
      const section = s.sectionCode ? ` (${s.sectionCode})` : "";
      return `${s.seatLabel}${section}`;
    })
    .join(" · ");
}
