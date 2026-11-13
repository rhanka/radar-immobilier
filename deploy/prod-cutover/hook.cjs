// Runs inside the immutable candidate API image. No dotenv or network except DB.
async function main() {
  // Deadline survives a killed controller or Docker client.
  const timer = setTimeout(() => process.exit(124), 535000);
  timer.unref();
  const { spawnSync } = require('node:child_process');
  const postgres = await import('/workspace/node_modules/pg/lib/index.js');
  const { drizzle } = await import('/workspace/node_modules/drizzle-orm/node-postgres/index.js');
  const { migrateDatabaseCutover } = await import('/workspace/api/dist/scripts/database-cutover.js');
  const pool = new postgres.default.Pool({ connectionTimeoutMillis: 5000, max: 5 });
  const db = drizzle(pool);
  try {
    // All 44 hash/time pairs were checked. The candidate migrator applies no DDL;
    // it re-applies the existing service grants, with people lookup OFF.
    const migrated = spawnSync(process.execPath, ['dist/db/migrate.js'], {
      cwd: '/workspace/api', timeout: 60000, stdio: 'pipe', env: { ...process.env,
        POSTGRES_HOST: process.env.PGHOST, POSTGRES_PORT: process.env.PGPORT || '5432',
        POSTGRES_USER: process.env.PGUSER, POSTGRES_DB: process.env.PGDATABASE,
        POSTGRES_PASSWORD: process.env.PGPASSWORD, IMMO_MCP_PEOPLE_LOOKUP_ENABLED: '0' } });
    if (migrated.status !== 0 || migrated.error) throw Error('service_grants_failed');
    let result = { ok: true, grants: 'applied' };
    if (process.env.CUTOVER_OPERATION === 'transition') {
      result = await migrateDatabaseCutover(db, JSON.parse(process.env.CUTOVER_PLAN),
        JSON.parse(process.env.CUTOVER_EVIDENCE));
    }
    process.stdout.write(JSON.stringify(result));
  } finally { await pool.end(); clearTimeout(timer); }
}
main().catch(() => { process.stderr.write('hook_failed\n'); process.exitCode = 1; });
