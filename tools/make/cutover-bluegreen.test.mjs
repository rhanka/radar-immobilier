import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { fixture } from './cutover-fixture.mjs';
const success = r => assert.equal(r.status, 0, r.stdout + r.stderr);
const object = (f, name, kind) => f.state().objects.find(o => o.metadata.name === name && (!kind || o.kind === kind));
const save = (f, state) => writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
const db = f => Buffer.from(object(f, 'radar-db-credentials').data.POSTGRES_DB, 'base64').toString();
const slotOf = (f, name) => object(f, name, 'Service').spec.selector['sentropic.io/slot'];
const receipt = f => JSON.parse(object(f, 'radar-cutover-receipt').data.receipt);
const lock = f => object(f, 'radar-change-lock');
const calls = f => f.calls().map(c => c.join(' '));
const SERVICES = ['radar-api', 'radar-immo-mcp', 'radar-ui'];
const entries = f => JSON.parse(object(f, 'radar-retained-db')?.data.entries ?? '[]');
const servicePatches = f => f.calls().map((c, i) => ({ c, i })).filter(({ c }) => c.includes('patch') && c.includes('service'))
  .map(({ c, i }) => ({ i, name: c[c.indexOf('service') + 1], to: JSON.parse(c[c.indexOf('-p') + 1]).at(-1).value }))
  .filter(p => p.name.startsWith('radar-'));
