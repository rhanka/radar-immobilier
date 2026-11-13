// Runs inside the immutable candidate API image. No dotenv or network except DB.
async function main() {
  const { createDb } = await import('/workspace/api/dist/db/client.js');
  const { applyServiceRoleGrants } = await import('/workspace/api/dist/db/service-role-grants.js');
  const { migrateDatabaseCutover } = await import('/workspace/api/dist/scripts/database-cutover.js');
  const { db, pool } = createDb({ POSTGRES_HOST: process.env.PGHOST,
    POSTGRES_PORT: Number(process.env.PGPORT || 5432), POSTGRES_USER: process.env.PGUSER,
    POSTGRES_DB: process.env.PGDATABASE, POSTGRES_PASSWORD: process.env.PGPASSWORD });
  try {
    // Default OFF: the production people directory is never opened by this lane.
    await applyServiceRoleGrants(pool, {});
    let result = { ok: true, grants: 'applied' };
    if (process.env.CUTOVER_OPERATION === 'transition') {
      result = await migrateDatabaseCutover(db, JSON.parse(process.env.CUTOVER_PLAN),
        JSON.parse(process.env.CUTOVER_EVIDENCE));
    }
    process.stdout.write(JSON.stringify(result));
  } finally { await pool.end(); }
}
main().catch(() => { process.stderr.write('hook_failed\n'); process.exitCode = 1; });
