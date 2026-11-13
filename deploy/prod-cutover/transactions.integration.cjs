const { test } = require('node:test');
const assert = require('node:assert/strict');
const r = require('./runtime.cjs');
const { migrate } = require('./migrate.cjs');
test('31 migrations natives, reprise sans DDL et annulation réelle sur erreur', () => {
  const entries = r.journal();
  r.sql('CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);');
  for (const e of entries.slice(0, 13)) {
    r.sql(`BEGIN; ${r.fs.readFileSync(e.file, 'utf8').replaceAll('--> statement-breakpoint', '')}
      INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('${e.hash}',${e.when}); COMMIT;`);
  }
  r.save('restore', { sha256: 'synthetic-test-only' });
  const proof = r.path.join(r.output(), 'evidence.json');
  r.fs.writeFileSync(proof, JSON.stringify({ run: r.crypto.randomUUID(), release: r.SHA,
    instances: ['synthetic-integration-bootstrap-terminated'], completedAt: new Date().toISOString() }));
  process.env.EVIDENCE = proof;
  const first = migrate();
  assert.equal(first.applied.length, 31);
  assert.equal(migrate().applied.length, 0);
  assert.equal(r.prefix(r.rows()), 44);
  assert.throws(() => r.sql('BEGIN; CREATE TABLE cutover_rollback_probe(id int); SELECT * FROM cutover_missing_table; COMMIT;'));
  assert.equal(r.sql("SELECT to_regclass('public.cutover_rollback_probe') IS NULL;"), 't');
  process.stdout.write(`Mesure synthétique DDL : ${first.durationMs} ms. Ce n’est pas une copie prod.\n`);
});