test('preprod blue/green: freeze, switch callers first, promotion re-rolls canonical, logs before deletion, routing back on main', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    const before = f.calls().length;
    const result = f.run('run', ['MODE=run']);
    success(result);
    const steps = f.state().jobCreation.map(j => j.step);
    const run = receipt(f);
    // Order: freeze, then the three Service patches api -> mcp -> ui; back to main ui -> mcp -> api.
    const patches = servicePatches(f).filter(p => p.i >= before);
    assert.deepEqual(patches.map(p => `${p.name}:${p.to}`), ['radar-api:prepared', 'radar-immo-mcp:prepared', 'radar-ui:prepared',
      'radar-ui:main', 'radar-immo-mcp:main', 'radar-api:main']);
    assert.ok(steps.indexOf('freeze') < steps.indexOf('logsmain0') && steps.indexOf('logsmain0') < steps.indexOf('logsprepared1'));
    // The canonical Secret switches once, after the canonical logs, before the canonical re-roll.
    const all = calls(f);
    const secret = all.findIndex(c => / patch secret radar-db-credentials/.test(c));
    const reroll = all.findIndex((c, i) => i > secret && / patch deployment radar-api /.test(c));
    const mainLogs = all.findIndex(c => c.includes('job-name=cutover-') && c.includes('-logsmain0'));
    assert.ok(mainLogs > 0 && mainLogs < reroll, 'the canonical Pods are followed before the re-roll');
    assert.ok(secret > 0 && reroll > secret);
    assert.equal(db(f), 'radar_next');
    // Same SHA: the per-run annotation still forces a new ReplicaSet on every canonical Deployment.
    for (const name of SERVICES) {
      const d = object(f, name, 'Deployment');
      assert.equal(d.spec.template.metadata.annotations['sentropic.io/promoted-run'], run.run);
      assert.ok(run.promotion.oldHashes[name] !== undefined);
      assert.equal(slotOf(f, name), 'main');
    }
    // The prepared slot is deleted only after routing left it and its logs were exported.
    const prepLogs = all.findIndex(c => c.includes('-logsprepared1'));
    const deletion = all.findIndex(c => c.includes('/deployments/radar-api-prepared') && c.includes('delete'));
    const lastBack = servicePatches(f).at(-1).i;
    assert.ok(lastBack < prepLogs && prepLogs < deletion, `${lastBack} < ${prepLogs} < ${deletion}`);
    assert.equal(object(f, 'radar-api-prepared', 'Deployment'), undefined);
    assert.equal(object(f, 'radar-ui-nginx-prepared'), undefined);
    // Receipt: measured windows, freeze, first green, consumed stamp, schedules, lock.
    assert.equal(run.switches.length, 2);
    assert.ok(run.switches.every(s => Number.isInteger(s.mixedWindowMs)));
    assert.match(run.frozenAt, /Z$/); assert.match(run.firstGreenAt, /Z$/);
    assert.ok(Number.isInteger(run.freezeWindowMs));
    assert.equal(object(f, 'radar-prepared-db').data.status, 'consumed');
    assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
    assert.equal(object(f, 'originally-suspended').spec.suspend, true);
    assert.equal(lock(f), undefined);
    assert.equal(JSON.stringify(object(f, 'application').spec).includes('base-maintenance-'), false, 'Ingresses never change');
    assert.notEqual(f.run('run', ['MODE=run']).status, 0, 'a consumed prepared database is never reused');
  } finally { f.cleanup(); }
});
test('SAMEDB=1 runs the production path in preprod: no freeze, no database switch, slot on the live database', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    success(f.run('run', ['MODE=run', 'SAMEDB=1']));
    const steps = f.state().jobCreation.map(j => j.step);
    assert.equal(steps.includes('freeze'), false);
    assert.equal(f.calls().some(c => c.includes('secret')  && c.includes('patch')), false);
    assert.equal(db(f), 'radar');
    assert.deepEqual(f.state().created.filter(c => c.name === 'radar-api-prepared').map(c => c.db), ['radar_next', 'radar']);
    assert.equal(object(f, 'radar-prepared-db').data.status, 'ready', 'the prepared database is not consumed');
    assert.equal(receipt(f).samedb, true);
  } finally { f.cleanup(); }
});
test('an unserved prepared slot switches back to main automatically and reopens writes', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    const state = f.state(); state.preparedStale = true; save(f, state);
    const result = f.run('run', ['MODE=run']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /routing returned to slot=main/);
    for (const name of SERVICES) assert.equal(slotOf(f, name), 'main');
    assert.equal(f.state().unfrozen, 1);
    assert.equal(db(f), 'radar');
    assert.equal(lock(f), undefined);
    assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
    assert.equal(object(f, 'radar-api-prepared', 'Deployment'), undefined, 'the abandoned prepared slot is removed (logs exported)');
    assert.ok(f.state().jobCreation.some(j => j.step.startsWith('logsprepared')));
  } finally { f.cleanup(); }
});
test('the drill routes back to the previous release then re-switches', () => {
  const f = fixture({ previousSha: '9'.repeat(40) });
  try {
    success(f.run('prepare'));
    success(f.run('run', ['MODE=run', 'DRILL=1']));
    const run = receipt(f);
    assert.deepEqual(run.switches.map(s => s.to), ['prepared', 'main', 'prepared', 'main']);
    assert.ok(Number.isInteger(run.drill.backMs));
    assert.equal(run.previousRelease.apiServedSha, '9'.repeat(40));
  } finally { f.cleanup(); }
});
test('a log manifest missing a Pod refuses every deletion; resume completes the promotion', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    const state = f.state(); state.logsMissing = true; save(f, state);
    const failed = f.run('run', ['MODE=run']);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /Log manifest misses a recorded Pod/);
    assert.ok(lock(f), 'promotion started: the lock is retained');
    assert.ok(object(f, 'radar-api-prepared', 'Deployment'), 'no further deletion after an incomplete manifest');
    for (const name of SERVICES) assert.equal(slotOf(f, name), 'prepared', 'the release keeps being served');
    const record = JSON.parse(lock(f).data.record);
    const fixed = f.state(); fixed.logsMissing = false; save(f, fixed);
    success(f.run('resume', [`RUN=${record.run}`]));
    for (const name of SERVICES) assert.equal(slotOf(f, name), 'main');
    assert.equal(lock(f), undefined);
    assert.deepEqual(receipt(f).logGaps, ['logsmain0'], 'the unrecoverable gap is explicit in the receipt');
  } finally { f.cleanup(); }
});
test('rollback of an interrupted run routes back to main and unfreezes the live database', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    const state = f.state(); state.crash = { step: 'stage-4', edge: 'after-started' }; save(f, state);
    assert.notEqual(f.run('run', ['MODE=run']).status, 0);
    for (const name of SERVICES) assert.equal(slotOf(f, name), 'prepared');
    const record = JSON.parse(lock(f).data.record);
    success(f.run('rollback', [`RUN=${record.run}`, 'MODE=run']));
    for (const name of SERVICES) assert.equal(slotOf(f, name), 'main');
    assert.equal(f.state().unfrozen, 1);
    assert.equal(object(f, 'radar-api-prepared', 'Deployment'), undefined, 'the prepared slot is cleaned up');
    assert.equal(db(f), 'radar');
    assert.equal(lock(f), undefined);
    assert.equal(object(f, 'radar-refresh-pv').spec.suspend, false);
  } finally { f.cleanup(); }
});
test('rollback after promotion rebuilds the previous release on the retained database without outage', () => {
  const f = fixture({ previousSha: '9'.repeat(40) });
  try {
    success(f.run('prepare'));
    success(f.run('run', ['MODE=run']));
    const promoted = receipt(f);
    assert.equal(db(f), 'radar_next');
    success(f.run('rollback', [`RUN=${promoted.run}`, 'MODE=run']));
    const back = receipt(f);
    assert.equal(back.rollbackOf, promoted.run);
    assert.equal(db(f), 'radar');
    assert.ok(f.state().jobCreation.some(j => j.step === 'unfreezeprev'), 'the retained database accepts writes again');
    assert.equal(object(f, 'radar-api', 'Deployment').spec.template.spec.containers[0].image, promoted.previousRelease.apiImage);
    for (const name of SERVICES) assert.equal(slotOf(f, name), 'main');
    assert.equal(object(f, 'radar-api-prepared', 'Deployment'), undefined);
    assert.equal(lock(f), undefined);
  } finally { f.cleanup(); }
});
test('before slot adoption, prepare, run and rollback refuse slots_not_adopted before creating anything', () => {
  const f = fixture({ unadopted: true });
  try {
    for (const [action, extra] of [['prepare', []], ['run', ['MODE=run']], ['rollback', ['RUN=00000000-0000-4000-8000-000000000000', 'MODE=run']]]) {
      const result = f.run(action, extra);
      assert.notEqual(result.status, 0, action);
      assert.match(result.stderr, /slots_not_adopted/, action);
    }
    assert.equal(f.calls().some(c => c[0] === 'kubectl' && (c.includes('create') || c.includes('patch') || c.includes('delete'))
      && !c.includes('can-i') && !c.includes('--dry-run=client')), false, 'no creation, patch or deletion');
    assert.equal(f.state().objects.some(o => o.metadata.name.endsWith('-prepared') || o.metadata.name === 'radar-change-lock'), false);
  } finally { f.cleanup(); }
});
test('prepared Pods are never selected by the canonical Services; a partial switch is fully reverted', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    const state = f.state();
    for (const name of SERVICES) {
      const selector = state.objects.find(o => o.kind === 'Service' && o.metadata.name === name).spec.selector;
      const selected = state.objects.filter(p => p.kind === 'Pod' && Object.entries(selector).every(([k, v]) => p.metadata.labels?.[k] === v));
      assert.ok(selected.length > 0 && selected.every(p => p.metadata.labels['sentropic.io/slot'] === 'main'), name);
    }
    // The third Service refuses the switch: the two already switched return to main.
    state.serviceConflict = 'radar-ui'; state.conflictTo = 'prepared'; save(f, state);
    assert.notEqual(f.run('run', ['MODE=run']).status, 0);
    for (const name of SERVICES) assert.equal(slotOf(f, name), 'main', name);
    assert.equal(lock(f), undefined);
  } finally { f.cleanup(); }
});
test('after a promotion, SAMEDB=1 runs on the promoted (migrated) live database with the consumed stamp', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    success(f.run('run', ['MODE=run']));
    assert.equal(object(f, 'radar-prepared-db').data.status, 'consumed');
    success(f.run('run', ['MODE=run', 'SAMEDB=1']));
    const run = receipt(f);
    assert.deepEqual([run.samedb, run.liveDb, run.targetDb], [true, 'radar_next', 'radar_next']);
    assert.equal(f.state().created.filter(c => c.name === 'radar-api-prepared').at(-1).db, 'radar_next');
    assert.ok(f.state().objects.some(o => o.kind === 'Job' && o.metadata.name === `cutover-${run.run}-destination`), 'live migrations checked');
  } finally { f.cleanup(); }
});
test('a ConfigMap changed after prepare restarts the prepared slot before any switch', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    const state = f.state();
    state.objects.find(o => o.kind === 'ConfigMap' && o.metadata.name === 'radar-api').data.NEW_SETTING = 'changed';
    save(f, state);
    success(f.run('run', ['MODE=run']));
    assert.equal(f.state().created.filter(c => c.name === 'radar-api-prepared').length, 2);
  } finally { f.cleanup(); }
});
test('a rollback of the rollback re-promotes the new release on its retained database, unfreezing it first', () => {
  const f = fixture({ previousSha: '9'.repeat(40) });
  try {
    success(f.run('prepare'));
    success(f.run('run', ['MODE=run']));
    const a = receipt(f);
    success(f.run('rollback', [`RUN=${a.run}`, 'MODE=run']));
    const b = receipt(f);
    assert.equal(db(f), 'radar');
    success(f.run('rollback', [`RUN=${b.run}`, 'MODE=run']));
    const c = receipt(f);
    assert.equal(c.rollbackOf, b.run);
    assert.equal(db(f), 'radar_next', 'the new release is back on the database promoted first');
    assert.equal(object(f, 'radar-api', 'Deployment').spec.template.spec.containers[0].image, f.release.apiImage);
    assert.equal(f.state().jobCreation.filter(j => j.step === 'unfreezeprev').length, 2);
    for (const name of SERVICES) assert.equal(slotOf(f, name), 'main');
  } finally { f.cleanup(); }
});
test('a rollback after promotion records the abandoned writes; the next prepare keeps that database until ack', () => {
  const f = fixture({ previousSha: '9'.repeat(40), writeStats: { radar: 100, radar_next: 0 } });
  try {
    success(f.run('prepare'));
    success(f.run('run', ['MODE=run']));
    const a = receipt(f);
    const state = f.state(); state.writeStats.radar_next = 7; save(f, state);
    success(f.run('rollback', [`RUN=${a.run}`, 'MODE=run']));
    const b = receipt(f);
    assert.deepEqual([b.abandoned.db, b.abandoned.tuples], ['radar_next', 7]);
    const [entry] = entries(f);
    assert.deepEqual([entry.status, entry.db, entry.run, entry.tuples], ['pending', 'radar_next', b.run, 7]);
    assert.ok(entry.since, 'the baseline time of the original switch is kept');
    const refused = f.run('prepare');
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /retained_db_unacknowledged/);
    assert.equal(f.state().jobCreation.filter(j => j.step === 'clone').length, 1, 'the retained database is not replaced');
    const ack = f.run('ack', [`RUN=${b.run}`]);
    assert.equal(ack.status, 0, ack.stderr);
    assert.match(ack.stdout, /radar_next: 7 abandoned written tuples/);
    assert.deepEqual(entries(f).map(e => [e.status, e.acknowledgement.by]), [['acknowledged', 'operator']]);
    success(f.run('prepare'));
  } finally { f.cleanup(); }
});
test('a return to main before promotion records the writes made through the prepared slot', () => {
  const f = fixture({ writeGrowth: { radar_next: 3 } });
  try {
    success(f.run('prepare'));
    const state = f.state(); state.preparedStale = true; save(f, state);
    assert.notEqual(f.run('run', ['MODE=run']).status, 0);
    const [entry] = entries(f);
    assert.deepEqual([entry.status, entry.db, entry.tuples], ['pending', 'radar_next', 3]);
  } finally { f.cleanup(); }
});
test('the change lock is awaited for a bounded time instead of failing at once', () => {
  const held = () => ({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'radar-change-lock', uid: 'uid-held', resourceVersion: '1' },
    data: { record: JSON.stringify({ run: 'competing-operation', kind: 'stage', executor: { kind: 'github', run: '1' }, checkpoints: {}, jobs: {} }) } });
  const f = fixture();
  try {
    const state = f.state(); state.objects.push(held()); state.lockReleaseAfter = 2; save(f, state);
    f.env.LOCK_WAIT = '60';
    const queued = f.run('prepare');
    assert.equal(queued.status, 0, queued.stderr);
    assert.match(queued.stderr, /Waiting for operation competing-operation to release radar-change-lock/);
    const again = f.state(); again.objects.push(held()); again.lockReleaseAfter = 0; save(f, again);
    f.env.LOCK_WAIT = '3';
    const refused = f.run('prepare');
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /A competing operation holds the lock/);
    assert.equal(lock(f).metadata.uid, 'uid-held', 'waiting never adopts a lock');
  } finally { f.cleanup(); }
});
test('the rehearsal acknowledges its own abandoned writes only when its probe rows explain them; entries are never overwritten', () => {
  const f = fixture({ previousSha: '9'.repeat(40), writeStats: { radar: 100, radar_next: 0 } });
  try {
    success(f.run('prepare'));
    success(f.run('run', ['MODE=run']));
    const a = receipt(f);
    let state = f.state(); state.writeStats.radar_next = 40; save(f, state);
    success(f.run('rollback', [`RUN=${a.run}`, 'MODE=run']));
    const b = receipt(f);
    // Unexplained: fewer probe rows than abandoned tuples -> stays pending, conductor ack required.
    state = f.state(); state.probeRows = 12; save(f, state);
    const refused = f.run('ack-probe', [`RUN=${b.run}`, 'PROBE=rh-1700000000']);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /abandoned_writes_unexplained/);
    assert.equal(entries(f)[0].status, 'pending');
    // A second abandonment (rollback of the rollback) appends: the pending entry survives.
    state = f.state(); state.writeStats.radar = 130; save(f, state);
    success(f.run('rollback', [`RUN=${b.run}`, 'MODE=run']));
    const c = receipt(f);
    assert.deepEqual(entries(f).map(e => [e.run, e.db, e.status]), [[b.run, 'radar_next', 'pending'], [c.run, 'radar', 'pending']]);
    // Explained by the probe rows: acknowledged with the proof attached.
    state = f.state(); state.probeRows = 40; save(f, state);
    const ok = f.run('ack-probe', [`RUN=${b.run}`, 'PROBE=rh-1700000000']);
    assert.equal(ok.status, 0, ok.stderr);
    const acked = entries(f).find(e => e.run === b.run);
    assert.deepEqual([acked.status, acked.acknowledgement.by, acked.acknowledgement.proof],
      ['acknowledged', 'rehearsal-probe', { probePrefix: 'rh-1700000000', probeRows: 40, tuples: 40 }]);
    const job = f.state().objects.filter(o => o.kind === 'Job' && o.metadata.name.endsWith('-probecount')).at(-1);
    const env = Object.fromEntries(job.spec.template.spec.containers[0].env.map(e => [e.name, e.value]));
    assert.deepEqual([env.TARGET_DB, env.PROBE_RUN, env.PROBE_SINCE], ['radar_next', 'rh-1700000000', acked.since]);
    assert.equal(entries(f).find(e => e.run === c.run).status, 'pending', 'only the proven entry is acknowledged');
  } finally { f.cleanup(); }
});
test('the prepared slot and the promotion use the release manifests (#611); a rollback restores the previous specs', () => {
  const f = fixture({ previousSha: '9'.repeat(40) });
  const marked = c => (c.env || []).some(e => e.name === 'FROM_RELEASE_MANIFEST');
  try {
    const state = f.state(); state.objects.find(o => o.kind === 'Deployment' && o.metadata.name === 'radar-api').spec.replicas = 2; save(f, state);
    success(f.run('prepare'));
    for (const name of SERVICES) {
      assert.ok(marked(object(f, `${name}-prepared`, 'Deployment').spec.template.spec.containers[0]), `${name}: prepared from the release manifest`);
    }
    success(f.run('run', ['MODE=run']));
    const api = object(f, 'radar-api', 'Deployment');
    assert.ok(marked(api.spec.template.spec.containers[0]), 'the canonical slot receives the release spec');
    assert.equal(api.spec.template.spec.containers[0].image, f.release.apiImage);
    assert.deepEqual([api.spec.replicas, api.spec.selector.matchLabels['sentropic.io/slot'], api.spec.template.metadata.labels['sentropic.io/slot']], [2, 'main', 'main']);
    const cron = object(f, 'radar-refresh-pv', 'CronJob');
    assert.ok(marked(cron.spec.jobTemplate.spec.template.spec.containers[0]), 'CronJob spec from the release');
    assert.equal(cron.spec.suspend, false, 'original schedule state restored');
    const promoted = receipt(f);
    assert.ok(promoted.previousSpecs['Deployment/radar-api'] && promoted.previousSpecs['CronJob/radar-refresh-pv']);
    success(f.run('rollback', [`RUN=${promoted.run}`, 'MODE=run']));
    const back = object(f, 'radar-api', 'Deployment').spec.template.spec.containers[0];
    assert.equal(marked(back), false, 'the rollback restores the spec that ran before');
    assert.equal(back.image, promoted.previousRelease.apiImage);
  } finally { f.cleanup(); }
});
test('a release without the manifest of a workload refuses before creating the prepared slot', () => {
  const f = fixture();
  try {
    const state = f.state(); state.releaseManifests['deploy/overlays/preprod'] = state.releaseManifests['deploy/overlays/preprod']
      .filter(d => d.metadata.name !== 'radar-ui'); save(f, state);
    const result = f.run('prepare');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release_manifest_missing: Deployment\/radar-ui/);
    assert.equal(f.state().objects.some(o => o.kind === 'Deployment' && o.metadata.name.endsWith('-prepared')), false);
  } finally { f.cleanup(); }
});
test('the rehearsal version check answers same when the release is already served, changed otherwise', () => {
  const same = fixture();
  try {
    const result = same.run('rehearse-check');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'same');
  } finally { same.cleanup(); }
  const changed = fixture({ previousSha: '9'.repeat(40) });
  try { assert.equal(changed.run('rehearse-check').stdout.trim(), 'changed'); } finally { changed.cleanup(); }
});
test('the kustomize-hashed nginx ConfigMap of the release is applied first and the prepared UI calls the prepared API', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    const ui = object(f, 'radar-ui-prepared', 'Deployment').spec.template.spec;
    assert.deepEqual(ui.volumes.map(v => v.configMap?.name), ['radar-ui-nginx-prepared'], 'remapped by prefix, never the hashed canonical name');
    const conf = object(f, 'radar-ui-nginx-prepared').data['default.conf'];
    assert.ok(conf.startsWith('# release nginx') && conf.includes('http://radar-api-prepared:3000') && !conf.includes('http://radar-api:3000'));
    assert.ok(object(f, 'radar-ui-nginx-7k2m9h5tgb', 'ConfigMap'), 'generated ConfigMap of the release created before the slot');
    success(f.run('run', ['MODE=run']));
    const canonical = object(f, 'radar-ui', 'Deployment').spec.template.spec;
    assert.deepEqual(canonical.volumes.map(v => v.configMap?.name), ['radar-ui-nginx-7k2m9h5tgb']);
    assert.ok(object(f, 'radar-ui-nginx-7k2m9h5tgb', 'ConfigMap'), 'the promoted UI mounts an existing ConfigMap');
  } finally { f.cleanup(); }
});
test('drift: the first promotion reviews live vs release; later runs compare the live specs to the last applied ones', () => {
  const f = fixture();
  try {
    success(f.run('prepare'));
    success(f.run('run', ['MODE=run']));
    const first = receipt(f);
    assert.equal(first.drift.baseline, 'first-promotion');
    assert.ok(first.drift.lines > 0, 'the live specs differed from the release manifests');
    assert.equal(object(f, 'radar-release-drift').data.status, 'pending', 'preprod: reported, not blocking');
    const applied = JSON.parse(object(f, 'radar-applied-specs').data.specs);
    assert.ok(applied['Deployment/radar-api'] && applied['CronJob/radar-refresh-pv']);
    assert.equal(applied['Deployment/radar-api'].replicas, undefined, 'replicas (HPA) are not part of the drift');
    // A manual change on the live workload after the promotion is drift against the applied specs.
    const state = f.state();
    state.objects.find(o => o.kind === 'Deployment' && o.metadata.name === 'radar-api').spec.template.spec.containers[0].env.push({ name: 'MANUAL', value: 'x' });
    save(f, state);
    success(f.run('run', ['MODE=run', 'SAMEDB=1']));
    const second = receipt(f);
    assert.deepEqual([second.drift.baseline, second.drift.lines > 0], ['applied', true]);
    assert.match(object(f, 'radar-release-drift').data.report, /MANUAL/);
  } finally { f.cleanup(); }
});
test('the release manifests are refused when the checkout commit is unreadable or another commit', () => {
  const f = fixture();
  try {
    f.env.CUTOVER_TEST_TREE_SHA = '';
    const unreadable = f.run('prepare');
    assert.notEqual(unreadable.status, 0);
    assert.match(unreadable.stderr, /release_manifests_unverifiable/);
    f.env.CUTOVER_TEST_TREE_SHA = 'f'.repeat(40);
    const other = f.run('prepare');
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /release_manifests_mismatch/);
  } finally { f.cleanup(); }
});
