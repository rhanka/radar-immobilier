// Pilot budget guard (plan v3 owner decision D5): hard cap of 22,000 model calls over the
// whole pilot. Every seat caller appends one record per call to $CLASSIF_HOME/l2/calls.jsonl
// (run.mjs, amend.mjs, probe.mjs, l4/*); spent() counts those records and check() refuses any
// planned batch that would exceed the cap. The chain calls check() before every pass.
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { classifHome } from './paths.mjs';

export const BUDGET_CAP = 22000;
export const CALLS_LOG = 'l2/calls.jsonl';

/**
 * Number of model calls spent so far. STRICT (review §5): any blank-excluded line that
 * is not valid JSON throws — a corrupt log must fail closed, never under-count. Intent
 * records (written BEFORE the paid call) count; result records (intent:false, written
 * after) do not double-count. Legacy records without an intent flag count (one line = one call).
 */
export function spent(home = classifHome()) {
  return readCallsStrict(home).filter((r) => r?.intent !== false).length;
}

function readCallsStrict(home) {
  const f = path.join(home, CALLS_LOG);
  if (!existsSync(f)) return [];
  const raw = readFileSync(f, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { throw new Error(`pilot budget refused: corrupt calls log line (${line.slice(0, 80)}…): refusing to under-count`); }
  }
  return out;
}

/** Per-phase breakdown, for the manifest (strict: see spent). */
export function spentByPhase(home = classifHome()) {
  const out = {};
  for (const r of readCallsStrict(home).filter((r) => r?.intent !== false)) {
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
