/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const process = require('node:process');
const path = require('node:path');
test('database preparation checks CREATEDB, protects live identity and verifies release migrations', async () => {
  assert.equal(process.env.POSTGRES_PASSWORD, 'synthetic-only');
  const c = new Client({ host: 'postgres', user: 'radar', password: 'synthetic-only', database: 'radar' });
  await c.connect();
  const run = (operation, target, extra = {}) => spawnSync(process.execPath,
    [path.resolve('deploy/cutover/database.cjs')], { cwd: path.resolve('api'), encoding: 'utf8',
      env: { ...process.env, POSTGRES_HOST: 'radar-postgres', CUTOVER_DB_OPERATION: operation, TARGET_DB: target, ...extra } });
  try {
    await c.query("CREATE ROLE cutover_no_createdb LOGIN PASSWORD 'synthetic-limited-only'");
    assert.notEqual(run('reset', 'radar_next', { POSTGRES_USER: 'cutover_no_createdb', POSTGRES_PASSWORD: 'synthetic-limited-only' }).status, 0);
    assert.notEqual(run('reset', 'radar').status, 0, 'live database cannot be dropped');
    const reset = run('reset', 'radar_next');
    assert.equal(reset.status, 0, reset.stderr);
    const empty = run('destination', 'radar_next', { POSTGRES_DB: 'radar_next' });
    assert.notEqual(empty.status, 0, 'an empty prepared schema cannot pass');
    const migrated = run('destination', 'radar', { POSTGRES_DB: 'radar' });
    assert.equal(migrated.status, 0, migrated.stderr);
    assert.ok(JSON.parse(migrated.stdout).migrations > 0);
    assert.equal(run('discard', 'radar_next').status, 0);
    assert.equal((await c.query('SELECT current_database() AS name')).rows[0].name, 'radar');
  } finally {
    await c.query('DROP DATABASE IF EXISTS radar_next WITH (FORCE)');
    await c.query('DROP ROLE IF EXISTS cutover_no_createdb');
    await c.end();
  }
});
