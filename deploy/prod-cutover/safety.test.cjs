const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const r = require('./runtime.cjs');
const { migrationSql } = require('./migrate.cjs');
const entries = r.journal();
const applied = n => entries.slice(0, n).map(e => ({ hash: e.hash, created_at: String(e.when) }));
test('accepte les 13 empreintes historiques indépendamment de leur ordre', () => {
  assert.equal(r.prefix(applied(13).reverse(), entries), 13);
  assert.equal(r.prefix(applied(44), entries), 44);
});
test('refuse doublons, trous, divergence et timestamp falsifié', () => {
  for (const rows of [applied(12), [...applied(13), applied(13)[0]],
    [...applied(12), applied(14)[13]], applied(13).map((row, i) => i ? row : { ...row, created_at: '1' })]) {
    assert.throws(() => r.prefix(rows, entries));
  }
});
test('lie chaque transaction à son préfixe et inscrit le journal avant commit', () => {
  for (const e of entries.slice(13)) {
    const sql = migrationSql(e, entries.slice(0, e.idx));
    assert.match(sql, /^BEGIN;/);
    assert.match(sql, /SET LOCAL lock_timeout='5s'/);
    assert.match(sql, /SET LOCAL statement_timeout='300s'/);
    assert.match(sql, /pg_advisory_xact_lock/);
    assert.match(sql, new RegExp(`VALUES \\('${e.hash}',${e.when}\\);\\nCOMMIT;$`));
  }
});
test('toute mutation ENV=prod échoue avant tout accès réseau ou commande DB', () => {
  for (const action of ['backup', 'restore-test', 'migrate', 'transition', 'verify', 'rollback']) {
    const p = spawnSync(process.execPath, [require.resolve('./cli.cjs'), action], {
      env: { PATH: '/no-tools', ENV: 'prod', PGHOST: '127.0.0.1', PGUSER: 'synthetic', PGDATABASE: 'radar' }, encoding: 'utf8' });
    assert.equal(p.status, 1);
    assert.equal(p.stderr.trim(), 'production_read_only_lane');
    assert.equal(p.stdout, '');
  }
});
test('la copie refuse hôte distant, base live et service implicite', () => {
  for (const extra of [{ PGHOST: 'prod.example' }, { PGDATABASE: 'radar' }, { PGSERVICE: 'prod' }]) {
    const p = spawnSync(process.execPath, [require.resolve('./cli.cjs'), 'migrate'], {
      env: { PATH: '/no-tools', ENV: 'rehearsal', PGHOST: '127.0.0.1', PGUSER: 'synthetic',
        PGDATABASE: 'radar_cutover_test', ...extra }, encoding: 'utf8' });
    assert.equal(p.status, 1);
    assert.doesNotMatch(p.stderr, /command_failed/);
  }
});
test('une archive sans empreinte indépendante est refusée', () => {
  assert.throws(() => require('./backup.cjs').checkedArchive());
});
