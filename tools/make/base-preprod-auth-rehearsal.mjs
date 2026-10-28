import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { runCdpQualification } from '../../deploy/base-preprod/cdp-probe.mjs';
import { cdpFixture } from './base-preprod-cdp-fixture.mjs';
const root = new URL('../../tmp/vehicle-evidence/rehearsal-native/', import.meta.url);
const summary = JSON.parse(readFileSync(new URL('summary.json', root), 'utf8'));
const sequence = readFileSync(new URL('sequence.txt', root), 'utf8').trim().split('\n');
assert.equal(summary.kind, 'fixture-only');
assert.equal(summary.status, 'native-reopened-awaiting-auth');
assert.deepEqual(sequence, ['preflight', 'freeze-cd', 'close', 'activate', 'start-api', 'q1', 'restart-api', 'q2', 'proof', 'native-filter', 'reopen-api']);
const cases = JSON.parse(readFileSync(new URL('../../deploy/base-preprod/public-checks.json', import.meta.url), 'utf8'));
const results = {};
for (const phase of ['q1', 'q2']) {
  const config = { origin: 'https://preprod.immo.sent-tech.ca', phase, workspaceId: summary.binding.workspaceId,
    actorSub: summary.binding.actorSub, citySlug: 'fixture-city', releaseSha: summary.binding.releaseId.split(':')[0], exposedPrefixes: summary.exposedPrefixes };
  results[phase] = await runCdpQualification(config, cases, cdpFixture(config, cases));
  assert.equal(results[phase].passed, true); assert.equal(results[phase].ownedTargetClosed, true);
  sequence.push(`${phase}-authenticated`);
}
console.log(JSON.stringify({ kind: 'fixture-only', passed: true, sequence, nativeFilter: true, ...results }));
