/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
const PROJECT = 'radar-prod-copy-owner';
const NETWORK = `${PROJECT}_copy-only`;
function stoppedSnapshot() {
  const ids = r.run('docker', ['ps', '-aq', '--filter', `network=${NETWORK}`]).trim().split(/\s+/).filter(Boolean);
  if (!ids.length) r.fail('local_copy_network_required');
  const containers = JSON.parse(r.run('docker', ['inspect', ...ids]));
  const db = containers.filter(c => c.Config.Labels['com.docker.compose.project'] === PROJECT
    && c.Config.Labels['com.docker.compose.service'] === 'postgres');
  if (db.length !== 1 || !db[0].State.Running) r.fail('local_copy_database_required');
  const consumers = containers.filter(c => c.Id !== db[0].Id);
  if (!consumers.length) r.fail('local_baseline_proof_required');
  if (consumers.some(c => c.State.Running || c.State.Restarting || c.State.Paused)) r.fail('local_consumers_not_terminated');
  if (r.run('docker', ['ps', '-q', '--filter', 'name=immo-6h-']).trim()) r.fail('local_hook_not_terminated');
  return { network: NETWORK, databaseContainer: db[0].Id,
    containers: consumers.map(c => ({ id: c.Id, finishedAt: c.State.FinishedAt, exitCode: c.State.ExitCode })) };
}
function observe() {
  if (r.env.ENV !== 'rehearsal') r.fail('local_evidence_only');
  const snapshot = stoppedSnapshot();
  const runFile = r.path.join(r.output(), 'local-run.json');
  const run = r.fs.existsSync(runFile) ? r.json(runFile).run : r.crypto.randomUUID();
  r.save('local-run', { run });
  const proof = { run, release: r.SHA, instances: snapshot.containers.map(c => c.id),
    completedAt: new Date().toISOString(), localTermination: snapshot };
  r.save('local-evidence', proof);
  return proof;
}
function verify(e) {
  if (r.env.ENV !== 'rehearsal' || !e.localTermination) r.fail('local_termination_proof_required');
  if (JSON.stringify(e.localTermination) !== JSON.stringify(stoppedSnapshot())
    || JSON.stringify(e.instances) !== JSON.stringify(e.localTermination.containers.map(c => c.id)))
    r.fail('local_termination_proof_changed');
}
module.exports = { observe, verify };
