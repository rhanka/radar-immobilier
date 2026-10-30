/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const { Client } = require('pg');
const process = require('node:process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const env = process.env;
const operation = env.CUTOVER_DB_OPERATION;
const target = env.TARGET_DB;
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
async function main() {
  if (env.POSTGRES_HOST !== 'radar-postgres' || !valid(env.POSTGRES_DB)) throw Error();
  const c = new Client({ host: env.POSTGRES_HOST, user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB });
  await c.connect();
  try {
    const database = (await c.query('SELECT current_database() AS name')).rows[0].name;
    if (operation === 'reset' || operation === 'discard') {
      if (!valid(target) || target === database) throw Error();
      if (operation === 'reset') {
        const role = (await c.query('SELECT rolcreatedb OR rolsuper AS allowed FROM pg_roles WHERE rolname=current_user')).rows[0];
        if (!role?.allowed) throw Error('createdb_required');
      }
      await c.query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
      if (operation === 'reset') await c.query(`CREATE DATABASE "${target}" TEMPLATE template0`);
    }
    let migrations = 0;
    if (operation === 'destination') {
      if (database !== target) throw Error();
      migrations = Number((await c.query('SELECT count(*) AS n FROM drizzle.__drizzle_migrations')).rows[0].n);
      const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8'));
      const applied = new Set((await c.query('SELECT hash FROM drizzle.__drizzle_migrations')).rows.map(r => r.hash));
      for (const entry of journal.entries) {
        if (!applied.has(crypto.createHash('sha256').update(fs.readFileSync(`drizzle/${entry.tag}.sql`)).digest('hex'))) throw Error('migration_missing');
      }
    }
    const facts = operation === 'database' ? await measure(c) : {};
    process.stdout.write(JSON.stringify({ ok: true, database, migrations, ...facts }));
  } finally { await c.end(); }
}
main().catch(() => { process.stderr.write('database_operation_failed\n'); process.exitCode = 1; });
