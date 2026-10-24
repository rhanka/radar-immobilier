// B4 mutation execution is restricted to the runner's disposable container copy.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import mutations from './base-api-b4-mutants.mjs';
assert.equal(process.env.LOT_MIGRATION_DB_TEST, '1');
assert.equal(process.argv[2], 'required');
const admin = new pg.Client({ host: process.env.POSTGRES_HOST, user: 'radar', password: 'synthetic-only', database: 'radar' });
await admin.connect();
try {
  // Same mutation-only WAL bound as B3; the 512-MiB tmpfs is unchanged.
  await admin.query("ALTER SYSTEM SET max_wal_size = '64MB'");
  await admin.query("ALTER SYSTEM SET min_wal_size = '32MB'");
  await admin.query('SELECT pg_reload_conf()');
  let sizes;
  for (let attempt = 0; attempt < 100; attempt++) {
    sizes = (await admin.query("SELECT current_setting('max_wal_size') AS max, current_setting('min_wal_size') AS min")).rows[0];
    if (sizes.max === '64MB' && sizes.min === '32MB') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(sizes, { max: '64MB', min: '32MB' });
} finally { await admin.end(); }
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = {};
function step(m, prefix, phase, targets = []) {
  const reportPath = prefix + '-' + phase + '.json';
  const command = ['../node_modules/.bin/vitest', 'run', '--config', 'vitest.isolated.config.ts',
    '--reporter=default', '--reporter=json', '--outputFile.json=' + reportPath, ...m.testFiles];
  const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(prefix + '-' + phase + '.log', (result.stdout ?? '') + (result.stderr ?? ''));
  writeFileSync(prefix + '-' + phase + '.command.json', JSON.stringify(command));
  writeFileSync(prefix + '-' + phase + '.exit.json', JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message }));
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const tests = report.testResults.flatMap((suite) => suite.assertionResults ?? []);
  assert.ok(tests.length > 0 && tests.every((test) => ['passed', 'failed'].includes(test.status)));
  assert.equal(report.numRuntimeErrorTestSuites ?? 0, 0);
  const names = tests.map((test) => test.fullName).sort();
  if (m.names) assert.deepEqual(names, m.names); else m.names = names;
  assert.equal(result.status, phase === 'mutant' ? 1 : 0);
  if (phase !== 'mutant') assert.ok(report.success && tests.every((test) => test.status === 'passed'));
  for (const target of targets) {
    const failed = tests.find((test) => test.fullName === target);
    assert.equal(failed?.status, 'failed');
    assert.ok(failed.failureMessages.some((message) => message.includes('AssertionError')), target);
  }
  return { report, tests, command, exit: result.status };
}
for (const m of mutations) {
  m.testFiles = [m.testFile];
  const prefix = '/evidence/b4-' + m.id;
  const original = readFileSync(m.source);
  const mutant = m.edits.reduce((text, [before, after]) => {
    assert.equal(text.split(before).length, 2, 'unique source anchor: ' + before);
    return text.replace(before, after);
  }, original.toString());
  assert.notEqual(mutant, original.toString());
  const baseline = step(m, prefix, 'baseline');
  const targets = baseline.tests.filter((test) => test.title === m.title).map((test) => test.fullName);
  assert.ok(targets.length > 0, 'missing behavioral target: ' + m.title);
  writeFileSync(prefix + '-original.ts', original); writeFileSync(prefix + '-mutant.ts', mutant);
  const diff = spawnSync('diff', ['-u', '--label', 'a/api/' + m.source, '--label', 'b/api/' + m.source,
    prefix + '-original.ts', prefix + '-mutant.ts'], { encoding: 'utf8' });
  assert.equal(diff.status, 1); assert.ok(diff.stdout.includes('@@'));
  writeFileSync(prefix + '.patch', diff.stdout);
  let killed;
  try { writeFileSync(m.source, mutant); killed = step(m, prefix, 'mutant', targets); }
  finally { writeFileSync(m.source, original); assert.equal(hash(readFileSync(m.source)), hash(original)); }
  const restored = step(m, prefix, 'restored');
  manifest[m.id] = { source: m.source, targets, command: killed.command,
    exits: { baseline: baseline.exit, mutant: killed.exit, restored: restored.exit }, restorationSha256: hash(original) };
  writeFileSync('/evidence/b4-mutations.json', JSON.stringify(manifest, null, 2));
  console.log('B4 MUTATION PASS ' + m.id);
}
const testFiles = [...new Set(['tests/integration/base-api-activation.spec.ts',
  'tests/integration/base-api-activation-resume.spec.ts', 'tests/integration/base-api-legacy.spec.ts',
  ...mutations.map((m) => m.testFile)])];
step({ testFiles }, '/evidence/b4-final', 'restored');
// Preserve the final real Vitest report; never synthesize an aggregate JSON.
writeFileSync('/evidence/tests.json', readFileSync('/evidence/b4-final-restored.json'));
