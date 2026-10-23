#!/usr/bin/env bash
# Mutations affect only the disposable container's source copy.
set -euo pipefail
[[ ${LOT_MIGRATION_DB_TEST:-} == 1 ]] || exit 2
node --input-type=module - "$1" <<'JS'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const kind = process.argv[2];
const cases = {
  legacy: {
    source: 'src/services/facets/legacy-retirement.ts',
    scope: 'tests/integration/base-api-legacy.spec.ts',
    targets: ['serves cutover-closed through createApp with verified browser cookies',
      'serves retired through createApp with verified browser cookies'],
    failure: /expected 404 to be (503|410)/,
    mutate: s => s.replace('return 503;', 'return 404 as 503;')
      .replace('return 410;', 'return 404 as 410;'),
  },
  archive: {
    source: 'src/services/facets/workspace-reader.ts',
    scope: 'tests/integration/base-api-reveal-restore.spec.ts',
    targets: ['keeps common hiding when the personal archive restores'],
    failure: /expected false to be true/,
    mutate: s => s.replace('return personal?.state === "active" || workspace?.state === "active";',
      'return personal?.state === "inactive" ? false : personal?.state === "active" || workspace?.state === "active";'),
  },
};
const entry = cases[kind];
assert.ok(entry, 'An explicit supported mutation is required');
const original = readFileSync(entry.source);
const hash = b => createHash('sha256').update(b).digest('hex');
const prefix = `/evidence/b1-${kind}`;
const records = [];
let names;
function run(phase, passing) {
  const output = `${prefix}-${phase}.json`;
  const result = spawnSync('../node_modules/.bin/vitest', ['run', '--config', 'vitest.isolated.config.ts',
    '--reporter=default', '--reporter=json', `--outputFile.json=${output}`, entry.scope],
  { stdio: 'inherit', env: process.env });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  const report = JSON.parse(readFileSync(output));
  const tests = report.testResults.flatMap(s => s.assertionResults ?? []);
  assert.ok(tests.length > 0 && tests.every(t => ['passed', 'failed'].includes(t.status)));
  const currentNames = tests.map(t => t.fullName).sort();
  if (names) assert.deepEqual(currentNames, names); else names = currentNames;
  assert.equal(result.status, passing ? 0 : 1);
  if (passing) assert.ok(report.success && tests.every(t => t.status === 'passed'));
  for (const name of entry.targets) {
    const test = tests.find(t => t.title === name);
    assert.ok(test, `Missing required case: ${name}`);
    assert.equal(test.status, passing ? 'passed' : 'failed');
    if (!passing) assert.ok(test.failureMessages.some(m =>
      m.includes('AssertionError') && entry.failure.test(m)));
  }
  records.push({ phase, exit: result.status, tests: tests.length,
    failed: tests.filter(t => t.status === 'failed').map(t => t.fullName) });
  console.log(`B1 ${kind} ${phase}: exit=${result.status}, tests=${tests.length}`);
}
try {
  run('baseline', true);
  const mutant = entry.mutate(original.toString());
  assert.notEqual(mutant, original.toString(), 'Mutation did not match source');
  writeFileSync(`${prefix}-control.ts`, original);
  writeFileSync(`${prefix}-mutant.ts`, mutant);
  writeFileSync(entry.source, mutant);
  run('mutant', false);
  writeFileSync(entry.source, original);
  assert.equal(hash(readFileSync(entry.source)), hash(original));
  run('restored', true);
  writeFileSync('/evidence/tests.json', readFileSync(`${prefix}-restored.json`));
  writeFileSync(`${prefix}-receipt.json`, JSON.stringify({ kind, source: entry.source,
    scope: entry.scope, targets: entry.targets, restorationSha256: hash(original), records }, null, 2));
  console.log(`B1 ${kind} restoration sha256=${hash(original)}`);
} finally {
  writeFileSync(entry.source, original);
  assert.equal(hash(readFileSync(entry.source)), hash(original));
}
JS
