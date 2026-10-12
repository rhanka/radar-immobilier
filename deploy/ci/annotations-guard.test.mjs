import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'annotations-guard-'));
const trace = join(root, 'calls');
const sha = 'a'.repeat(40);
writeFileSync(join(root, 'kubectl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TRACE"\nprintf "%s" "$RECEIPT"\n', { mode: 0o755 });
after(() => rmSync(root, { recursive: true, force: true }));
function guard(operation, receipt = '', commit = sha) {
  writeFileSync(trace, '');
  const result = spawnSync('bash', ['deploy/ci/annotations-guard.sh', operation], {
    env: { ...process.env, PATH: root + ':' + process.env.PATH, TRACE: trace,
      RECEIPT: receipt, GITHUB_SHA: commit, NAMESPACE: 'synthetic-namespace' }, encoding: 'utf8',
  });
  assert.match(readFileSync(trace, 'utf8'), /^(?:-n synthetic-namespace get configmap .*\n)?$/);
  return result;
}

test('refuses missing, closed, partial and wrong-release receipts before mutation', () => {
  for (const receipt of ['', `closed|${sha}|true|true|proof`, `canonical|${sha}|true||proof`,
    `canonical|${'b'.repeat(40)}|true|true|proof`, `canonical|${sha}|false|true|proof`]) {
    assert.notEqual(guard('deploy', receipt).status, 0);
  }
  assert.notEqual(guard('deploy', `canonical|${sha}|true|true|proof`, 'short').status, 0);
});
test('accepts only the qualified canonical operation receipt for the exact release', () => {
  assert.equal(guard('deploy', `canonical|${sha}|true|true|synthetic-evidence`).status, 0);
});
test('suspends restore and image rollback while permitting read-only backup listing', () => {
  for (const operation of ['restore', 'chain', 'rollback', 'unknown']) assert.notEqual(guard(operation).status, 0);
  assert.equal(guard('list').status, 0);
  assert.equal(readFileSync(trace, 'utf8'), '');
});
test('guards every release path, restore and automatic/manual rollback before mutation', () => {
  const build = readFileSync('.github/workflows/build-push-images.yml', 'utf8');
  const gates = [...build.matchAll(/run: bash deploy\/ci\/annotations-guard\.sh deploy/g)].map((m) => m.index);
  assert.equal(gates.length, 3);
  for (const gate of gates) {
    const next = build.slice(gate);
    assert.ok(next.indexOf('Create GitHub deployment') < next.indexOf('run: bash deploy/ci/run-db-backup.sh'));
  }
  const restore = readFileSync('.github/workflows/bascule-preprod.yml', 'utf8');
  assert.ok(restore.indexOf('annotations-guard.sh "$MODE"') < restore.indexOf('- name: Compute CONFIRM_EXPECTED'));
  const rollback = readFileSync('deploy/ci/rollback-release.sh', 'utf8');
  assert.ok(rollback.indexOf('/annotations-guard.sh" rollback') < rollback.indexOf('for d in $DEPLOYMENTS'));
  assert.match(readFileSync('.github/workflows/rollback.yml', 'utf8'), /bash deploy\/ci\/rollback-release\.sh/);
});
