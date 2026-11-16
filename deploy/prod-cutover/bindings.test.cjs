/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const r = require('./runtime.cjs');
test('refuse deux ConfigMaps du même nom avant toute validation du plan', async () => {
  const dir = r.fs.mkdtempSync(r.path.join(os.tmpdir(), 'cutover-duplicate-'));
  const original = { destination: r.destination, mutationGuard: r.mutationGuard, configuration: process.env.CONFIGURATION };
  try {
    r.destination = r.mutationGuard = () => {};
    process.env.CONFIGURATION = r.path.join(dir, 'configuration.json');
    const item = { kind: 'ConfigMap', metadata: { namespace: 'radar-immobilier', name: 'radar-cutover-6h' } };
    r.fs.writeFileSync(process.env.CONFIGURATION, JSON.stringify({ kind: 'List', items: [item, item] }));
    await assert.rejects(require('./cli.cjs').main('configuration-check'), /configuration_duplicate/);
  } finally {
    r.destination = original.destination; r.mutationGuard = original.mutationGuard;
    if (original.configuration === undefined) delete process.env.CONFIGURATION; else process.env.CONFIGURATION = original.configuration;
    r.fs.rmSync(dir, { recursive: true });
  }
});
test('GO lié aux octets exacts du plan et du roster, avant grants et hook', () => {
  const dir = r.fs.mkdtempSync(r.path.join(os.tmpdir(), 'cutover-binding-'));
  const prior = { ...process.env };
  try {
    const accounts = [{ sub: 'approved-account', manageMembers: false }];
    for (const [name, data] of Object.entries({ plan: { accounts }, roster: accounts })) {
      process.env[name.toUpperCase()] = r.path.join(dir, `${name}.json`);
      r.fs.writeFileSync(process.env[name.toUpperCase()], JSON.stringify(data));
    }
    process.env.APPROVAL = r.path.join(dir, 'go.json');
    r.fs.writeFileSync(process.env.APPROVAL, JSON.stringify({ sha: r.SHA, owner: 'test',
      expiresAt: new Date(Date.now() + 60000).toISOString(), planSha256: r.hash(process.env.PLAN),
      rosterSha256: r.hash(process.env.ROSTER) }));
    assert.deepEqual(r.approvedPlan().plan.accounts, accounts);
    for (const name of ['PLAN', 'ROSTER']) {
      const bytes = r.fs.readFileSync(process.env[name]);
      r.fs.appendFileSync(process.env[name], '\n');
      assert.throws(() => r.approvedPlan(), /approved_6h_content_mismatch/);
      r.fs.writeFileSync(process.env[name], bytes);
    }
    accounts[0].manageMembers = true;
    r.fs.writeFileSync(process.env.PLAN, JSON.stringify({ accounts }));
    r.fs.writeFileSync(process.env.ROSTER, JSON.stringify(accounts));
    const original = { destination: r.destination, mutationGuard: r.mutationGuard, prefix: r.prefix };
    try {
      r.destination = r.mutationGuard = () => {};
      r.prefix = () => assert.fail('Aucun accès DB avant la liaison GO');
      assert.throws(() => require('./migrate.cjs').hook('transition'), /approved_6h_content_mismatch/);
    } finally { Object.assign(r, original); }
  } finally {
    for (const key of ['PLAN', 'ROSTER', 'APPROVAL']) {
      if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    }
    r.fs.rmSync(dir, { recursive: true });
  }
});
test('les quatre opérations écrivantes exigent la propriété du verrou commun', () => {
  const original = { destination: r.destination, mutationGuard: r.mutationGuard };
  try {
    r.destination = () => {};
    r.mutationGuard = () => r.fail('change_lock_ownership_required');
    for (const fn of [require('./backup.cjs').backup, require('./backup.cjs').rollback,
      require('./migrate.cjs').migrate, () => require('./migrate.cjs').hook('transition')])
      assert.throws(fn, /change_lock_ownership_required/);
  } finally { Object.assign(r, original); }
});
test('un RUN identique ne suffit pas : type, marqueur, exécuteur actif exact requis', () => {
  const before = { run: process.env.CUTOVER_LOCK_RUN, executor: process.env.CUTOVER_LOCK_EXECUTOR };
  const executor = { kind: 'local', pid: '123', state: 'running' };
  const record = { kind: 'cutover', manualV1220: true, run: 'test-run', executor };
  try {
    process.env.CUTOVER_LOCK_RUN = record.run;
    process.env.CUTOVER_LOCK_EXECUTOR = JSON.stringify(executor);
    r.lockOwnership(record);
    for (const patch of [{ kind: 'writer' }, { manualV1220: false }, { run: 'other' },
      { executor: { ...executor, pid: '456' } }, { executor: { ...executor, state: 'stopped' } }])
      assert.throws(() => r.lockOwnership({ ...record, ...patch }), /change_lock_ownership_required/);
  } finally {
    for (const [key, value] of Object.entries({ CUTOVER_LOCK_RUN: before.run, CUTOVER_LOCK_EXECUTOR: before.executor })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
