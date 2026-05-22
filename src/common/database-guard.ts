/**
 * Evita conectar MARFYL por error a la base de datos legacy de DISIS.
 * Desactivar solo en casos excepcionales: MARFYL_SKIP_DATABASE_GUARD=true
 */
export function assertMarfylDatabaseUrl(databaseUrl: string | undefined): void {
  if (process.env.MARFYL_SKIP_DATABASE_GUARD === 'true') {
    return;
  }

  const url = databaseUrl?.trim();
  if (!url) {
    return;
  }

  const markers = (
    process.env.MARFYL_FORBIDDEN_DB_MARKERS ??
    'disis_db,disis_user,disisapp,disis-monorepo'
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const normalized = url.toLowerCase();
  const hit = markers.find((m) => normalized.includes(m));

  if (hit) {
    throw new Error(
      `[MARFYL] DATABASE_URL no debe usar la base de DISIS (detectado: "${hit}"). ` +
        'Crea una PostgreSQL nueva y configura backend/.env. Guía: docs/DATABASE.md',
    );
  }
}
