// Validate behavioral receipts after the packet's bounded disposable runner.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const packet = process.argv[2];
const required = {
  b3: ['ogc-serialization', 'populate-serialization', 'projection-serialization',
    'ogc-stored-identity', 'populate-update', 'populate-insert', 'populate-old-identity',
    'transaction-boundary', 'multi-target-order', 'content-fingerprint'],
  b4: ['drain', 'shutdown', 'workspace-binding', 'attempt-binding', 'release-binding',
    'readback-noop', 'open-order', 'public-readback', 'resume-authority',
    'protected-resume', 'restart-default', 'writer-coverage'],
}[packet];
assert.ok(required, 'Unknown required mutation packet');
const manifest = JSON.parse(readFileSync(`/evidence/${packet}-mutations.json`, 'utf8'));
assert.deepEqual(Object.keys(manifest).sort(), [...required].sort());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const id of required) {
  const entry = manifest[id];
  assert.ok(Array.isArray(entry.command) && entry.command.length > 2 && entry.command.every(v => typeof v === 'string'));
  assert.ok(typeof entry.source === 'string' && entry.source.startsWith('src/') && !entry.source.includes('..'));
  assert.ok(Array.isArray(entry.targets) && entry.targets.length > 0);
  const prefix = `/evidence/${packet}-${id}`;
  const original = readFileSync(`${prefix}-original.ts`);
  const mutant = readFileSync(`${prefix}-mutant.ts`);
  assert.notEqual(hash(original), hash(mutant));
  assert.equal(hash(readFileSync(entry.source)), hash(original));
  assert.equal(entry.restorationSha256, hash(original));
  assert.ok(readFileSync(`${prefix}.patch`, 'utf8').includes('@@'));
  let names;
  for (const [phase, exit] of [['baseline', 0], ['mutant', 1], ['restored', 0]]) {
    assert.equal(entry.exits[phase], exit);
    const report = JSON.parse(readFileSync(`${prefix}-${phase}.json`, 'utf8'));
    const tests = report.testResults.flatMap(suite => suite.assertionResults ?? []);
    assert.ok(tests.length > 0 && tests.every(test => ['passed', 'failed'].includes(test.status)));
    const current = tests.map(test => test.fullName).sort();
    if (names) assert.deepEqual(current, names); else names = current;
    if (!exit) assert.ok(report.success && tests.every(test => test.status === 'passed'));
    else for (const target of entry.targets) {
      const test = tests.find(test => test.fullName === target);
      assert.equal(test?.status, 'failed');
      assert.ok(test.failureMessages.some(message => message.includes('AssertionError')));
    }
  }
  console.log(`PASS required behavioral mutation receipt: ${packet}/${id}`);
}
