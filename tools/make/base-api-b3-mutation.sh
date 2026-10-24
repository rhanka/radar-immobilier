#!/usr/bin/env bash
# B3 discriminating source-writer mutations on the disposable container copy.
set -euo pipefail
[[ ${LOT_MIGRATION_DB_TEST:-} == 1 ]] || exit 2
node --input-type=module - "$1" <<'JS'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const requested = process.argv[2];
const once = (s, b, a) => { assert.equal(s.split(b).length, 2, 'anchor once: ' + b); return s.replace(b, a); };
const M = (id, file, testFile, title, before, after) => ({ id, file, testFile, title, before, after });
const ogcLock = 'await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [\n        lotSourceLockKey(target.citySlug, target.canonicalId),\n      ]);';
const populateLock = 'await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${\n        lotSourceLockKey(target.citySlug, target.canonicalId)}, 0))`);';
const projectionLock = 'await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${\n      lotSourceLockKey(input.citySlug, input.canonicalId)}, 0))`);';
const mutants = [
  M('ogc-serialization', 'src/services/geo/ogc-pull.ts', 'src/services/geo/ogc-pull-source-lock-db.test.ts', 'should contend on the stored mismatched identity through mutation', ogcLock, 'void target;'),
  M('populate-serialization', 'src/services/geo/populate-geo.ts', 'src/services/geo/populate-geo-source-lock-db.test.ts', 'should serialize update through its mutation transaction', populateLock, 'void target;'),
  M('projection-serialization', 'src/services/exploitation/projection.ts', 'src/services/exploitation/projection-source-lock-db.test.ts', 'should block on the held canonical lock and retain it through commit', projectionLock, 'void input;'),
  M('ogc-stored-identity', 'src/services/geo/ogc-pull.ts', 'src/services/geo/ogc-pull-source-lock-db.test.ts', 'should contend on the stored mismatched identity through mutation', 'lotSourceLockKey(target.citySlug, target.canonicalId),', 'lotSourceLockKey(target.citySlug, pending.find((p) => p.lockCitySlug === target.citySlug && p.lockCanonicalId === target.canonicalId)!.decision.canonicalId),'),
  M('populate-update', 'src/services/geo/populate-geo.ts', 'src/services/geo/populate-geo-source-lock-db.test.ts', 'should serialize update through its mutation transaction', populateLock, 'if (!preLockRow) ' + populateLock),
  M('populate-insert', 'src/services/geo/populate-geo.ts', 'src/services/geo/populate-geo-source-lock-db.test.ts', 'should serialize insert through its mutation transaction', populateLock, 'if (preLockRow) ' + populateLock),
  M('populate-old-identity', 'src/services/geo/populate-geo.ts', 'src/services/geo/populate-geo-source-lock-db.test.ts', 'should serialize city change against stored identity through its mutation transaction', '[{ citySlug: preLockRow.city_slug, canonicalId: preLockRow.canonical_id }, { citySlug, canonicalId }]', '[{ citySlug, canonicalId }]'),
  M('transaction-boundary', 'src/services/geo/ogc-pull.ts', 'src/services/geo/ogc-pull-source-lock-db.test.ts', 'should contend on the stored mismatched identity through mutation', '// Phase 2 — revalidate under the lock, then mutate.', 'await client.query("COMMIT"); await client.query("BEGIN");\n    // Phase 2 — revalidate under the lock, then mutate.'),
  M('multi-target-order', 'src/services/geo/ogc-pull.ts', 'src/services/facets/lots/lot-source-writer-races-db.test.ts', 'should serialize source-first with 2 targets in canonical lock order', '.sort(compareOgcLotLockTarget)', '.sort((a, b) => -compareOgcLotLockTarget(a, b))'),
  M('content-fingerprint', 'src/services/facets/lots/lot-writer.ts', 'src/services/facets/lots/lot-source-writer-races-db.test.ts', 'should serialize source-first with 1 targets in canonical lock order', '\n      || resolved.fingerprint !== command.displayed_version.fingerprint', ''),
];
const selected = requested === 'required' ? mutants : mutants.filter((m) => m.id === requested);
assert.ok(selected.length > 0, 'named B3 mutation required');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const manifest = {};
const restoredSuites = new Map();
function step(m, prefix, phase, passing, targets) {
  const output = prefix + '-' + phase + '.json';
  const args = ['run', '--config', 'vitest.isolated.config.ts', '--reporter=default', '--reporter=json', '--outputFile.json=' + output, m.testFile];
  (m.commands ??= {})[phase] = ['../node_modules/.bin/vitest', ...args];
  const r = spawnSync('../node_modules/.bin/vitest', args, { stdio: 'inherit', env: process.env });
  assert.equal(r.error, undefined);
  assert.equal(r.signal, null);
  const rep = JSON.parse(readFileSync(output));
  const tests = rep.testResults.flatMap((s) => s.assertionResults ?? []);
  assert.ok(tests.length > 0 && tests.every((t) => t.status === 'passed' || t.status === 'failed'));
  const cur = tests.map((t) => t.fullName).sort();
  if (m.names) assert.deepEqual(cur, m.names); else m.names = cur;
  assert.equal(r.status, passing ? 0 : 1);
  if (passing) assert.ok(rep.success && tests.every((t) => t.status === 'passed'));
  else for (const t of targets) {
    const hit = tests.find((x) => x.fullName === t);
    assert.equal(hit?.status, 'failed');
    assert.ok(hit.failureMessages.some((msg) => msg.includes('AssertionError')));
  }
  return { rep, status: r.status };
}
for (const m of selected) {
  const prefix = '/evidence/b3-' + m.id;
  const original = readFileSync(m.file);
  const mutant = once(original.toString(), m.before, m.after);
  assert.notEqual(mutant, original.toString(), 'mutation must change source');
  const exits = {};
  const base = step(m, prefix, 'baseline', true, []).rep;
  const found = base.testResults.flatMap((s) => s.assertionResults ?? []).filter((t) => t.title === m.title);
  assert.ok(found.length > 0, 'missing target case: ' + m.title);
  const targets = found.map((t) => t.fullName);
  writeFileSync(prefix + '-original.ts', original);
  writeFileSync(prefix + '-mutant.ts', mutant);
  const diff = spawnSync('diff', ['-u', '--label', 'a/api/' + m.file, '--label', 'b/api/' + m.file, prefix + '-original.ts', prefix + '-mutant.ts'], { encoding: 'utf8' });
  assert.equal(diff.status, 1);
  assert.ok(diff.stdout.includes('@@'));
  writeFileSync(prefix + '.patch', diff.stdout);
  try {
    writeFileSync(m.file, mutant);
    exits.mutant = step(m, prefix, 'mutant', false, targets).status;
  } finally {
    writeFileSync(m.file, original);
    assert.equal(hash(readFileSync(m.file)), hash(original));
  }
  exits.baseline = 0;
  exits.restored = step(m, prefix, 'restored', true, []).status;
  const restored = JSON.parse(readFileSync(prefix + '-restored.json'));
  for (const s of restored.testResults) restoredSuites.set(s.name, s);
  manifest[m.id] = { command: m.commands.mutant, commands: m.commands, source: m.file, targets, exits, restorationSha256: hash(original) };
  console.log('B3 MUTATION PASS ' + m.id);
}
for (const s of step({ testFile: 'src/services/facets/lots/lot-source-writer-coverage-db.test.ts' }, '/evidence/b3-coverage', 'restored', true, []).rep.testResults) restoredSuites.set(s.name, s);
writeFileSync('/evidence/b3-mutations.json', JSON.stringify(manifest, null, 2));
writeFileSync('/evidence/tests.json', JSON.stringify({ success: true, testResults: [...restoredSuites.values()] }));
JS
