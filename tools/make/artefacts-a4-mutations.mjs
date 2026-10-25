import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['packages/immo-mcp/src/server-http.ts', 'packages/immo-mcp/src/stateful-host.ts'];
const originals = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
const mutations = [
  { id: 'request-authority', file: files[0],
    from: 'const snapshot = captureInvocationContext({ auth, data, raw });',
    to: 'const snapshot = captureInvocationContext({ auth: { ...auth, scopes: config.scopesSupported }, data, raw });',
    suite: 'src/server-http-session.test.ts', expected: 'applies a removed scope to the next request on the same session' },
  { id: 'failed-binding-open', file: files[1],
    from: 'for (const server of this.servers) hooks.register(server);',
    to: 'for (const server of this.servers) { try { hooks.register(server); } catch {} }',
    suite: 'src/stateful-host.test.ts', expected: 'should retain closed admission after partial binding fails' },
];
function run(label, suites) {
  const output = `/evidence/${label}.json`;
  const result = spawnSync('npm', ['run', 'test', '--workspace=packages/immo-mcp', '--', ...suites,
    '--maxWorkers=1', '--reporter=json', `--outputFile=${output}`], { encoding: 'utf8', timeout: 120000 });
  writeFileSync(`/evidence/${label}.log`, result.stdout + result.stderr);
  assert.equal(result.signal, null, `${label}: abnormal termination`);
  const report = JSON.parse(readFileSync(output));
  const failed = report.testResults.flatMap((s) => s.assertionResults).filter((t) => t.status === 'failed');
  return { status: result.status, report, failed };
}
const restore = () => { for (const [file, original] of originals) writeFileSync(file, original); };
const suites = mutations.map((m) => m.suite);
try {
  assert.equal(run('baseline-before', suites).status, 0);
  for (const mutant of mutations) {
    restore();
    const original = originals.get(mutant.file);
    assert.equal(original.split(mutant.from).length, 2, `${mutant.id}: mutation site drift`);
    writeFileSync(mutant.file, original.replace(mutant.from, mutant.to));
    const result = run(mutant.id, [mutant.suite]);
    assert.notEqual(result.status, 0, `${mutant.id}: survived`);
    assert.ok(result.failed.some((t) => t.title === mutant.expected), `${mutant.id}: missing discriminating failure`);
    console.log(`KILLED ${mutant.id}: ${mutant.expected}`);
  }
} finally { restore(); }
assert.equal(run('baseline-after', suites).status, 0);
console.log('PASS: two semantic mutants killed; restored controls passed');
