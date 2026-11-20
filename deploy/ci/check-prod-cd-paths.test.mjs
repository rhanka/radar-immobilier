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

test('repo prod manifests all have declared CD, operatorPaths, or documented legacyExempt entries', () => {
  const res = validateProdCdPaths(ROOT);
  assert.equal(res.ok, true, res.errors.join('\n'));
  assert.ok(res.counts.cd >= 40);
  assert.ok(res.counts.operator >= 1);
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

test('validates operatorPaths entries (entrypoint, entrypointRef, doc, objects, reason)', (t) => {
  const dir = mkFixture(t);
  fs.writeFileSync(path.join(dir, 'deploy/k8s/op.yaml'), 'kind: Job\n');
  fs.writeFileSync(path.join(dir, 'deploy/ci/op.mk'), 'run-op-prod:\n\t@echo ok\n');
  const regFile = path.join(dir, 'deploy/ci/prod-cd-paths.json');
  const reg = JSON.parse(fs.readFileSync(regFile, 'utf8'));
  reg.operatorPaths = [
    {
      path: 'deploy/k8s/op.yaml',
      objects: ['Job/op'],
      entrypoint: 'deploy/ci/op.mk',
      entrypointRef: 'run-op-prod',
      doc: 'docs/note.md',
      reason: 'OAuth credentials stay outside CD',
    },
  ];
  fs.writeFileSync(regFile, JSON.stringify(reg));
  const okRes = validateProdCdPaths(dir);
  assert.equal(okRes.ok, true, okRes.errors.join('\n'));
  assert.equal(okRes.counts.operator, 1);

  reg.operatorPaths[0].entrypointRef = 'missing-target';
  fs.writeFileSync(regFile, JSON.stringify(reg));
  const badRef = validateProdCdPaths(dir);
  assert.equal(badRef.ok, false);
  assert.match(badRef.errors[0], /entrypointRef 'missing-target' not found/);

  reg.operatorPaths[0].entrypointRef = 'run-op-prod';
  reg.operatorPaths[0].entrypoint = 'deploy/ci/missing.mk';
  fs.writeFileSync(regFile, JSON.stringify(reg));
  const badEp = validateProdCdPaths(dir);
  assert.equal(badEp.ok, false);
  assert.match(badEp.errors[0], /references missing entrypoint/);

  reg.operatorPaths[0].entrypoint = 'deploy/ci/op.mk';
  reg.operatorPaths[0].doc = 'docs/missing.md';
  fs.writeFileSync(regFile, JSON.stringify(reg));
  const badDoc = validateProdCdPaths(dir);
  assert.equal(badDoc.ok, false);
  assert.match(badDoc.errors[0], /references missing doc/);

  reg.operatorPaths[0].doc = 'docs/note.md';
  reg.operatorPaths[0].reason = '   ';
  reg.operatorPaths[0].objects = [];
  fs.writeFileSync(regFile, JSON.stringify(reg));
  const badMeta = validateProdCdPaths(dir);
  assert.equal(badMeta.ok, false);
  assert.ok(badMeta.errors.some((e) => /must list target Kubernetes objects/.test(e)));
  assert.ok(badMeta.errors.some((e) => /requires a reason/.test(e)));
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

test('platform-owned VAP radar-ci-trigger-suspend-only is absent from tenant CD apply and ClusterRole RBAC', () => {
  const vapRel = 'deploy/ci/bascule-preprod/vap-ci-trigger-suspend-only.yaml';
  assert.equal(fs.existsSync(path.join(ROOT, vapRel)), false, 'tenant VAP manifest removed');
  const regRaw = fs.readFileSync(path.join(ROOT, 'deploy/ci/prod-cd-paths.json'), 'utf8');
  assert.equal(regRaw.includes('vap-ci-trigger-suspend-only'), false, 'no tenant VAP entry in prod-cd-paths.json');

  const rbac = fs.readFileSync(path.join(ROOT, 'deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml'), 'utf8');
  const activeRbac = rbac.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.equal(/^kind:\s*ClusterRole(Binding)?\b/m.test(activeRbac), false, 'no ClusterRole or ClusterRoleBinding in rbac-ci-bascule-prod.yaml');
  assert.equal(activeRbac.includes('admissionregistration.k8s.io'), false, 'zero admissionregistration.k8s.io RBAC rules');
  assert.equal(activeRbac.includes('radar-ci-bascule-prod-vap'), false, 'no radar-ci-bascule-prod-vap object');

  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/bascule-bundle-cd.yml'), 'utf8');
  assert.equal(wf.includes('vap-ci-trigger-suspend-only.yaml'), false, 'workflow does not apply tenant VAP file');
  assert.ok(wf.includes('platform/78-radar-immobilier-ci-guards.yaml') && wf.includes('25a4a34'), 'workflow cites platform VAP ownership');
  assert.ok(wf.includes('--dry-run=server') && wf.includes('radar-ci-trigger-suspend-only\\|jobTemplate') && wf.includes('{"spec":{"suspend":false}}'),
    'anti-RCE dry-run gate preserved');
});
