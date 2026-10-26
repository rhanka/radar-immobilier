import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const mcp = 'tests/integration/artifacts-astra-a5-mcp-admission.spec.ts';
const tx = 'tests/integration/artifacts-astra-a5-finalization.spec.ts';
const pool = 'tests/integration/artifacts-astra-a5-pool-guard.spec.ts';
const http = 'tests/integration/artifacts-astra-a5-http-admission.spec.ts';
const host = 'packages/artifacts-host/src/';
const mutations = [
  { id: 'http-membership-omitted', file: 'api/src/artifacts/control-route.ts',
    from: 'createArtifactAdmissionAuthority(\n        deps.accounts',
    to: 'createAdmissionAuthority(\n        deps.accounts', setup: 'http-legacy-authority', suite: http,
    expected: 'should resolve membership at HTTP entry before dispatching reads' },
  { id: 'mcp-read-bypass', file: 'packages/immo-mcp/src/registry/artifact-provider.ts',
    from: 'if (admission) {', to: 'if (admission && tool !== "artifacts_list" && tool !== "artifacts_get") {',
    suite: mcp, expected: 'should allow reads then reject all tools after activation expires on the same binding' },
  { id: 'mcp-admission-unwired', file: 'packages/immo-mcp/src/artifact-binding.ts',
    from: '      admission,', to: '', suite: mcp,
    expected: 'should reject all tools after removal from the cohort on the same binding' },
  { id: 'mcp-activation-cached', file: 'packages/immo-mcp/src/artifact-binding.ts',
    from: 'const readActivation = () => resolveActivationConfig(readActivationEnv(env));',
    to: 'const cached = resolveActivationConfig(readActivationEnv(env)); const readActivation = () => cached;',
    suite: mcp, expected: 'should allow reads then reject all tools after activation expires on the same binding' },
  { id: 'entry-membership-omitted', file: `${host}admission.ts`,
    from: 'if (authority.readMemberships) {', to: 'if (false && authority.readMemberships) {',
    suite: mcp, expected: 'should reject absent membership on the production binding' },
  { id: 'transaction-membership-omitted', file: `${host}commit-policy.ts`,
    from: 'const unique = [...new Set(memberships.rows.map((row) => String(row.workspace_id).toLowerCase()))];',
    to: 'const unique = ["forced"];', suite: tx,
    expected: 'should roll back publication, receipt and quota when membership is revoked during upload' },
  { id: 'membership-unlocked', file: `${host}commit-policy.ts`,
    from: "AND status = 'active' AND revoked_at IS NULL FOR SHARE",
    to: "AND status = 'active' AND revoked_at IS NULL", suite: tx,
    expected: 'should hold membership authority until the transaction commits' },
  { id: 'typed-denial-lost', file: `${host}commit-policy.ts`,
    from: 'if (typeof participant.checkApproval === "function") {',
    to: 'if (false && typeof participant.checkApproval === "function") {', suite: tx,
    expected: 'should reject missing and ambiguous membership in the coordinator without entry admission' },
  { id: 'http-second-connection', file: `${host}facade.ts`,
    from: 'if (participant && typeof participant.checkApproval === "function") {',
    to: 'if (false && participant && typeof participant.checkApproval === "function") {', suite: pool,
    expected: 'should complete an authorized write on a single-connection pool' },
  { id: 'dispatch-timeout-unmapped', file: `${host}commit-domain.ts`,
    from: 'const normalized = normalizePoolAcquisitionError(cause);', to: 'const normalized = cause;', suite: pool,
    expected: 'should map actual pool saturation through the host dispatch and mapper' },
  { id: 'outcome-timeout-unmapped', file: `${host}host-outcome.ts`,
    from: 'if (realPoolTimeout) {', to: 'if (false && realPoolTimeout) {', suite: pool,
    expected: 'should map actual pool saturation through the host dispatch and mapper' },
  { id: 'lock-acquisition-untyped', file: `${host}idempotency.ts`,
    from: 'if (isPoolAcquisitionTimeout(error)) throw normalizePoolAcquisitionError(error);',
    to: 'if (false && isPoolAcquisitionTimeout(error)) throw normalizePoolAcquisitionError(error);', suite: pool,
    expected: 'should map actual pool saturation through the host dispatch and mapper' },
];
const originals = new Map(mutations.map(({ file }) => [file, readFileSync(file, 'utf8')]));
const restore = () => { for (const [file, bytes] of originals) writeFileSync(file, bytes); };
function run(id, suites) {
  const output = `/evidence/astra-${id}.json`;
  const result = spawnSync('npm', ['run', 'test', '--workspace=api', '--', ...suites,
    '--maxWorkers=1', '--reporter=json', `--outputFile=${output}`], { encoding: 'utf8', timeout: 120000 });
  writeFileSync(`/evidence/astra-${id}.log`, (result.stdout ?? '') + (result.stderr ?? ''));
  assert.equal(result.signal, null, `${id}: abnormal termination`);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  const failed = report.testResults.flatMap((s) => s.assertionResults).filter((t) => t.status === 'failed');
  return { status: result.status, report, failed };
}
const receipts = [];
try {
  assert.equal(run('baseline-before', [mcp, tx, pool, http]).status, 0);
  for (const mutant of mutations) {
    restore();
    const original = originals.get(mutant.file);
    assert.equal(original.split(mutant.from).length, 2, `${mutant.id}: mutation site drift`);
    const changed = original.replace(mutant.from, mutant.to);
    writeFileSync(mutant.file, mutant.setup ? changed.replace('  checkAdmission,', '  checkAdmission,\n  createAdmissionAuthority,') : changed);
    const result = run(mutant.id, [mutant.suite]);
    assert.notEqual(result.status, 0, `${mutant.id}: survived`);
    assert.ok(result.failed.some((t) => t.title === mutant.expected), `${mutant.id}: missing discriminating failure`);
    receipts.push({ id: mutant.id, killed: true, assertion: mutant.expected,
      failures: result.failed.map((t) => t.title) });
    console.log(`KILLED ${mutant.id}: ${mutant.expected}`);
  }
} finally { restore(); }
assert.equal(run('baseline-after', [mcp, tx, pool, http]).status, 0);
writeFileSync('/evidence/astra-mutations.json', JSON.stringify({ passed: true, receipts, restored: true }, null, 2));
console.log(`PASS: ${receipts.length} semantic mutants killed; restored PostgreSQL controls passed`);
