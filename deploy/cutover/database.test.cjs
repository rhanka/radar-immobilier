/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const process = require('node:process');
const path = require('node:path');
const connect = async database => {
  const c = new Client({ host: 'postgres', user: 'radar', password: 'synthetic-only', database });
  await c.connect();
  return c;
};
const run = (operation, target, extra = {}) => spawnSync(process.execPath,
  [path.resolve('deploy/cutover/database.cjs')], { cwd: path.resolve('api'), encoding: 'utf8',
    env: { ...process.env, POSTGRES_HOST: 'radar-postgres', CUTOVER_DB_OPERATION: operation, TARGET_DB: target, ...extra } });
test('database preparation checks CREATEDB, protects live identity and verifies release migrations', async () => {
  assert.equal(process.env.POSTGRES_PASSWORD, 'synthetic-only');
  const c = await connect('radar');
  try {
    await c.query("CREATE ROLE cutover_no_createdb LOGIN PASSWORD 'synthetic-limited-only'");
    const measured = run('database', '');
    assert.equal(measured.status, 0, measured.stderr);
    const facts = JSON.parse(measured.stdout);
    assert.ok(facts.databaseSizes.radar > 0 && facts.maxConnections > 0 && facts.sessionsByDb.radar >= 1, measured.stdout);
    assert.equal(run('tplreset', 'radar_tpl').status, 0);
    assert.equal(run('tplseal', 'radar_tpl').status, 0);
    assert.notEqual(run('clone', 'radar_next', { POSTGRES_USER: 'cutover_no_createdb', POSTGRES_PASSWORD: 'synthetic-limited-only' }).status, 0);
    assert.notEqual(run('clone', 'radar').status, 0, 'live database cannot be replaced');
    assert.notEqual(run('unknown', 'radar_next').status, 0);
    const clone = run('clone', 'radar_next');
    assert.equal(clone.status, 0, clone.stderr);
    const empty = run('destination', 'radar_next', { POSTGRES_DB: 'radar_next' });
    assert.notEqual(empty.status, 0, 'an empty prepared schema cannot pass');
    const migrated = run('destination', 'radar', { POSTGRES_DB: 'radar' });
    assert.equal(migrated.status, 0, migrated.stderr);
    assert.ok(JSON.parse(migrated.stdout).migrations > 0);
    assert.equal(run('discard', 'radar_next').status, 0);
    assert.equal((await c.query('SELECT current_database() AS name')).rows[0].name, 'radar');
  } finally {
    for (const db of ['radar_next', 'radar_tpl']) await c.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await c.query('DROP ROLE IF EXISTS cutover_no_createdb');
    await c.end();
  }
});
test('staged template: clone copies data, two consecutive stages rerun, a session on the template refuses the clone', async () => {
  const c = await connect('radar');
  try {
    for (const day of [1, 2]) {
      assert.equal(run('tplreset', 'radar_tpl').status, 0, `stage ${day} reset`);
      const t = await connect('radar_tpl');
      await t.query(`CREATE TABLE staged (day int); INSERT INTO staged VALUES (${day})`);
      await t.end();
      const sealed = run('tplseal', 'radar_tpl');
      assert.equal(sealed.status, 0, sealed.stderr);
      assert.ok(JSON.parse(sealed.stdout).sizeBytes > 0);
      await assert.rejects(connect('radar_tpl'), /not currently accepting connections/);
      const clone = run('clone', 'radar_next');
      assert.equal(clone.status, 0, clone.stderr);
      assert.ok(JSON.parse(clone.stdout).timings.cloneMs >= 0);
      const n = await connect('radar_next');
      assert.equal((await n.query('SELECT day FROM staged')).rows[0].day, day);
      await n.end();
    }
    assert.equal(run('tplreset', 'radar_tpl').status, 0);
    const holder = await connect('radar_tpl');
    try { assert.notEqual(run('clone', 'radar_next').status, 0, 'a session on the template refuses the clone'); }
    finally { await holder.end(); }
  } finally {
    for (const db of ['radar_next', 'radar_tpl']) await c.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await c.end();
  }
});
test('freeze refuses every write from frozenAt; unfreeze makes pooled sessions writable again', async () => {
  const { Pool } = require('pg');
  const c = await connect('radar');
  await c.query('DROP DATABASE IF EXISTS radar_next WITH (FORCE)');
  await c.query('CREATE DATABASE radar_next TEMPLATE template0');
  const pool = new Pool({ host: 'postgres', user: 'radar', password: 'synthetic-only', database: 'radar_next', max: 2 });
  pool.on('error', () => {});
  // A terminated pooled session fails once (57P01); the next checkout opens a fresh session.
  const attempt = async sql => { try { await pool.query(sql); return 'ok'; } catch (e) { return e.code; } };
  const settle = async sql => {
    let code = await attempt(sql);
    for (let i = 0; i < 3 && code !== 'ok' && code !== '25006'; i++) code = await attempt(sql);
    return code;
  };
  try {
    assert.equal(await attempt('CREATE TABLE writes (id int)'), 'ok');
    const frozen = run('freeze', 'radar_next');
    assert.equal(frozen.status, 0, frozen.stderr);
    const frozenAt = JSON.parse(frozen.stdout).frozenAt;
    assert.match(frozenAt, /^\d{4}-\d\d-\d\dT[0-9:.]+Z$/);
    assert.equal(await settle('INSERT INTO writes VALUES (1)'), '25006', 'a write after the freeze is refused read-only');
    assert.equal(await attempt('SELECT count(*) FROM writes'), 'ok', 'reads are still served');
    const old = await c.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname='radar_next' AND backend_start < $1`, [frozenAt]);
    assert.equal(old.rows[0].n, 0, 'no session opened before the freeze remains');
    const unfrozen = run('unfreeze', 'radar_next');
    assert.equal(unfrozen.status, 0, unfrozen.stderr);
    assert.equal(await settle('INSERT INTO writes VALUES (2)'), 'ok', 'pooled sessions reconnect writable');
    assert.equal((await c.query('SELECT 1')).rowCount, 1, 'the operator session on another database is untouched');
  } finally {
    await pool.end();
    await c.query('DROP DATABASE IF EXISTS radar_next WITH (FORCE)');
    await c.end();
  }
});
