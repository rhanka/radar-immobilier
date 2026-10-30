import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import process from 'node:process';
import { fixture } from './cutover-fixture.mjs';
const AUTOSCALERS = ['scaledobjects.keda.sh', 'scaledjobs.keda.sh', 'httpscaledobjects.http.keda.sh',
  'verticalpodautoscalers.autoscaling.k8s.io', 'rollouts.argoproj.io'];
const role = env => YAML.parseAllDocuments(readFileSync(`deploy/cutover/rbac-${env}.yaml`, 'utf8'))
  .map(d => d.toJS()).find(d => d?.kind === 'Role');
const save = (f, state) => writeFileSync(join(f.dir, 'state.json'), JSON.stringify(state));
const success = r => assert.equal(r.status, 0, r.stdout + r.stderr);
function covered(rules, { verb, resource, group, name }) {
  return rules.some(r => r.apiGroups.includes(group) && r.resources.includes(resource) && r.verbs.includes(verb)
    && (!r.resourceNames || (name && !['list', 'create', 'watch'].includes(verb) && r.resourceNames.includes(name))));
}
function accesses(f) {
  const file = join(f.dir, 'access');
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
}
function uncovered(env, list, oneTime = false) {
  const rules = [...role(env).rules, ...(oneTime ? YAML.parseAllDocuments(readFileSync(`deploy/cutover/rbac-adopt-${env}.yaml`, 'utf8'))
    .map(d => d.toJS()).find(d => d?.kind === 'Role').rules : [])];
  return [...new Set(list.filter(a => !covered(rules, a)).map(a => `${a.verb} ${a.resource}.${a.group} ${a.name}`))];
}
test('the preflight right list is exactly the Role of each rbac-<env>.yaml', () => {
  for (const env of ['preprod', 'prod']) {
    const r = spawnSync('bash', ['-c', 'source tools/make/cutover-rbac.sh; rbac_rights'], { env: { ...process.env, ENV: env }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const expected = role(env).rules.flatMap(rule => (rule.apiGroups.length ? rule.apiGroups : ['']).flatMap(g => rule.resources.flatMap(res =>
      rule.verbs.flatMap(v => (rule.resourceNames || ['']).map(n => [v, ...(res.includes('/') ? [res.split('/')[0], g, res.split('/')[1]] : [res, g, '']), n].join('|'))))));
    assert.deepEqual(r.stdout.trim().split('\n').sort(), expected.sort());
    for (const resource of ['scaledobjects', 'scaledjobs', 'httpscaledobjects', 'verticalpodautoscalers', 'rollouts']) {
      assert.ok(r.stdout.includes(`list|${resource}|`), `${env} lists ${resource}`);
    }
  }
});
test('every Kubernetes access of volume expansion, staging, prepare, blue/green cutover, rollback and daily restore is granted by rbac-preprod.yaml', () => {
  const daily = fixture({ apiResources: AUTOSCALERS, unadopted: true, pvcSize: '5Gi' });
  let dailyAccesses, oneTime;
  try {
    // One-time operator acts: the permanent Role plus rbac-adopt-preprod.yaml.
    success(daily.run('slots-adopt'));
    success(daily.run('pvc-expand'));
    oneTime = accesses(daily);
    assert.deepEqual(uncovered('preprod', oneTime, true), []);
    assert.notDeepEqual(uncovered('preprod', oneTime), [], 'adoption needs the one-time Role');
    success(daily.run('run', ['RELEASE=deployed', 'MODE=restore']));
    dailyAccesses = accesses(daily).slice(oneTime.length);
  } finally { daily.cleanup(); }
  const f = fixture({ apiResources: AUTOSCALERS, previousSha: '9'.repeat(40) });
  try {
    success(f.run('pvc-verify'));
    success(f.run('stage', ['RELEASE=deployed']));
    success(f.run('prepare'));
    success(f.run('run', ['MODE=run', 'DRILL=1']));
    const run = JSON.parse(f.state().objects.find(o => o.metadata.name === 'radar-cutover-receipt').data.receipt).run;
    success(f.run('rollback', [`RUN=${run}`, 'MODE=run']));
    const seen = [...dailyAccesses, ...accesses(f)];
    for (const resource of ['scaledobjects', 'httpscaledobjects', 'verticalpodautoscalers', 'rollouts']) {
      assert.ok(seen.some(a => a.verb === 'list' && a.resource === resource), resource);
    }
    assert.deepEqual(uncovered('preprod', seen), []);
  } finally { f.cleanup(); }
});
test('every Kubernetes access of production prepare and cutover is granted by rbac-prod.yaml', () => {
  const f = fixture({ url: 'https://immo.sent-tech.ca', apiResources: AUTOSCALERS });
  try {
    const state = f.state();
    const ingress = state.objects.find(o => o.kind === 'Ingress');
    ingress.spec.rules[0].host = 'immo.sent-tech.ca'; ingress.spec.tls[0].hosts = ['immo.sent-tech.ca'];
    save(f, state);
    success(f.run('prepare', [], 'prod'));
    success(f.run('run', ['MODE=run'], 'prod'));
    assert.deepEqual(uncovered('prod', accesses(f)), []);
  } finally { f.cleanup(); }
});
test('a missing RBAC right fails prepare and cutover before any lock or mutation, listing the rights', () => {
  const f = fixture({ deniedRights: ['list httpscaledobjects.http.keda.sh', 'create pods/portforward'] });
  try {
    for (const [action, extra] of [['prepare', []], ['run', ['MODE=run']]]) {
      const result = f.run(action, extra);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Missing RBAC rights/);
      assert.ok(result.stderr.includes('list httpscaledobjects.http.keda.sh'), result.stderr);
      assert.ok(result.stderr.includes('create pods/portforward'), result.stderr);
    }
    assert.equal(accesses(f).length, 0);
    assert.equal(f.state().objects.some(o => o.metadata.name === 'radar-change-lock'), false);
  } finally { f.cleanup(); }
});
