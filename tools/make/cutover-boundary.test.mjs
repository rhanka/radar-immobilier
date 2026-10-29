import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './cutover-fixture.mjs';

test('Kubernetes boundary should emit complete JSON beyond the stdout pipe capacity', () => {
  const f = fixture();
  try {
    const state = f.state();
    const message = 'x'.repeat(256 * 1024);
    state.objects.push({ kind: 'Pod', metadata: { name: 'large-response' }, status: { message } });
    writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
    const result = spawnSync('kubectl', ['get', 'pods', '-o', 'json'], { env: f.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout);
    assert.equal(response.items.find(o => o.metadata.name === 'large-response').status.message, message);
  } finally { f.cleanup(); }
});
