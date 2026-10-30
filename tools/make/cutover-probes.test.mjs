/* global Response */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate } from '../../deploy/cutover/probe-verify.mjs';
import { probeOnce } from '../../deploy/cutover/availability-probe.mjs';
import { writeOnce } from '../../deploy/cutover/writer-probe.mjs';
import { fixture } from './cutover-fixture.mjs';
const T0 = Date.parse('2026-10-30T12:00:00.000Z');
const iso = dt => new Date(T0 + dt).toISOString();
const NEW = 'a'.repeat(40), OLD = '9'.repeat(40);
const receipt = (extra = {}) => ({ release: { apiServedSha: NEW, uiServedSha: NEW.slice(0, 7) },
  previousRelease: { apiServedSha: OLD, uiServedSha: OLD.slice(0, 7) }, liveDb: 'radar', targetDb: 'radar_next',
  freezeStartedAt: iso(0), frozenAt: iso(300), firstGreenAt: iso(4000), freezeWindowMs: 4000,
  switches: [{ to: 'prepared', at: iso(2000), mixedWindowMs: 900 }, { to: 'main', at: iso(60000), mixedWindowMs: 800 }], ...extra });
// A clean preprod run: reads every 200 ms, old then new build; writes acked by radar, 503 while frozen, then radar_next.
function clean() {
  const availability = [], writes = [];
  for (let dt = -3000; dt <= 8000; dt += 200) {
    const sha = dt < 3500 ? OLD : NEW;
    availability.push({ t: T0 + dt, path: '/health', code: 200, ms: 40, sha });
    availability.push({ t: T0 + dt, path: '/build.json', code: 200, ms: 30, sha: sha.slice(0, 7) });
  }
  let seq = 0;
  for (let dt = -3000; dt <= 8000; dt += 200) {
    seq += 1;
    if (dt < 0) writes.push({ t: T0 + dt, seq, code: 200, db: 'radar' });
    else if (dt < 4000) writes.push({ t: T0 + dt, seq, code: 503, error: 'maintenance_read_only' });
    else writes.push({ t: T0 + dt, seq, code: 200, db: 'radar_next' });
  }
  const ranges = { radar: [[1, 15]], radar_next: [[36, 56]] };
  return { availability, writes, ranges };
}
test('a clean preprod rehearsal passes: old build before green, explicit 503 only while frozen, no lost write', () => {
  const { availability, writes, ranges } = clean();
  const verdict = evaluate({ availability, writes, receipt: receipt(), ranges, mode: 'preprod' });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.violations));
  assert.equal(verdict.stats.refused503, 20);
});
test('fixtures: sha flip, 502, stall, acked-then-missing write, 503 outside the freeze, long freeze, mixed window', () => {
  const cases = [
    ['sha-mismatch', d => { d.availability.at(-1).sha = OLD; }],
    ['read-5xx', d => { d.availability[10].code = 502; }],
    ['read-stall', d => { d.availability[12].ms = 1500; }],
    ['read-error', d => { Object.assign(d.availability[14], { code: 0, error: 'connection' }); }],
    ['lost-write', d => { d.ranges.radar_next = [[36, 50]]; }],
    ['ack-after-freeze', d => { Object.assign(d.writes[20], { code: 200, db: 'radar', error: undefined }); d.ranges.radar = [[1, 21]]; }],
    ['write-503-outside-freeze', d => { Object.assign(d.writes.at(-1), { code: 503, error: 'maintenance_read_only' }); }],
    ['write-5xx', d => { Object.assign(d.writes[2], { code: 500 }); }],
    ['freeze-window', d => { d.receipt.freezeWindowMs = 10001; }],
    ['mixed-window', d => { d.receipt.switches[0].mixedWindowMs = 2100; }],
  ];
  for (const [rule, mutate] of cases) {
    const d = { ...clean(), receipt: receipt() };
    mutate(d);
    const verdict = evaluate({ ...d, mode: 'preprod' });
    assert.equal(verdict.ok, false, rule);
    assert.ok(verdict.violations[rule], `${rule}: ${JSON.stringify(Object.keys(verdict.violations))}`);
  }
});
test('the same-database path tolerates no refusal at all', () => {
  const { availability, ranges } = clean();
  const writes = [{ t: T0, seq: 1, code: 200, db: 'radar' }, { t: T0 + 200, seq: 2, code: 503, error: 'maintenance_read_only' }];
  const verdict = evaluate({ availability, writes, receipt: receipt({ freezeWindowMs: undefined }), ranges: { ...ranges, radar: [[1, 1]] }, mode: 'samedb' });
  assert.deepEqual(Object.keys(verdict.violations), ['write-5xx']);
});
test('probes record status, build SHA, transport errors and timeouts', async () => {
  const ok = await probeOnce('https://x', '/health', async () => new Response(JSON.stringify({ sha: NEW }), { status: 200 }));
  assert.deepEqual([ok.code, ok.sha], [200, NEW]);
  const down = await probeOnce('https://x', '/health', async () => { throw new TypeError('fetch failed'); });
  assert.deepEqual([down.code, down.error], [0, 'connection']);
  const frozen = await writeOnce('https://x', 'r1', 3, 't'.repeat(32), async (url, init) => {
    assert.equal(url, 'https://x/api/internal/cutover-probe');
    assert.deepEqual(JSON.parse(init.body), { run: 'r1', seq: 3 });
    return new Response(JSON.stringify({ error: 'maintenance_read_only' }), { status: 503 });
  });
  assert.deepEqual([frozen.code, frozen.error], [503, 'maintenance_read_only']);
});
test('probe-verify reads acknowledged write ranges back through a Job', () => {
  const f = fixture({ probeRanges: { radar: [[1, 15]], radar_next: [[36, 56]] } });
  try {
    const out = join(f.dir, 'out');
    const result = f.run('probe-verify', ['PROBE=rehearsal-1', `OUTPUT=${out}`]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'probe-ranges.json'), 'utf8')), { radar: [[1, 15]], radar_next: [[36, 56]] });
    const job = f.state().objects.find(o => o.kind === 'Job' && o.metadata.name.endsWith('-probeverify'));
    assert.equal(job.spec.template.spec.containers[0].env.find(e => e.name === 'PROBE_RUN').value, 'rehearsal-1');
  } finally { f.cleanup(); }
});
test('writes acknowledged by an abandoned database must be detected by the receipt', () => {
  const { availability, writes, ranges } = clean();
  const undetected = evaluate({ availability, writes, receipt: receipt({ abandoned: { db: 'radar', tuples: 0 } }), ranges, mode: 'preprod' });
  assert.ok(undetected.violations['abandoned-undetected']);
  assert.equal(undetected.stats.abandonedProbeWrites, 15);
  const detected = evaluate({ availability, writes, receipt: receipt({ abandoned: { db: 'radar', tuples: 15 } }), ranges, mode: 'preprod' });
  assert.equal(detected.violations['abandoned-undetected'], undefined);
});
