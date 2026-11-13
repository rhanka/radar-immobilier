import { test } from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from '../../tools/make/cutover-fixture.mjs';
import { Buffer } from 'node:buffer';
import wiring from './prod-bindings.cjs';

for (const [publicFailure, short] of [[false, false], [true, false], [false, true]]) test(`fenêtre fermée : capture, verrou, rollout privé, GO ; échec public=${publicFailure}, SHA court=${short}`, () => {
  const f = fixture({ url: 'https://immo.sent-tech.ca' });
  const node = process.execPath;
  // Only the application DB/GO port is doubled. Kubernetes, lock, controller and HTTP
  // use the same stateful boundary as the existing operator regression suite.
  writeFileSync(join(f.dir, 'bin/node'), `#!/bin/bash
if [[ $1 == deploy/prod-cutover/cli.cjs ]]; then
  printf '%s\\n' "$2" >> "$CUTOVER_TEST_STATE/application-calls"
  exit 0
fi
exec '${node}' "$@"
`, { mode: 0o755 });
  const persist = state => writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
  const record = () => JSON.parse(f.state().objects.find(o => o.metadata.name === 'radar-change-lock').data.record);
  const run = (action, id) => spawnSync('make', ['-s', '-f', 'deploy/prod-cutover/prod-cutover.mk',
    action, `RELEASE=${f.dir}/release.json`, `PREVIOUS_RELEASE=${f.dir}/previous.json`, `CURSOR_REFERENCE=${f.dir}/cursor`, `CONFIGURATION=${f.dir}/configuration.json`, ...(id ? [`RUN=${id}`] : []), 'ENV=execution-prod'],
  { env: f.env, encoding: 'utf8', timeout: 30000 });
  const success = result => assert.equal(result.status, 0, result.stdout + result.stderr);
  try {
    const state = f.state();
    for (const binding of Object.values(wiring.bindings).flatMap(b => b.env)) {
      const ref = binding.valueFrom?.secretKeyRef;
      if (!ref) continue;
      let secret = state.objects.find(o => o.metadata.name === ref.name);
      if (!secret) { secret = { kind: 'Secret', metadata: { name: ref.name }, data: {} }; state.objects.push(secret); }
      secret.data[ref.key] ||= Buffer.from('synthetic-value').toString('base64');
    }
    const cursor = Buffer.alloc(32, 7).toString('base64');
    writeFileSync(join(f.dir, 'cursor'), cursor);
    state.objects.find(o => o.metadata.name === 'radar-classification-cursor-prod').data.CLASSIFICATION_CURSOR_SECRET = Buffer.from(cursor).toString('base64');
    writeFileSync(join(f.dir, 'previous.json'), JSON.stringify({ ...f.release, dataMigration: null }));
    if (short) state.release.apiServedSha = state.release.gitSha.slice(0, 7);
    writeFileSync(join(f.dir, 'bin/gh'), '#!/bin/sh\nprintf \'[{"workflow_runs":[]}]\\n\'\n', { mode: 0o755 });
    const ingress = state.objects.find(o => o.kind === 'Ingress');
    ingress.spec.rules[0].host = 'immo.sent-tech.ca';
    ingress.spec.tls[0].hosts = ['immo.sent-tech.ca'];
    const planMap = state.objects.find(o => o.metadata.name === 'radar-cutover-6h');
    planMap.metadata.namespace = 'radar-immobilier';
    writeFileSync(join(f.dir, 'configuration.json'), JSON.stringify(planMap));
    state.objects = state.objects.filter(o => o !== planMap);
    persist(state);
    success(run('window-start'));
    const captured = record();
    assert.equal(captured.kind, 'cutover');
    assert.ok(captured.previousRelease);
    assert.equal(captured.previousRelease.apiServedSha, state.release.apiServedSha);
    assert.equal(captured.previousRelease.gitSha, state.release.gitSha);
    assert.ok(captured.consumers.length > 0);
    assert.equal(captured.executor.state, 'stopped');
    assert.notEqual(f.run('prepare', [], 'prod').status, 0, 'promote-prod prepare doit refuser');
    assert.notEqual(run('window-close', captured.run).status, 0, 'configuration requise avant drain');
    success(run('window-configure', captured.run));
    assert.notEqual(run('window-close', '00000000-0000-0000-0000-000000000000').status, 0);
    const active = f.state();
    const cm = active.objects.find(o => o.metadata.name === 'radar-change-lock');
    const busy = JSON.parse(cm.data.record);
    busy.executor.state = 'running'; busy.executor.pid = String(process.pid);
    busy.executor.start = readFileSync(`/proc/${process.pid}/stat`, 'utf8').split(' ')[21];
    cm.data.record = JSON.stringify(busy); persist(active);
    assert.notEqual(run('window-close', captured.run).status, 0, 'exécuteur actif non repris');
    busy.executor.state = 'stopped'; cm.data.record = JSON.stringify(busy); persist(active);
    success(run('window-close', captured.run));
    assert.equal(f.state().objects.find(o => o.metadata.name === 'radar-api').spec.replicas, 0);
    assert.ok(JSON.stringify(f.state().objects.find(o => o.kind === 'Ingress')).includes('base-maintenance-'));
    const afterDrain = f.calls().length;
    success(run(short ? 'window-rollback-services' : 'window-deploy', captured.run));
    const deployed = f.state();
    if (short) {
      assert.deepEqual(deployed.objects.find(o => o.kind === 'ConfigMap' && o.metadata.name === 'radar-api').data,
        { GEO_DOCUMENTS_REPOINT: 'old' });
      assert.equal(deployed.objects.find(o => o.kind === 'Deployment' && o.metadata.name === 'radar-api').spec.template.spec.containers[0].env, undefined);
    } else {
      const env = deployed.objects.find(o => o.kind === 'Deployment' && o.metadata.name === 'radar-api').spec.template.spec.containers[0].env;
      assert.equal(env.find(e => e.name === 'CLASSIFICATION_CURSOR_SECRET').valueFrom.secretKeyRef.name, 'radar-classification-cursor-prod');
    }
    assert.ok(!f.calls().slice(afterDrain).some(c => c[0] === 'curl' && c.some(a => a === 'https://immo.sent-tech.ca/health')));
    assert.ok(record(), 'verrou conservé après rollout et smoke privé');
    assert.equal(f.state().objects.find(o => o.metadata.name === 'radar-refresh-pv').spec.suspend, true);
    assert.ok(JSON.stringify(f.state().objects.find(o => o.kind === 'Ingress')).includes('base-maintenance-'));
    if (publicFailure) {
      const failing = f.state(); failing.publicFailure = true; persist(failing);
      assert.notEqual(run('window-reopen', captured.run).status, 0);
      assert.ok(record(), 'verrou retenu après refus du smoke public');
      assert.ok(JSON.stringify(f.state().objects.find(o => o.kind === 'Ingress')).includes('base-maintenance-'));
      assert.equal(f.state().objects.find(o => o.metadata.name === 'radar-refresh-pv').spec.suspend, true);
    } else {
      success(run('window-reopen', captured.run));
      assert.equal(f.state().objects.some(o => o.metadata.name === 'radar-change-lock'), false);
    }
    assert.ok(readFileSync(join(f.dir, 'application-calls'), 'utf8').includes('reopen-authorize'));
    assert.deepEqual(f.state().jobCreation || [], [], 'aucun prepare, DDL ou 6H du CD');
  } finally { f.cleanup(); }
});
