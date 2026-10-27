import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const mcp = 'tests/integration/artifacts-astra-a5-mcp-admission.spec.ts';
const tx = 'tests/integration/artifacts-astra-a5-finalization.spec.ts';
const pool = 'tests/integration/artifacts-astra-a5-pool-guard.spec.ts';
const http = 'tests/integration/artifacts-astra-a5-http-admission.spec.ts';
const scope = 'tests/integration/artifacts-astra-a5-scope-binding.spec.ts';
const expiry = 'tests/integration/artifacts-astra-a5-activation-expiry.spec.ts';
const connection = 'tests/integration/artifacts-astra-a5-connection-guard.spec.ts';
const host = 'packages/artifacts-host/src/';
const mutations = [
  { id: 'domain-denial-erases-host-code', file: 'node_modules/@sentropic/artifacts/dist/server/publication.js',
    from: 'return authorizeCommit(context, transaction);',
    to: 'return (await transaction.participant.checkApproval({ actorId: context.actorId, operation: context.operation })).approved ? authorizeCommit(context, transaction) : { allowed: false, reason: "denied", publicCode: "access_denied", status: 403, retriable: false };', suite: tx,
    expected: 'should roll back publication, receipt and quota when membership is revoked during upload' },
  { id: 'http-membership-omitted', file: 'api/src/artifacts/control-route.ts',
    from: 'createArtifactAdmissionAuthority(\n          deps.accounts',
    to: 'createAdmissionAuthority(\n          deps.accounts', setup: 'http-legacy-authority', suite: http,
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
    to: 'const unique = [scope.toLowerCase()];', suite: tx,
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
    from: 'commitState: "not_committed" }, mapHostError)',
    to: 'commitState: "not_committed" })', suite: pool,
    expected: 'should map actual pool saturation through the host dispatch and mapper' },
  { id: 'outcome-timeout-unmapped', file: `${host}host-outcome.ts`,
    from: ' || isPoolAcquisitionTimeout(cause)', to: '', suite: pool,
    expected: 'should map actual pool saturation through the host dispatch and mapper' },
  { id: 'lock-acquisition-untyped', file: `${host}idempotency.ts`,
    from: 'if (isPoolAcquisitionTimeout(error)) throw normalizePoolAcquisitionError(error);',
    to: 'if (false && isPoolAcquisitionTimeout(error)) throw normalizePoolAcquisitionError(error);', suite: pool,
    expected: 'should map actual pool saturation through the host dispatch and mapper' },
  { id: 'entry-foreign-membership-accepted', file: `${host}admission.ts`,
    from: 'workspaceId !== expectedScope.toLowerCase()', to: 'false', suite: scope,
    expected: 'refuses a foreign workspace on the production MCP binding' },
  { id: 'transaction-foreign-membership-accepted', file: `${host}commit-policy.ts`,
    from: 'workspaceId !== scope.toLowerCase()', to: 'false', suite: scope,
    expected: 'rejects replay after replacement without recharging quota' },
  { id: 'activation-before-membership-wait', file: `${host}commit-policy.ts`,
    from: 'const freshActivation = readActivation?.();', to: 'const freshActivation = activation;', suite: expiry,
    expected: 'rereads activation inside the transaction after the membership wait' },
  { id: 'reserved-client-event-unhandled', file: `${host}idempotency.ts`,
    from: 'client.on("error", onError);', to: '', suite: connection,
    expected: 'survives reserved-client error events and discards the dead client' },
  { id: 'opening-timeout-unrecognized', file: `${host}idempotency.ts`,
    from: '/connection terminated due to connection timeout/i.test(message);', to: 'false;',
    workspace: 'packages/artifacts-host', suite: 'src/idempotency.test.ts',
    expected: 'maps a connection-open timeout to a typed pool timeout' },
  { id: 'host-timeouts-unmapped', file: `${host}host-outcome.ts`,
    from: 'return new ArtifactOperationError("provider_unavailable", { cause });', to: 'return undefined;',
    workspace: 'packages/artifacts-host', suite: 'src/host-outcome.test.ts',
    expected: 'maps connection-open timeout to retriable 503' },
  { id: 'http-entry-outage-unmapped', file: 'api/src/artifacts/control-route.ts',
    from: '      );\n    } catch {\n      return jsonError(c, 503, { error: "capability_unavailable" });',
    to: '      );\n    } catch (error) {\n      throw error;', suite: 'src/artifacts/control-route-unavailable.test.ts',
    expected: 'maps pool saturation at entry to 503' },
];
const originals = new Map(mutations.map(({ file }) => [file, readFileSync(file, 'utf8')]));
const restore = () => { for (const [file, bytes] of originals) writeFileSync(file, bytes); };
function run(id, suites, workspace = 'api') {
  const output = `/evidence/astra-${id}.json`;
  const result = spawnSync('npm', ['run', 'test', `--workspace=${workspace}`, '--', ...suites,
    '--maxWorkers=1', '--reporter=json', `--outputFile=${output}`], { encoding: 'utf8', timeout: 120000 });
  writeFileSync(`/evidence/astra-${id}.log`, (result.stdout ?? '') + (result.stderr ?? ''));
  assert.equal(result.signal, null, `${id}: abnormal termination`);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  const failed = report.testResults.flatMap((s) => s.assertionResults).filter((t) => t.status === 'failed');
  return { status: result.status, report, failed };
}
const receipts = [];
try {
  assert.equal(run('baseline-before', [mcp, tx, pool, http, scope, expiry, connection]).status, 0);
  for (const mutant of mutations) {
    restore();
    const original = originals.get(mutant.file);
    assert.equal(original.split(mutant.from).length, 2, `${mutant.id}: mutation site drift`);
    const changed = original.replace(mutant.from, mutant.to);
    writeFileSync(mutant.file, mutant.setup ? changed.replace('  checkAdmission,', '  checkAdmission,\n  createAdmissionAuthority,') : changed);
    const result = run(mutant.id, [mutant.suite], mutant.workspace);
    assert.notEqual(result.status, 0, `${mutant.id}: survived`);
    assert.ok(result.failed.some((t) => t.title === mutant.expected), `${mutant.id}: missing discriminating failure`);
    receipts.push({ id: mutant.id, killed: true, assertion: mutant.expected,
      failures: result.failed.map((t) => t.title) });
    console.log(`KILLED ${mutant.id}: ${mutant.expected}`);
  }
} finally { restore(); }
assert.equal(run('baseline-after', [mcp, tx, pool, http, scope, expiry, connection]).status, 0);
writeFileSync('/evidence/astra-mutations.json', JSON.stringify({ passed: true, receipts, restored: true }, null, 2));
console.log(`PASS: ${receipts.length} semantic mutants killed; restored PostgreSQL controls passed`);
