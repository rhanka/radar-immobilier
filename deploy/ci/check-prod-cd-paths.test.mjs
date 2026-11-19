#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { validateProdCdPaths } from './check-prod-cd-paths.mjs';

const ROOT = path.resolve(process.cwd());

function mkFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-cd-paths-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'deploy/ci'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'deploy/k8s'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'deploy/overlays/preprod'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github/workflows/cd.yml'), 'run: kubectl apply -f deploy/k8s/app.yaml\n');
  fs.writeFileSync(path.join(dir, 'deploy/k8s/app.yaml'), 'kind: Deployment\n');
  fs.writeFileSync(path.join(dir, 'docs/note.md'), '# Note\n');
  fs.writeFileSync(
    path.join(dir, 'deploy/ci/prod-cd-paths.json'),
    JSON.stringify({
      version: 1,
      nonProdFiles: [],
      preprodPrefixes: ['deploy/overlays/preprod/'],
      preprodFiles: [],
      cdPaths: [
        {
          path: 'deploy/k8s/app.yaml',
          objects: ['Deployment/app'],
          workflow: '.github/workflows/cd.yml',
          workflowRef: 'deploy/k8s/app.yaml',
        },
      ],
      legacyExempt: [],
    }),
  );
  return dir;
}

test('repo prod manifests all have declared CD or documented legacyExempt entries', () => {
  const res = validateProdCdPaths(ROOT);
  assert.equal(res.ok, true, res.errors.join('\n'));
  assert.ok(res.counts.cd >= 40);
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy/ci/prod-cd-paths.json'), 'utf8'));
  assert.equal(reg.legacyExempt.length, 24, 'legacyExempt list stays frozen unless reviewed');
});

test('refuses an undeclared prod manifest under deploy/', (t) => {
  const dir = mkFixture(t);
  fs.writeFileSync(path.join(dir, 'deploy/k8s/99-manual.yaml'), 'kind: CronJob\n');
  const res = validateProdCdPaths(dir);
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /Undeclared production manifest 'deploy\/k8s\/99-manual\.yaml'/);
});

test('refuses missing workflow or unmatched workflowRef in cdPaths', (t) => {
  const dir = mkFixture(t);
  const regFile = path.join(dir, 'deploy/ci/prod-cd-paths.json');
  const reg = JSON.parse(fs.readFileSync(regFile, 'utf8'));
  reg.cdPaths[0].workflowRef = 'nonexistent-ref';
  fs.writeFileSync(regFile, JSON.stringify(reg));
  const res1 = validateProdCdPaths(dir);
  assert.equal(res1.ok, false);
  assert.match(res1.errors[0], /workflowRef 'nonexistent-ref' not found/);

  reg.cdPaths[0].workflow = '.github/workflows/missing.yml';
  fs.writeFileSync(regFile, JSON.stringify(reg));
  const res2 = validateProdCdPaths(dir);
  assert.equal(res2.ok, false);
  assert.match(res2.errors[0], /references missing workflow/);
});

test('allows new manifests under preprod prefix and rejects stale registry entries', (t) => {
  const dir = mkFixture(t);
  fs.writeFileSync(path.join(dir, 'deploy/overlays/preprod/patch.yaml'), 'kind: ConfigMap\n');
  assert.equal(validateProdCdPaths(dir).ok, true);

  fs.unlinkSync(path.join(dir, 'deploy/k8s/app.yaml'));
  const res = validateProdCdPaths(dir);
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /does not exist/);
});

test('runbook and governance rules document the CD-only rule', () => {
  for (const [f, needle] of [
    ['docs/runbooks/prod-promotion.md', 'No manual production apply outside CD'],
    ['rules/MASTER.md', 'Production CD Only'],
    ['rules/workflow.md', 'Production CD path rule'],
    ['AGENTS.md', 'deploy/ci/prod-cd-paths.json'],
  ]) {
    assert.ok(fs.readFileSync(path.join(ROOT, f), 'utf8').includes(needle), `${f} documents ${needle}`);
  }
});
