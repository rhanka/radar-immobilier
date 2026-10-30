// Rehearsal verdict (owner requirements R1/R4): evaluates the read probe, the writer probe,
// the cutover receipt and the acknowledged-write ranges read back from each database.
// Usage: node deploy/cutover/probe-verify.mjs <availability.jsonl> <writes.jsonl> <receipt.json> <ranges.json> <samedb|preprod>
import { readFileSync, existsSync } from 'node:fs';
import process from 'node:process';
const SKEW_MS = 250;        // runner clock vs PostgreSQL clock
const PROPAGATION_MS = 1000; // routing settles within the measured mixed window
const ms = iso => (iso ? Date.parse(iso) : NaN);
const within = (t, [a, b]) => t >= a && t <= b;
export function evaluate({ availability, writes, receipt, ranges, mode }) {
  const violations = {};
  const flag = (rule, sample) => { (violations[rule] ||= { count: 0, sample }).count += 1; };
  const switches = receipt.switches || [];
  const green = ms(receipt.firstGreenAt);
  const frozen = ms(receipt.frozenAt);
  const drill = receipt.drill && switches.length >= 4 ? [ms(switches[1].at) - PROPAGATION_MS, ms(switches[2].at) + PROPAGATION_MS] : null;
  const release = { '/health': receipt.release.apiServedSha, '/build.json': receipt.release.uiServedSha };
  const previous = { '/health': receipt.previousRelease?.apiServedSha, '/build.json': receipt.previousRelease?.uiServedSha };
  // R1: reads never fail, never stall, and serve the release once the switch is green.
  const last = {};
  for (const r of availability) {
    if (r.code === 0) flag('read-error', r);
    else if (r.code >= 500) flag('read-5xx', r);
    if (r.ms > 1000) flag('read-stall', r);
    if (last[r.path] !== undefined && r.t - last[r.path] > 1000 + 200) flag('probe-gap', r);
    last[r.path] = r.t;
    if (r.code === 200 && release[r.path]) {
      const expectRelease = r.t > green + PROPAGATION_MS && !(drill && within(r.t, drill));
      if (expectRelease ? r.sha !== release[r.path] : ![release[r.path], previous[r.path]].includes(r.sha)) flag('sha-mismatch', r);
    }
  }
  // R4: no lost write; same database: no refusal at all; preprod: only explicit 503 in the freeze window.
  const freezeWindow = [ms(receipt.freezeStartedAt ?? receipt.frozenAt) - SKEW_MS, green + PROPAGATION_MS];
  for (const w of writes) {
    if (w.code === 200) {
      if (!w.db || !(ranges[w.db] || []).some(([a, b]) => w.seq >= a && w.seq <= b)) flag('lost-write', w);
      if (mode === 'preprod' && w.db === receipt.liveDb && w.t > frozen + SKEW_MS) flag('ack-after-freeze', w);
      continue;
    }
    const explicit = w.code === 503 && w.error === 'maintenance_read_only';
    if (mode === 'samedb' || !explicit) flag(w.code === 0 ? 'write-error' : w.code >= 500 ? 'write-5xx' : 'write-refused', w);
    else if (!(within(w.t, freezeWindow) || (drill && within(w.t, drill)))) flag('write-503-outside-freeze', w);
  }
  // A rollback abandons the writes acknowledged by the database it leaves: they must be detected.
  const abandonedProbeWrites = receipt.abandoned ? writes.filter(w => w.code === 200 && w.db === receipt.abandoned.db).length : 0;
  if (abandonedProbeWrites > 0 && !(receipt.abandoned.tuples > 0 || receipt.abandoned.tuples === -1)) {
    flag('abandoned-undetected', { abandonedProbeWrites, abandoned: receipt.abandoned });
  }
  for (const s of switches) if (!(s.mixedWindowMs <= 2000)) flag('mixed-window', s);
  if (mode === 'preprod' && !(receipt.freezeWindowMs <= 10000)) flag('freeze-window', { freezeWindowMs: receipt.freezeWindowMs });
  if (receipt.drill && !(receipt.drill.backMs <= 5000)) flag('drill-back', receipt.drill);
  const acked = writes.filter(w => w.code === 200).length;
  return { ok: Object.keys(violations).length === 0, violations,
    stats: { reads: availability.length, writes: writes.length, acked, refused503: writes.filter(w => w.code === 503).length,
      freezeWindowMs: receipt.freezeWindowMs ?? null, mixedWindowMs: switches.map(s => s.mixedWindowMs),
      abandonedProbeWrites, abandonedTuples: receipt.abandoned?.tuples ?? null } };
}
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
if (import.meta.url === `file://${process.argv[1]}`) {
  const [availability, writes, receipt, ranges, mode] = process.argv.slice(2);
  const verdict = evaluate({ availability: lines(availability), writes: lines(writes), receipt: JSON.parse(readFileSync(receipt, 'utf8')),
    ranges: JSON.parse(readFileSync(ranges, 'utf8')), mode });
  process.stdout.write(`${JSON.stringify(verdict, null, 1)}\n`);
  process.exitCode = verdict.ok ? 0 : 1;
}
