/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const { Client } = require('pg');
const process = require('node:process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const env = process.env;
const operation = env.CUTOVER_DB_OPERATION;
const target = env.TARGET_DB;
// The staged template is a fixed name; the application databases alternate radar / radar_next.
const TEMPLATE = 'radar_tpl';
const valid = name => name === 'radar' || name === 'radar_next';
// Capacity facts for the receipt: database sizes, connection ceiling and sessions per database.
async function measure(c) {
  const sizes = {}, sessions = {};
  for (const row of (await c.query(`SELECT datname AS name, pg_database_size(datname)::bigint AS bytes
    FROM pg_database WHERE NOT datistemplate OR datname LIKE 'radar%'`)).rows) sizes[row.name] = Number(row.bytes);
  for (const row of (await c.query(`SELECT datname AS name, count(*)::int AS n FROM pg_stat_activity
    WHERE datname IS NOT NULL GROUP BY datname`)).rows) sessions[row.name] = row.n;
  const maxConnections = Number((await c.query('SHOW max_connections')).rows[0].max_connections);
  return { databaseSizes: sizes, sessionsByDb: sessions, maxConnections };
}
async function requireCreatedb(c) {
  const role = (await c.query('SELECT rolcreatedb OR rolsuper AS allowed FROM pg_roles WHERE rolname=current_user')).rows[0];
  if (!role?.allowed) throw Error('createdb_required');
}
const OPERATIONS = {
  // Stage: a fresh, connectable template (rerun-safe: drop first).
  async tplreset(c) {
    if (target !== TEMPLATE) throw Error();
    await requireCreatedb(c);
    await c.query(`DROP DATABASE IF EXISTS "${TEMPLATE}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${TEMPLATE}" TEMPLATE template0`);
    return {};
  },
  // Stage end: no new connection, no remaining session, size for the stamp.
  async tplseal(c) {
    if (target !== TEMPLATE) throw Error();
    await c.query(`ALTER DATABASE "${TEMPLATE}" ALLOW_CONNECTIONS false`);
    await c.query('SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity WHERE datname=$1', [TEMPLATE]);
    const left = (await c.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [TEMPLATE])).rows[0].n;
    if (left !== 0) throw Error('template_in_use');
    return { sizeBytes: Number((await c.query('SELECT pg_database_size($1)::bigint AS n', [TEMPLATE])).rows[0].n) };
  },
  // Prepare: file-level copy of the sealed template (two checkpoints, no replay).
  async clone(c, database) {
    if (!valid(target) || target === database) throw Error();
    await requireCreatedb(c);
    const started = Date.now();
    await c.query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${target}" TEMPLATE "${TEMPLATE}" STRATEGY FILE_COPY`);
    return { timings: { cloneMs: Date.now() - started } };
  },
  async discard(c, database) {
    if (!valid(target) || target === database) throw Error();
    await c.query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
    return {};
  },
  async destination(c, database) {
    if (database !== target) throw Error();
    const migrations = Number((await c.query('SELECT count(*) AS n FROM drizzle.__drizzle_migrations')).rows[0].n);
    const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8'));
    const applied = new Set((await c.query('SELECT hash FROM drizzle.__drizzle_migrations')).rows.map(r => r.hash));
    for (const entry of journal.entries) {
      if (!applied.has(crypto.createHash('sha256').update(fs.readFileSync(`drizzle/${entry.tag}.sql`)).digest('hex'))) throw Error('migration_missing');
    }
    return { migrations };
  },
  database: c => measure(c),
};
async function main() {
  if (env.POSTGRES_HOST !== 'radar-postgres' || !valid(env.POSTGRES_DB) || !OPERATIONS[operation]) throw Error();
  const c = new Client({ host: env.POSTGRES_HOST, user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB });
  await c.connect();
  try {
    const database = (await c.query('SELECT current_database() AS name')).rows[0].name;
    const facts = await OPERATIONS[operation](c, database);
    process.stdout.write(JSON.stringify({ ok: true, database, migrations: 0, ...facts }));
  } finally { await c.end(); }
}
main().catch(() => { process.stderr.write('database_operation_failed\n'); process.exitCode = 1; });
