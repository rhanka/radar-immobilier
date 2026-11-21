import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
const workflow = name => YAML.parse(readFileSync(`.github/workflows/${name}`, 'utf8'));
test('main deployment rehearses preparation without gating the preprod rollout on it', () => {
  const w = workflow('build-push-images.yml');
  const job = w.jobs['prepare-preprod-db'];
  const deploy = w.jobs['deploy-preprod'];
  assert.deepEqual(job.needs, ['build-push', 'cutover-release']);
  assert.equal(job['timeout-minutes'], 240);
  const arming = "github.ref == 'refs/heads/main' && vars.PREPROD_CD_ENABLED == 'true'";
  assert.equal(job.if, `${arming} && vars.PREPROD_PREPARE_ENABLED == 'true'`, 'prepare has its own switch, off when absent');
  assert.deepEqual(deploy.needs, ['build-push', 'prepare-preprod-db']);
  assert.equal(deploy.if, `!cancelled() && needs.build-push.result == 'success' && ${arming}`, 'deploy keeps the preprod CD arming only');
  assert.equal(JSON.stringify(w.jobs).split('PREPROD_PREPARE_ENABLED').length, 2, 'the switch gates prepare-preprod-db only');
  assert.equal(JSON.stringify(deploy).includes('needs.prepare-preprod-db.outputs'), false);
  const report = deploy.steps[0];
  assert.equal(report.if, "needs.prepare-preprod-db.result != 'success'");
  assert.ok(report.run.includes('::warning') && report.run.includes('GITHUB_STEP_SUMMARY'));
  assert.equal(JSON.stringify(report).includes('exit 1'), false);
  assert.ok(job.steps.some(s => s.run === 'make -f deploy/cutover/operator.mk prepare RELEASE=cutover-release/release.json ENV=preprod'));
  assert.equal(JSON.stringify(job).includes('continue-on-error'), false);
});
test('releases carry no data hook and production promotion requires none', () => {
  const generated = spawnSync('bash', ['-ec', 'fail(){ exit 42; }; source tools/make/cutover-release.sh; out=$(mktemp); generate_release "$out"; cat "$out"'],
    { env: { PATH: process.env.PATH, GIT_SHA: 'a'.repeat(40), API_DIGEST: `sha256:${'b'.repeat(64)}`, UI_DIGEST: `sha256:${'c'.repeat(64)}` }, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(JSON.parse(generated.stdout).dataMigration, null);
  const promote = readFileSync('.github/workflows/build-push-images.yml', 'utf8');
  assert.ok(promote.includes(`'.gitSha==$sha and .dataMigration==null'`));
  assert.equal(promote.includes('.dataMigration=="6h"'), false);
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
    ['bascule-bundle-cd.yml', ['apply-bundle', 'apply-backup']], ['backup-cd.yml', ['apply']],
    ['reannotate-signals-prod.yml', ['reannotate']]]) {
    const w = workflow(file);
    for (const name of jobs) {
      const steps = w.jobs[name].steps;
      const acquire = steps.findIndex(s => s.uses === './deploy/cutover/lock-action' && s.with.action === 'lock');
      const release = steps.findIndex(s => s.uses === './deploy/cutover/lock-action' && s.with.action === 'release-lock');
      assert.ok(acquire >= 0 && release > acquire, `${file}/${name}`);
      assert.ok(steps[release].if.includes('always()') && steps[release].if.includes("env.CUTOVER_LOCK_RUN != ''"), `${file}/${name}`);
    }
  }
  const build = workflow('build-push-images.yml');
  assert.equal(build.concurrency['cancel-in-progress'], false);
  const promotion = JSON.stringify(build.jobs['promote-prod']);
  assert.ok(promotion.includes('operator.mk run RELEASE=cutover-release/release.json ENV=prod'));
  assert.equal(promotion.includes('docker/build-push-action'), false);
  assert.equal(build.jobs['promote-prod'].environment, 'production');
});
test('production promotion migrates inside prepare, under lock, after backup and writer drain', () => {
  const w = workflow('build-push-images.yml');
  const job = w.jobs['promote-prod'];
  assert.equal(job.if, "startsWith(github.ref, 'refs/tags/v') && vars.PROMOTE_PROD_ENABLED == 'true'", 'promote-prod stays disarmed until the owner arms it');
  const steps = job.steps;
  assert.equal(steps.some(s => (s.name || '').includes('Migrate production DB')), false, 'no standalone migrate step outside the lock');
  const prepare = steps.findIndex(s => s.name === 'Prepare production recovery backup and verify live migrations');
  const run = steps.findIndex(s => s.name === 'Sequential cutover (same manifest as rehearsal)');
  assert.ok(prepare >= 0 && prepare < run, 'prepare precedes run');
  // release.json is generated with dataMigration:null (cutover-release.sh);
  // the promotion gate must require exactly that, never a "6h" hook.
  assert.ok(steps.some(s => (s.run || '').includes('.dataMigration==null')));
  const flow = readFileSync('tools/make/cutover-prepare.sh', 'utf8');
  const lock = flow.indexOf('lock_acquire prepare');
  const drain = flow.indexOf('suspend_writers drain');
  const backup = flow.indexOf('run_job backup 840 900');
  const ddl = flow.indexOf('run_job ddl 540 600', backup);
  const destination = flow.indexOf('run_job destination 60 90');
  assert.ok(lock >= 0 && lock < drain && drain < backup && backup < ddl && ddl < destination,
    'prod DDL runs after lock, writer drain and backup, before destination');
});
test('promote-prod applies the refresh prod overlay at the release digest after the cutover', () => {
  const w = workflow('build-push-images.yml');
  const steps = w.jobs['promote-prod'].steps;
  const run = steps.findIndex(s => s.name === 'Sequential cutover (same manifest as rehearsal)');
  const refresh = steps.findIndex(s => s.name === 'Deploy refresh CronJobs (prod, release digest)');
  assert.ok(run >= 0 && refresh > run, 'refresh apply runs after the cutover, never during the drain');
  const step = steps[refresh];
  assert.equal(step.if, "${{ vars.REFRESH_CRONJOB_PROD_ENABLED == 'true' }}");
  assert.ok(step.run.includes("jq -er '.apiImage' cutover-release/release.json"), 'image comes from the release manifest');
  assert.ok(step.run.includes('refresh-018.mk render-prod') && step.run.includes('IMAGE_REF="$api_image"'), 'render pins the release digest');
  assert.ok(step.run.includes('kubectl -n "$NAMESPACE" apply -f "$tmp/prod.yaml"'), 'rendered overlay is applied');
  assert.ok(step.run.includes('fsGroupChangePolicy') && step.run.includes('OnRootMismatch'), 'post-apply control checks fsGroupChangePolicy');
  assert.ok(step.run.includes('live_image') && step.run.includes('!= promoted digest'), 'post-apply control checks the live image');
});
test('promote-prod applies drift check and schedules prod-drift-check without Secret reads', () => {
  const drift = workflow('prod-drift-check.yml');
  assert.ok(Array.isArray(drift.on.schedule) && drift.on.schedule.length === 1, 'daily schedule present');
  assert.notEqual(drift.on.workflow_dispatch, undefined, 'workflow_dispatch enabled');
  assert.equal(drift.permissions.contents, 'read');
  assert.equal(drift.jobs.check.environment, 'production');
  assert.equal(drift.jobs.check.if, "github.ref == 'refs/heads/main'");
  const runCmd = drift.jobs.check.steps.at(-1).run;
  assert.equal(runCmd, 'bash deploy/ci/check-prod-drift.sh');
  const script = readFileSync('deploy/ci/check-prod-drift.sh', 'utf8');
  for (const name of ['radar-backup-daily', 'radar-backup-freshness', 'radar-db-backup-prod',
    'radar-refresh-pv', 'radar-refresh-pending-watchdog', 'radar-backup-daily-script',
    'immo-mcp-config', 'radar-refresh-keyring']) {
    assert.ok(script.includes(name), `drift script covers ${name}`);
  }
  assert.equal(/\bkubectl[^\n]*(apply|patch|replace|delete)\b/.test(script), false, 'strictly read-only');
  const build = workflow('build-push-images.yml');
  const tail = build.jobs['promote-prod'].steps.at(-1);
  assert.ok(tail.run.includes('git archive origin/main') && tail.run.includes('check-prod-drift.sh'));
});
test('promote-prod applies immo-mcp-config after cutover and before drift check, and reannotate targets v* tags', () => {
  const build = workflow('build-push-images.yml');
  const steps = build.jobs['promote-prod'].steps;
  const run = steps.findIndex(s => s.name === 'Sequential cutover (same manifest as rehearsal)');
  const applyCm = steps.findIndex(s => s.name === 'Apply immo-mcp-config ConfigMap (prod)');
  const drift = steps.findIndex(s => s.name === 'Check production non-Deployment drift against main (read-only)');
  assert.ok(run >= 0 && applyCm > run && drift > applyCm, 'immo-mcp-config apply runs after cutover and before drift check');
  assert.equal(steps[applyCm].env.NAMESPACE, 'radar-immobilier');
  assert.equal(steps[applyCm].run, 'bash deploy/ci/apply-prod-immo-mcp-config.sh');
  const reg = JSON.parse(readFileSync('deploy/ci/prod-cd-paths.json', 'utf8'));
  const mcpEntries = reg.cdPaths.filter(e => e.path === 'deploy/k8s/immo-mcp/40-immo-mcp-http-deploy.yaml' || e.path === 'deploy/k8s/immo-mcp/kustomization.yaml');
  assert.equal(mcpEntries.length, 2);
  for (const entry of mcpEntries) {
    assert.equal(entry.workflow, '.github/workflows/build-push-images.yml');
    assert.equal(entry.workflowRef, 'apply-prod-immo-mcp-config.sh');
    assert.ok(entry.objects.includes('ConfigMap/immo-mcp-config'));
  }
  const reann = workflow('reannotate-signals-prod.yml');
  assert.deepEqual(Object.keys(reann.on), ['workflow_dispatch']);
  assert.equal(reann.jobs.reannotate.environment, 'production');
  assert.equal(reann.jobs.reannotate.if, "startsWith(github.ref, 'refs/tags/v')");
  const reannSteps = reann.jobs.reannotate.steps;
  const reannLock = reannSteps.findIndex(s => s.uses === './deploy/cutover/lock-action' && s.with.action === 'lock' && s.with.environment === 'prod');
  const reannRun = reannSteps.findIndex(s => (s.run || '').includes('reannotate-signals-prod.sh'));
  const reannRelease = reannSteps.findIndex(s => s.uses === './deploy/cutover/lock-action' && s.with.action === 'release-lock' && s.with.environment === 'prod');
  assert.ok(reannLock >= 0 && reannRun > reannLock && reannRelease > reannRun, 'reannotate acquires lock before running Job and releases via release-lock');
  assert.equal(reannSteps[reannRelease].if, "always() && env.CUTOVER_LOCK_RUN != ''");
  assert.equal(JSON.stringify(reannSteps).includes('"unlock"'), false, 'reannotate never calls nonexistent unlock target');
});
test('bascule-bundle-cd proves lock RBAC before creating the lock and always releases it', () => {
  const w = workflow('bascule-bundle-cd.yml');
  for (const name of ['apply-bundle', 'apply-backup']) {
    const steps = w.jobs[name].steps;
    const guard = steps.findIndex(s => (s.name || '').startsWith('Assert change-lock RBAC before lock creation'));
    const acquire = steps.findIndex(s => s.uses === './deploy/cutover/lock-action' && s.with.action === 'lock');
    const release = steps.findIndex(s => s.uses === './deploy/cutover/lock-action' && s.with.action === 'release-lock');
    assert.ok(guard >= 0 && guard < acquire, `${name}: RBAC guard precedes lock creation`);
    assert.ok(steps[guard].run.includes('auth can-i') && steps[guard].run.includes('radar-change-lock'));
    for (const verb of ['create', 'get', 'update', 'delete']) assert.ok(steps[guard].run.includes(verb), `${name}: can-i ${verb}`);
    assert.ok(release > acquire && steps[release].if.includes('always()'), `${name}: release runs on failure`);
  }
  const lockEngine = readFileSync('tools/make/cutover-cluster.sh', 'utf8');
  assert.ok(lockEngine.includes('created lock released'), 'unreadable created lock is dropped, not orphaned');
  const prod = readFileSync('deploy/cutover/rbac-prod.yaml', 'utf8');
  assert.ok(prod.includes('resourceNames: [radar-change-lock]') && prod.includes('verbs: [delete]'));
  assert.equal(prod.includes('name: radar-ci-bascule-prod\n    namespace: radar-immobilier'), false,
    'bascule SA is not a subject of the cutover Role (no secret patch, deployments, ingresses, services, portforward)');
  assert.ok(prod.includes('resources: [pods/log]'), 'prod Role grants Job log reads');
  const bascule = readFileSync('deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml', 'utf8');
  assert.ok(bascule.includes('resourceNames: ["radar-change-lock"]') && bascule.includes('"get", "update", "delete"'),
    'bascule lock verbs stay name-scoped in its own Role');
  assert.equal(bascule.includes('radar-db-credentials'), false, 'bascule Role never touches the DB credentials Secret');
});
test('bascule-bundle-cd proves platform VAP enforcement via dry-run without applying VAP or ClusterRole RBAC', () => {
  const w = workflow('bascule-bundle-cd.yml');
  const steps = w.jobs['apply-bundle'].steps;
  assert.equal(steps.some(s => /vap-ci-trigger-suspend-only\.yaml|Apply VAP|VAP propagation/i.test(`${s.name || ''}\n${s.run || ''}`)), false,
    'tenant workflow never applies or sleeps on cluster-scoped VAP');
  const t1 = steps.findIndex(s => s.name === 'Apply RBAC T1 (trigger SA/Role/RoleBinding)');
  const gate = steps.findIndex(s => s.name === 'Anti-RCE gate — impersonation --dry-run=server negative test');
  assert.ok(t1 >= 0 && gate > t1, 'RBAC T1 precedes anti-RCE dry-run gate');
  const gateRun = steps[gate].run;
  assert.ok(gateRun.includes('--as="$SA"') && gateRun.includes('--dry-run=server'), 'impersonation server dry-run kept');
  assert.ok(gateRun.includes('radar-ci-trigger-suspend-only\\|jobTemplate') && gateRun.includes('{"spec":{"suspend":false}}'),
    'jobTemplate denied and suspend flip allowed checks kept');
  assert.equal(/\bkubectl\b[^\n]*\b(validatingadmissionpolic|admissionregistration)/i.test(gateRun), false,
    'dry-run gate reads zero VAP objects');
  const rbacDocs = YAML.parseAllDocuments(readFileSync('deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml', 'utf8')).map(d => d.toJSON()).filter(Boolean);
  assert.deepEqual(rbacDocs.map(d => `${d.kind}/${d.metadata.name}`), [
    'ServiceAccount/radar-ci-bascule-prod',
    'Role/radar-ci-bascule-prod',
    'RoleBinding/radar-ci-bascule-prod',
  ]);
});
test('manual migrate target requires a pinned digest and the manifest carries no dated tag', () => {
  const makefile = readFileSync('Makefile', 'utf8');
  assert.ok(makefile.includes('MIGRATE_IMAGE') && makefile.includes('@sha256:[0-9a-f]{64}'));
  const manifest = readFileSync('deploy/k8s/36-db-migrate-job.yaml', 'utf8');
  assert.equal(/radar-api:(main-|[0-9]{7})/.test(manifest), false, 'no dated image tag in the migrate manifest');
});
test('retired executable vehicles have no fallback entry', () => {
  for (const file of ['deploy/base-preprod/operator.mk', 'deploy/ci/bascule-preprod/bascule.mjs',
    'deploy/ci/bascule-preprod/restore-mode.mjs', 'tools/make/base-preprod-maintenance.sh']) assert.equal(existsSync(file), false);
  assert.equal(readFileSync('deploy/cutover/operator.mk', 'utf8').includes('include .env'), false);
});
test('backup-cd applies backup manifests and db-backup-prod without re-arming bascule', () => {
  const w = workflow('backup-cd.yml');
  assert.deepEqual(w.on.push.branches, ['main']);
  assert.deepEqual(w.on.push.tags, ['v[0-9]*']);
  for (const p of ['deploy/ci/backup/backup-daily.cjs', 'deploy/ci/backup/cronjob-backup-daily.yaml',
    'deploy/ci/backup/cronjob-backup-freshness.yaml', 'deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml',
    '.github/workflows/backup-cd.yml']) {
    assert.ok(w.on.push.paths.includes(p), `missing push path ${p}`);
  }
  assert.equal(w.on.workflow_dispatch?.inputs, undefined, 'no workflow_dispatch inputs / manual run toggle');
  const job = w.jobs.apply;
  assert.equal(job.if, "vars.BACKUP_CD_ENABLED == 'true' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'))");
  assert.equal(JSON.stringify(w).includes('BASCULE_BUNDLE_CD_ENABLED'), false, 'independent of BASCULE_BUNDLE_CD_ENABLED');
  const bascule = workflow('bascule-bundle-cd.yml');
  assert.ok(bascule.jobs['apply-bundle'].if.includes("vars.BASCULE_BUNDLE_CD_ENABLED == 'true'"), 'bascule stays separately gated');
  assert.equal(/create job|backup_run_now|--from=cronjob/.test(JSON.stringify(w.jobs)), false, 'never triggers a manual backup job');
  const names = job.steps.map(s => s.name || '');
  const preflight = names.findIndex(n => n.startsWith('Pre-flight'));
  const rbac = names.findIndex(n => n.startsWith('Assert change-lock and backup target RBAC'));
  const lock = job.steps.findIndex(s => s.uses === './deploy/cutover/lock-action' && s.with.action === 'lock');
  const apply = names.findIndex(n => n.startsWith('Apply script ConfigMap and backup CronJobs'));
  const release = job.steps.findIndex(s => s.uses === './deploy/cutover/lock-action' && s.with.action === 'release-lock');
  assert.ok(preflight >= 0 && preflight < rbac && rbac < lock && lock < apply && apply < release, 'fail-closed step ordering');
  assert.ok(job.steps[apply].run.includes('radar-backup-daily-script') && job.steps[apply].run.includes('cronjob-db-backup-prod.yaml'));
  for (const want of ['23 2 * * *|false|Forbid|false', '53 6 * * *|false|Forbid|false', '*/5 * * * *|true|Forbid|false']) {
    assert.ok(job.steps[apply].run.includes(want), `post-apply verification includes ${want}`);
  }
});
