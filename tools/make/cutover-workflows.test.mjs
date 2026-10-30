import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import YAML from 'yaml';
const workflow = name => YAML.parse(readFileSync(`.github/workflows/${name}`, 'utf8'));
test('main deployment requires successful prepare with no tolerated restore or migration failure', () => {
  const w = workflow('build-push-images.yml');
  const job = w.jobs['prepare-preprod-db'];
  assert.deepEqual(job.needs, ['build-push', 'cutover-release']);
  assert.equal(job['timeout-minutes'], 50);
  assert.equal(job.if, "github.ref == 'refs/heads/main' && vars.PREPROD_CD_ENABLED == 'true'");
  assert.equal(job.if, w.jobs['deploy-preprod'].if, 'prepare shares the preprod CD arming');
  assert.ok(w.jobs['deploy-preprod'].needs.includes('prepare-preprod-db'));
  assert.ok(job.steps.some(s => s.run === 'make -f deploy/cutover/operator.mk prepare RELEASE=cutover-release/release.json ENV=preprod'));
  assert.equal(JSON.stringify(job).includes('continue-on-error'), false);
});
test('daily and inter-tenant interfaces use the engine with protected arming unchanged', () => {
  const w = workflow('bascule-preprod.yml');
  assert.equal(w.on.schedule[0].cron, '0 4 * * *');
  assert.ok(w.jobs.bascule.if.includes("vars.BASCULE_SCHEDULE_ENABLED == 'true'"));
  assert.equal(w.jobs.bascule.environment, 'radar-bascule');
  assert.equal(w.jobs.bascule['timeout-minutes'], 330);
  const inputs = w.on.workflow_dispatch.inputs;
  for (const name of ['MODE', 'BACKUP_ID', 'CYCLE_ID', 'CONFIRM', 'DRY_RUN']) assert.ok(inputs[name]);
  assert.deepEqual(inputs.MODE.options, ['restore', 'list']);
  assert.equal(inputs.SKIP_FLIP, undefined); assert.equal(inputs.SKIP_QUIESCE, undefined);
  assert.ok(w.jobs.bascule.steps.find(s => s.id === 'engine').run.includes('RELEASE=deployed'));
  for (const name of ['served-ids', 'cycle-leg']) assert.equal(JSON.stringify(w.jobs[name]).includes('secrets.'), false);
});
test('all competing workflows acquire before mutations and release through always', () => {
  for (const [file, jobs] of [['build-push-images.yml', ['deploy', 'deploy-preprod']],
    ['rollback.yml', ['rollback-preprod', 'rollback-prod']], ['run-job.yaml', ['run']], ['k8s-apply-mcp.yaml', ['apply']],
    ['bascule-bundle-cd.yml', ['apply-bundle', 'apply-backup']]]) {
    const w = workflow(file);
    for (const name of jobs) {
      const steps = w.jobs[name].steps;
      const acquire = steps.findIndex(s => s.uses === './deploy/cutover/lock-action' && s.with.action === 'lock');
      const release = steps.findIndex(s => s.uses === './deploy/cutover/lock-action' && s.with.action === 'release-lock');
      assert.ok(acquire >= 0 && release > acquire, `${file}/${name}`);
      assert.ok(steps[release].if.includes('always()'));
    }
  }
  const build = workflow('build-push-images.yml');
  assert.equal(build.concurrency['cancel-in-progress'], false);
  const promotion = JSON.stringify(build.jobs['promote-prod']);
  assert.ok(promotion.includes('operator.mk run RELEASE=cutover-release/release.json ENV=prod'));
  assert.equal(promotion.includes('docker/build-push-action'), false);
  assert.equal(build.jobs['promote-prod'].environment, 'production');
});
test('retired executable vehicles have no fallback entry', () => {
  for (const file of ['deploy/base-preprod/operator.mk', 'deploy/ci/bascule-preprod/bascule.mjs',
    'deploy/ci/bascule-preprod/restore-mode.mjs', 'tools/make/base-preprod-maintenance.sh']) assert.equal(existsSync(file), false);
  assert.equal(readFileSync('deploy/cutover/operator.mk', 'utf8').includes('include .env'), false);
});
test('the preprod CI/CD rehearses the zero-downtime cutover after preparation, with the same arming', () => {
  const w = workflow('build-push-images.yml');
  const job = w.jobs['rehearse-preprod-bluegreen'];
  assert.deepEqual(job.needs, ['prepare-preprod-db', 'deploy-preprod'], 'never concurrent with the canonical deploy (shared lock)');
  assert.equal(job.if, `${w.jobs['prepare-preprod-db'].if} && needs.prepare-preprod-db.outputs.slots == 'adopted'`,
    'same PREPROD_CD_ENABLED arming (read only), only once the slots are adopted');
  assert.equal(job['timeout-minutes'], 80);
  const steps = JSON.stringify(job.steps);
  assert.ok(job.steps.some(s => s.run === 'make -f deploy/cutover/operator.mk rehearse RELEASE=cutover-release/release.json OUTPUT=rehearsal ENV=preprod'));
  assert.ok(job.steps.some(s => s.uses?.startsWith('actions/upload-artifact') && s.if === 'always()'));
  assert.equal(steps.includes('continue-on-error'), false);
  const rehearse = readFileSync('tools/make/cutover-rehearse.sh', 'utf8');
  assert.ok(rehearse.includes('SAMEDB=1 OBSERVE=60') && rehearse.includes('OBSERVE=120 DRILL=1'));
  assert.ok(rehearse.includes('scenario rollback preprod rollback RUN=') && rehearse.includes('scenario repromote preprod rollback RUN='),
    'rollback after promotion and re-promotion are rehearsed');
});
test('daily staging is a dispatchable workflow armed by its own variable, never by the protected ones', () => {
  const w = workflow('bascule-stage-preprod.yml');
  assert.ok(w.on.workflow_dispatch !== undefined);
  assert.equal(w.on.schedule[0].cron, '0 5 * * *');
  assert.equal(w.jobs.stage.if, "${{ github.event_name != 'schedule' || vars.BASCULE_STAGE_ENABLED == 'true' }}");
  assert.ok(w.jobs.stage.steps.some(s => s.run === 'make -f deploy/cutover/operator.mk stage RELEASE=deployed ENV=preprod'));
  for (const file of ['build-push-images.yml', 'bascule-stage-preprod.yml', 'bascule-preprod.yml']) {
    const text = readFileSync(`.github/workflows/${file}`, 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
    for (const name of ['PREPROD_CD_ENABLED', 'BASCULE_SCHEDULE_ENABLED']) {
      assert.equal(new RegExp(`(gh variable set ${name}|vars\\.${name}\\s*=[^=])`).test(text), false, `${file} never writes ${name}`);
    }
  }
});
test('once the slots are adopted, deploy-preprod delegates the release to the blue/green cutover; legacy path otherwise', () => {
  const w = workflow('build-push-images.yml');
  const prepare = w.jobs['prepare-preprod-db'];
  assert.equal(prepare.outputs.slots, '${{ steps.slots.outputs.state }}');
  assert.ok(prepare.steps.some(s => s.id === 'slots' && s.run.includes('operator.mk slots-status ENV=preprod')));
  assert.equal(prepare.steps.find(s => s.run === 'make -f deploy/cutover/operator.mk prepare RELEASE=cutover-release/release.json ENV=preprod').if,
    "steps.slots.outputs.state == 'adopted'");
  const deploy = w.jobs['deploy-preprod'];
  assert.equal(deploy.env.SLOTS, '${{ needs.prepare-preprod-db.outputs.slots }}');
  for (const name of ['Roll preprod deployments to pushed sha', 'Wait for rollouts', 'Assert served sha (preprod)']) {
    assert.match(deploy.steps.find(s => s.name === name).if, /env\.SLOTS != 'adopted'/, name);
  }
  assert.match(deploy.steps.find(s => s.name === 'Migrate DB before release (fail-closed)').if, /env\.SLOTS != 'adopted'/);
  assert.match(deploy.steps.find(s => s.name === 'Deploy refresh CronJobs (preprod)').if, /env\.SLOTS != 'adopted'/);
  assert.equal(deploy.steps.find(s => s.name.startsWith('Reconcile preprod manifests')).env.RECONCILE_CONFIG_ONLY,
    "${{ env.SLOTS == 'adopted' && '1' || '0' }}");
  const reconcile = readFileSync('deploy/ci/reconcile-preprod.sh', 'utf8');
  assert.ok(reconcile.includes('RECONCILE_CONFIG_ONLY'));
  assert.ok(readFileSync('tools/make/cutover-rehearse.sh', 'utf8').includes('version change'), 'the rehearsal requires previous != release');
});
