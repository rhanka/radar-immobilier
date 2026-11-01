import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './cutover-fixture.mjs';

for (const [source, operation, getFail, diagnostic] of [
  ['prepared-smoke', 'if prepared_stack_present; then echo present; else echo absent; fi', 'deployment/radar-api-prepared', 'Prepared slot state unknown'],
  ['switch', 'back_to_main_routing', 'service/radar-api', 'routing unknown'],
]) {
  test(`unknown reads refuse ${operation} even inside a conditional cleanup`, () => {
    const f = fixture({ getFail });
    try {
      const result = spawnSync('bash', ['-c', `
        set -o pipefail
        fail() { echo "$*" >&2; exit 1; }
        unknown_state() { fail "$*"; }
        source tools/make/cutover-${source}.sh
        PREPARED_NAMES=(radar-api radar-immo-mcp radar-ui)
        SLOT_SERVICES=(radar-api radar-immo-mcp radar-ui)
        SLOT_LABEL=sentropic.io/slot
        k=(kubectl); WORK="$1"
        (set -e; ${operation}) || exit 1
      `, 'test', f.dir], { env: f.env, encoding: 'utf8' });
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stderr, new RegExp(diagnostic));
    } finally { f.cleanup(); }
  });
}
test('an unreadable orphaned Deployment keeps adoption locked instead of recreating it', () => {
  const f = fixture({ unadopted: true, getFailAfterOrphan: 'deployment/radar-api' });
  try {
    const result = f.run('slots-adopt');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Deployment state unknown/);
    assert.ok(f.state().objects.some(o => o.metadata.name === 'radar-change-lock'));
    assert.equal((f.state().created || []).some(o => o.name === 'radar-api'), false);
  } finally { f.cleanup(); }
});
test('unknown Pod phases remain possible writers until termination is proven', () => {
  const f = fixture();
  try {
    const s = f.state();
    for (const phase of ['Unknown', 'Running', 'Pending', 'Succeeded', 'Failed']) s.objects.push({ kind: 'Pod',
      metadata: { name: phase, uid: phase, labels: { 'sentropic.io/slot': 'prepared', 'app.kubernetes.io/component': 'api' } }, status: { phase } });
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(s));
    const result = spawnSync('bash', ['-ec', 'source tools/make/cutover-switch.sh; k=(kubectl); SLOT_LABEL=sentropic.io/slot; slot_pods prepared'], { env: f.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).map(p => p.uid), ['Unknown', 'Running', 'Pending']);
  } finally { f.cleanup(); }
});
