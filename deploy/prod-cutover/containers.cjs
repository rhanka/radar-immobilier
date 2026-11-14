/* global require, module, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
const LABEL = 'ca.sent-tech.immo.cutover-run';
function ids(run) {
  if (!/^[0-9a-f-]{36}$/.test(run || '')) r.fail('container_run_required');
  // Include created, paused and restarting containers: they may still write later.
  return r.run('docker', ['ps', '-aq', '--filter', `label=${LABEL}=${run}`],
    { timeout: 15000 }).trim().split(/\s+/).filter(Boolean);
}
function stop(run) {
  for (const id of ids(run)) {
    // Auto-removal may race these calls. Only a successful fresh listing proves absence.
    try {
      const state = r.run('docker', ['inspect', '--format={{.State.Status}}', id], { timeout: 15000 }).trim();
      if (state === 'created') r.run('docker', ['rm', '-f', id], { timeout: 15000 });
      else {
        r.run('docker', ['stop', '--time=5', id], { timeout: 15000 });
        r.run('docker', ['wait', id], { timeout: 15000 });
        r.run('docker', ['rm', id], { timeout: 15000 });
      }
    } catch { /* A concurrent --rm is accepted only after confirmed disappearance below. */ }
    const deadline = Date.now() + 5000;
    while (ids(run).includes(id)) {
      if (Date.now() >= deadline) r.fail('run_container_termination_unknown');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  if (ids(run).length) r.fail('run_containers_still_present');
}
function guard(run) {
  if (r.env.STOP_RUN_CONTAINERS === '1') stop(run);
  if (ids(run).length) r.fail('run_containers_still_present');
}
if (require.main === module) {
  try { (process.argv[2] === 'stop' ? stop : guard)(process.argv[3] || r.env.RUN); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { LABEL, guard, stop };
