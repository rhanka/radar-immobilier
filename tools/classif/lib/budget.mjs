// Pilot budget guard (plan v3 owner decision D5): hard cap of 22,000 model calls over the
// whole pilot. Every seat caller appends one record per call to $CLASSIF_HOME/l2/calls.jsonl
// (run.mjs, amend.mjs, probe.mjs, l4/*); spent() counts those records and check() refuses any
// planned batch that would exceed the cap. The chain calls check() before every pass.
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { classifHome } from './paths.mjs';
import { parseJsonlTolerant } from './jsonl.mjs';

export const BUDGET_CAP = 22000;
export const CALLS_LOG = 'l2/calls.jsonl';

/** Number of model calls spent so far (records in the calls log). */
export function spent(home = classifHome()) {
  const f = path.join(home, CALLS_LOG);
  if (!existsSync(f)) return 0;
  return parseJsonlTolerant(readFileSync(f, 'utf8')).length;
}

/** Per-phase breakdown, for the manifest. */
export function spentByPhase(home = classifHome()) {
  const f = path.join(home, CALLS_LOG);
  if (!existsSync(f)) return {};
  const out = {};
  for (const r of parseJsonlTolerant(readFileSync(f, 'utf8'))) {
    const key = r?.phase ?? (r?.pass !== undefined ? `pass${r.pass}` : 'unknown');
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * Fail closed: throws when planned additional calls would exceed the cap.
 * Returns { spent, planned, remaining } otherwise.
 */
export function check(home, planned, { cap = BUDGET_CAP } = {}) {
  const s = typeof home === 'number' ? home : spent(home);
  const remaining = cap - s;
  if (planned > remaining) {
    throw new Error(`pilot budget refused: ${s} calls spent + ${planned} planned > cap ${cap} (remaining ${remaining})`);
  }
  return { spent: s, planned, remaining: remaining - planned };
}
