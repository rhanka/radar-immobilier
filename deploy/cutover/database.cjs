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
  // Volume occupancy without any shell in the PostgreSQL Pod: every database plus the WAL
  // (pg_ls_waldir when granted, else the max_wal_size ceiling), compared to the claim capacity.
  async volume(c) {
    const total = Number((await c.query('SELECT sum(pg_database_size(datname))::bigint AS n FROM pg_database')).rows[0].n);
    const live = Number((await c.query('SELECT pg_database_size(current_database())::bigint AS n')).rows[0].n);
    let walBytes, walFromSetting = false;
    try {
      walBytes = Number((await c.query('SELECT coalesce(sum(size), 0)::bigint AS n FROM pg_ls_waldir()')).rows[0].n);
    } catch {
      walFromSetting = true;
      walBytes = Number((await c.query("SELECT pg_size_bytes(current_setting('max_wal_size'))::bigint AS n")).rows[0].n);
    }
    return { volumeUsedBytes: total + walBytes, liveDbBytes: live, walBytes, walFromSetting };
  },
  // Preprod switch: from frozenAt the live database accepts no write. New sessions start
  // read-only (25006 on write); sessions opened before the change are terminated (57P01) and
  // read back as gone. The API answers both with an explicit 503 maintenance_read_only.
  async freeze(c) {
    if (!valid(target)) throw Error();
    await c.query(`ALTER DATABASE "${target}" SET default_transaction_read_only = on`);
    const since = (await c.query('SELECT clock_timestamp() AS at')).rows[0].at;
    const writable = `SELECT pid FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()
      AND backend_type='client backend' AND backend_start < $2`;
    for (let attempt = 0; attempt < 10; attempt++) {
      await c.query(`SELECT pg_terminate_backend(pid, 3000) FROM (${writable}) s`, [target, since]);
      if ((await c.query(writable, [target, since])).rows.length === 0) {
        return { freezeStartedAt: since.toISOString(),
          frozenAt: (await c.query('SELECT clock_timestamp() AS at')).rows[0].at.toISOString() };
      }
    }
    throw Error('writable_sessions_remain');
  },
  // Written tuples per application database (pg_stat_database): a rollback compares them to the
  // baseline taken before the switch to detect acknowledged writes it abandons.
  async writestats(c) {
    const writeStats = {};
    for (const row of (await c.query(`SELECT datname AS name, (tup_inserted + tup_updated + tup_deleted)::bigint AS n
      FROM pg_stat_database WHERE datname IN ('radar', 'radar_next')`)).rows) writeStats[row.name] = Number(row.n);
    return { writeStats };
  },
  // Rehearsal: probe rows written in one database since a baseline time (proof for ack-probe).
  async probecount() {
    const prefix = env.PROBE_RUN, since = env.PROBE_SINCE;
    if (!valid(target) || !/^[a-z0-9-]{1,63}$/.test(prefix || '') || Number.isNaN(Date.parse(since || ''))) throw Error();
    const d = new Client({ host: env.POSTGRES_HOST, user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: target });
    try {
      await d.connect();
      const n = (await d.query('SELECT count(*)::int AS n FROM cutover_probe_writes WHERE starts_with(run, $1) AND at >= $2', [prefix, since])).rows[0].n;
      return { probeRows: n };
    } catch (e) {
      if (e.code === '42P01') return { probeRows: 0 };
      throw e;
    } finally { await d.end().catch(() => {}); }
  },
  // Rehearsal: acknowledged probe writes present in each application database, as seq ranges.
  async probeverify() {
    const run = env.PROBE_RUN;
    if (!/^[a-z0-9-]{1,64}$/.test(run || '')) throw Error();
    const probe = {};
    for (const name of ['radar', 'radar_next']) {
      const d = new Client({ host: env.POSTGRES_HOST, user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: name });
      try {
        await d.connect();
        const seqs = (await d.query(`SELECT seq FROM cutover_probe_writes WHERE run=$1 ORDER BY seq`, [run])).rows.map(r => r.seq);
        const ranges = [];
        for (const seq of seqs) {
          if (ranges.length && ranges.at(-1)[1] === seq - 1) ranges.at(-1)[1] = seq; else ranges.push([seq, seq]);
        }
        probe[name] = ranges;
      } catch (e) {
        // An absent database or a schema without the probe table holds no acknowledged write.
        if (e.code !== '3D000' && e.code !== '42P01') throw e;
        probe[name] = [];
      } finally { await d.end().catch(() => {}); }
    }
    return { probe };
  },
  // Rollback before promotion: writes again, and pooled read-only sessions reconnect writable.
  async unfreeze(c) {
    if (!valid(target)) throw Error();
    await c.query(`ALTER DATABASE "${target}" RESET default_transaction_read_only`);
    const since = (await c.query('SELECT clock_timestamp() AS at')).rows[0].at;
    await c.query(`SELECT pg_terminate_backend(pid, 3000) FROM pg_stat_activity WHERE datname=$1
      AND pid<>pg_backend_pid() AND backend_type='client backend' AND backend_start < $2`, [target, since]);
    return { unfrozenAt: since.toISOString() };
  },
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
