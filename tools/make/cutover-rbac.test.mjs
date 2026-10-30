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
function uncovered(env, list) {
  const rules = role(env).rules;
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
test('every Kubernetes access of prepare, cutover, rollback and daily restore is granted by rbac-preprod.yaml', () => {
  const daily = fixture({ apiResources: AUTOSCALERS });
  let dailyAccesses;
  try {
    success(daily.run('run', ['RELEASE=deployed', 'MODE=restore']));
    dailyAccesses = accesses(daily);
  } finally { daily.cleanup(); }
  const f = fixture({ apiResources: AUTOSCALERS });
  try {
    success(f.run('prepare'));
    const state = f.state(); state.missingMcp = true; save(f, state);
    assert.notEqual(f.run('run', ['MODE=run']).status, 0);
    const record = JSON.parse(f.state().objects.find(o => o.metadata.name === 'radar-change-lock').data.record);
    const recovery = f.state(); recovery.missingMcp = false; save(f, recovery);
    success(f.run('rollback', [`RUN=${record.run}`, 'MODE=run']));
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
  const f = fixture({ apiResources: AUTOSCALERS, deniedRights: ['list httpscaledobjects.http.keda.sh', 'create pods/portforward'] });
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
test('KEDA rules pair each resource with its own API group only', () => {
  for (const env of ['preprod', 'prod']) {
    const rules = role(env).rules;
    const groupsOf = resource => rules.filter(r => r.resources.includes(resource)).flatMap(r => r.apiGroups);
    assert.deepEqual(groupsOf('scaledobjects'), ['keda.sh']);
    assert.deepEqual(groupsOf('scaledjobs'), ['keda.sh']);
    assert.deepEqual(groupsOf('httpscaledobjects'), ['http.keda.sh']);
  }
});
test('preflight skips Role types the server does not serve and still refuses served denied rights', () => {
  // Only KEDA is installed: Argo rollouts and VPA are absent, and can-i would answer no for them.
  const f = fixture({ apiResources: ['scaledobjects.keda.sh', 'scaledjobs.keda.sh', 'httpscaledobjects.http.keda.sh'] });
  try {
    success(f.run('prepare'));
    const asked = f.calls().filter(c => c.includes('can-i')).map(c => c[c.indexOf('can-i') + 2]);
    assert.ok(asked.includes('httpscaledobjects.http.keda.sh'));
    for (const absent of ['rollouts.argoproj.io', 'verticalpodautoscalers.autoscaling.k8s.io',
      'httpscaledobjects.keda.sh', 'scaledobjects.http.keda.sh']) assert.ok(!asked.includes(absent), absent);
    const state = f.state(); state.deniedRights = ['get scaledjobs.keda.sh']; save(f, state);
    const result = f.run('run', ['MODE=run']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing RBAC rights.*get scaledjobs\.keda\.sh/);
  } finally { f.cleanup(); }
});
