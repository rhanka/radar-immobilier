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
async function main() {
  if (env.POSTGRES_HOST !== 'radar-postgres' || !valid(env.POSTGRES_DB)) throw Error();
  const c = new Client({ host: env.POSTGRES_HOST, user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB });
  await c.connect();
  try {
    const database = (await c.query('SELECT current_database() AS name')).rows[0].name;
    if (operation === 'reset' || operation === 'discard') {
      if (!valid(target) || target === database) throw Error();
      const role = (await c.query('SELECT rolcreatedb OR rolsuper AS allowed FROM pg_roles WHERE rolname=current_user')).rows[0];
      if (!role?.allowed) throw Error('createdb_required');
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
    process.stdout.write(JSON.stringify({ ok: true, database, migrations }));
  } finally { await c.end(); }
}
main().catch(() => { process.stderr.write('database_operation_failed\n'); process.exitCode = 1; });
