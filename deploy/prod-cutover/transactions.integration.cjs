/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const r = require('./runtime.cjs');
const { migrate } = require('./migrate.cjs');
const { restoreTest, rollback } = require('./backup.cjs');
test('copie réelle : 13 → 44 → 13, reprise, données, propriétaires et ACL', () => {
  const entries = r.journal();
  const target = process.env.PGDATABASE;
  r.sql('CREATE DATABASE radar; CREATE ROLE legacy_owner; CREATE ROLE legacy_reader;');
  process.env.PGDATABASE = 'radar';
  r.sql('CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);');
  for (const e of entries.slice(0, 13)) {
    r.sql(`BEGIN; ${r.fs.readFileSync(e.file, 'utf8').replaceAll('--> statement-breakpoint', '')}
      INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('${e.hash}',${e.when}); COMMIT;`);
  }
  r.sql(`CREATE TABLE recovery_probe(id int PRIMARY KEY, value text);
    INSERT INTO recovery_probe VALUES (1,'baseline');
    ALTER TABLE recovery_probe OWNER TO legacy_owner;
    GRANT SELECT ON recovery_probe TO legacy_reader;`);
  const ownership = () => r.sql(`SELECT json_agg(x ORDER BY schema,name)::text FROM
    (SELECT n.nspname schema,c.relname name,pg_get_userbyid(c.relowner) owner,c.relacl::text acl
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','S','v')) x;`);
  const original = ownership();
  const archive = r.path.join(r.output(), 'synthetic-test.dump');
  r.run('pg_dump', ['--format=custom', `--file=${archive}`]);
  process.env.PGDATABASE = target;
  process.env.ARCHIVE = archive;
  process.env.RESTORE_SHA256 = r.hash(archive);
  const proof = r.path.join(r.output(), 'evidence.json');
  r.fs.writeFileSync(proof, JSON.stringify({ run: r.crypto.randomUUID(), release: r.SHA,
    instances: ['synthetic-integration-bootstrap-terminated'], completedAt: new Date().toISOString() }));
  process.env.EVIDENCE = proof;
  for (const [name, value] of Object.entries({
    plan: { accounts: [{ sub: 'synthetic' }] }, roster: [{ sub: 'synthetic' }],
  })) {
    const file = r.path.join(r.output(), `${name}.json`);
    r.fs.writeFileSync(file, JSON.stringify(value));
    process.env[name.toUpperCase()] = file;
  }
  process.env.APPROVAL = r.path.join(r.output(), 'approval.json');
  r.fs.writeFileSync(process.env.APPROVAL, JSON.stringify({ owner: 'synthetic', sha: r.SHA,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    planSha256: r.hash(process.env.PLAN), rosterSha256: r.hash(process.env.ROSTER) }));
  restoreTest();
  const snapshot = r.receipt('backup');
  assert.equal(snapshot.sha256, process.env.RESTORE_SHA256);
  assert.deepEqual(snapshot.destination, r.identity());
  assert.deepEqual(restoreTest(), r.receipt('restore'));
  assert.equal(ownership(), original);
  const first = migrate();
  assert.equal(first.applied.length, 31);
  assert.equal(migrate().applied.length, 0);
  assert.equal(r.prefix(r.rows()), 44);
  assert.throws(() => r.sql('BEGIN; CREATE TABLE cutover_rollback_probe(id int); SELECT * FROM cutover_missing_table; COMMIT;'));
  assert.equal(r.sql("SELECT to_regclass('public.cutover_rollback_probe') IS NULL;"), 't');
  r.sql("UPDATE recovery_probe SET value='changed'; REVOKE SELECT ON recovery_probe FROM legacy_reader; ALTER TABLE recovery_probe OWNER TO radar;");
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(rollback().ok, true);
    assert.equal(r.prefix(r.rows()), 13);
    assert.equal(ownership(), original);
    assert.equal(r.sql('SET ROLE legacy_reader; SELECT value FROM recovery_probe WHERE id=1;'), 'baseline');
    assert.equal(r.sql("SELECT to_regclass('public.facet_reason_codes') IS NULL;"), 't');
  }
  process.stdout.write(`Mesure synthétique DDL : ${first.durationMs} ms. Ce n’est pas une copie prod.\n`);
});
