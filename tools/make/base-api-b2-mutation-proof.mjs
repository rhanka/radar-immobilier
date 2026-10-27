// Run one mutant in an archived, disposable source copy. Assertion failures only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mutants } from './base-api-b2-mutants.mjs';
const mutant = mutants.find(item => item.id === process.argv[2]);
assert.ok(mutant, 'Named mutation required');
assert.equal(process.cwd(), '/workspace/api', 'Disposable runner copy required');
assert.equal(process.env.LOT_MIGRATION_DB_TEST, '1');
const evidence = '/evidence/b2-mutations/' + mutant.id;
mkdirSync(evidence, { recursive: true });
const original = readFileSync(mutant.file);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const replacement = mutant.change(original.toString());
assert.notEqual(replacement, original.toString());
writeFileSync(evidence + '/control.ts', original);
writeFileSync(evidence + '/mutant.ts', replacement);
const diff = spawnSync('diff', ['-u', '--label', 'a/api/' + mutant.file, '--label', 'b/api/' + mutant.file,
  evidence + '/control.ts', evidence + '/mutant.ts'], { encoding: 'utf8' });
assert.equal(diff.status, 1);
writeFileSync(evidence + '/mutation.patch', diff.stdout);
const records = [];
function run(phase, passes) {
  const path = evidence + '/' + phase + '.json';
  const args = ['run', '--config', 'vitest.isolated.config.ts', '--reporter=json',
    '--outputFile.json=' + path, mutant.testFile, '-t', mutant.test];
  const result = spawnSync('../node_modules/.bin/vitest', args,
    { encoding: 'utf8', env: process.env, timeout: 60000 });
  writeFileSync(evidence + '/' + phase + '.log', (result.stdout ?? '') + (result.stderr ?? ''));
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, passes ? 0 : 1);
  const report = JSON.parse(readFileSync(path));
  const selected = report.testResults.flatMap(suite => suite.assertionResults ?? [])
    .filter(test => test.title === mutant.test);
  assert.equal(selected.length, 1, 'Exactly one intended test must execute');
  assert.equal(selected[0].status, passes ? 'passed' : 'failed');
  if (!passes) assert.ok(selected[0].failureMessages.some(message =>
    /AssertionError|_Assertion\.__VITEST_REJECTS__/.test(message)), 'Setup/compilation errors do not kill mutations');
  if (!passes && mutant.id === 'atomicity') assert.ok(selected[0].failureMessages.some(message =>
    /expected 1 to be \+?0/.test(message)), 'Atomicity must fail its SQL event-count assertion');
  records.push({ phase, exit: result.status, command: ['../node_modules/.bin/vitest', ...args],
    test: selected[0].fullName, status: selected[0].status,
    assertionFailures: selected[0].failureMessages });
}
try {
  run('baseline', true);
  writeFileSync(mutant.file, replacement);
  run('mutant', false);
} finally {
  writeFileSync(mutant.file, original);
  assert.equal(hash(readFileSync(mutant.file)), hash(original));
  writeFileSync(evidence + '/restoration.sha256', hash(original) + '  api/' + mutant.file + '\n');
}
run('restored', true);
writeFileSync(evidence + '/proof.json', JSON.stringify({ id: mutant.id, records,
  restorationChecksum: hash(original), mutationChecksum: hash(diff.stdout) }, null, 2));
console.log('B2 MUTATION PASS ' + mutant.id);
