import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import YAML from 'yaml';
const workflow = name => YAML.parse(readFileSync(`.github/workflows/${name}`, 'utf8'));
test('main deployment rehearses preparation without gating the preprod rollout on it', () => {
  const w = workflow('build-push-images.yml');
  const job = w.jobs['prepare-preprod-db'];
  const deploy = w.jobs['deploy-preprod'];
  assert.deepEqual(job.needs, ['build-push', 'cutover-release']);
  assert.equal(job['timeout-minutes'], 50);
  assert.equal(job.if, "github.ref == 'refs/heads/main' && vars.PREPROD_CD_ENABLED == 'true'");
  assert.deepEqual(deploy.needs, ['build-push', 'prepare-preprod-db']);
  assert.equal(deploy.if, `!cancelled() && needs.build-push.result == 'success' && ${job.if}`, 'deploy shares the preprod CD arming');
  assert.equal(JSON.stringify(deploy).includes('needs.prepare-preprod-db.outputs'), false);
  const report = deploy.steps[0];
  assert.equal(report.if, "needs.prepare-preprod-db.result != 'success'");
  assert.ok(report.run.includes('::warning') && report.run.includes('GITHUB_STEP_SUMMARY'));
  assert.equal(JSON.stringify(report).includes('exit 1'), false);
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
test('a daily restore whose job died is recovered by the same workflow', () => {
  const w = workflow('bascule-preprod.yml');
  const job = w.jobs.recover;
  assert.equal(job.needs, 'bascule');
  assert.equal(job.if, "${{ always() && (needs.bascule.result == 'failure' || needs.bascule.result == 'cancelled') }}");
  assert.equal(job.environment, 'radar-bascule');
  assert.equal(job.permissions.actions, 'read');
  const step = job.steps.at(-1);
  assert.equal(step.run, 'make -f deploy/cutover/operator.mk recover ENV=preprod');
  assert.equal(step.env.GH_TOKEN, '${{ github.token }}');
  assert.equal(JSON.stringify(job).includes('BASCULE_SCHEDULE_ENABLED'), false);
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
