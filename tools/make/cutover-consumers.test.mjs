// Consumer inventory (tools/make/cutover-consumers.jq): pods of this run's
// operation Jobs are known, including Jobs moved to history by a retry
// (operation e776ee55, 2026-11-16: retried catalogue Job during reopening).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = 'e776ee55-45d0-4cb8-918c-be993e0cf1ed';
const job = (name, uid, hash) => ({ metadata: { name, uid, annotations: { 'cutover-spec-sha256': hash } }, status: {} });
const pod = (name, jobUid) => ({ metadata: { name, uid: `pod-${name}`, ownerReferences: [{ kind: 'Job', controller: true, uid: jobUid }] },
  status: { phase: 'Running' } });
function unknown(record, jobs, pods) {
  const dir = mkdtempSync(join(tmpdir(), 'consumers-'));
  try {
    for (const [f, v] of Object.entries({ 'record.json': record, 'jobs.json': { items: jobs }, 'rs.json': { items: [] }, 'pods.json': { items: pods } })) {
      writeFileSync(join(dir, f), JSON.stringify(v));
    }
    const r = spawnSync('jq', ['--slurpfile', 'jobs', join(dir, 'jobs.json'), '--slurpfile', 'rs', join(dir, 'rs.json'),
      '--slurpfile', 'r', join(dir, 'record.json'), '--arg', 'run', run, '-f', 'tools/make/cutover-consumers.jq', join(dir, 'pods.json')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).filter(c => !c.known).map(c => c.name);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('pods of current and retried (history) operation Jobs are known; foreign Jobs are not', () => {
  const first = `cutover-${run}-catalogue`, retry = `cutover-${run}-1-catalogue`;
  const record = { jobs: { catalogue: { name: retry, uid: 'u-retry', hash: 'h2', outcome: 'started' } },
    jobHistory: [{ name: first, uid: 'u-first', hash: 'h1', outcome: 'failed' }], cronjobs: [], deployments: [] };
  const jobs = [job(first, 'u-first', 'h1'), job(retry, 'u-retry', 'h2'), job('someone-else', 'u-x', 'hx')];
  const pods = [pod(`${first}-4gb27`, 'u-first'), pod(`${retry}-9t2fd`, 'u-retry'), pod('someone-else-abcde', 'u-x')];
  assert.deepEqual(unknown(record, jobs, pods).sort(), ['someone-else', 'someone-else-abcde']);
});
