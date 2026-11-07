// Pilot budget guard (plan v3 owner decision D5, raised to 30,000 by the owner on 2026-11-06
// for the GEPA series): hard cap of 30,000 model calls over the
// whole pilot. Every seat caller appends one record per call to $CLASSIF_HOME/l2/calls.jsonl
// (run.mjs, amend.mjs, probe.mjs, l4/*); spent() counts those records and check() refuses any
// planned batch that would exceed the cap. The chain calls check() before every pass.
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { classifHome } from './paths.mjs';

export const BUDGET_CAP = 30000;
export const CALLS_LOG = 'l2/calls.jsonl';

/**
 * Number of model calls spent so far. STRICT (review §5) with a kill-tolerant tail
 * (review N1): every line but the last non-empty one must parse — any earlier corrupt
 * line throws (fail closed, never under-count). A corrupt LAST line is a kill-truncated
 * append: it counts as 1 when it begins an intent record, 0 when it is a result
 * (intent:false), so resume never dies on a torn write. Intent records (written BEFORE
 * the paid call) count; result records (intent:false) do not double-count. Legacy
 * records without an intent flag count (one line = one call). Existing intent/result
 * lines still parse unchanged (backward-compatible with a running pass).
 */
export function spent(home = classifHome()) {
  return readCallsStrict(home).filter((r) => r?.intent !== false).length;
}

function readCallsStrict(home) {
  const f = path.join(home, CALLS_LOG);
  if (!existsSync(f)) return [];
  const raw = readFileSync(f, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const last = i === lines.length - 1;
    try {
      out.push(JSON.parse(line));
    } catch {
      if (!last) throw new Error(`pilot budget refused: corrupt calls log line ${i + 1} (${line.slice(0, 80)}…): refusing to under-count`);
      // N1: truncated last line from a kill mid-append — tolerated, counted fail-closed.
      if (/"intent"\s*:\s*false/.test(line)) continue;
      out.push({ intent: true, phase: 'truncated', truncated: true });
    }
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

/** Calls spent by the phases named `prefix…` (intent records only, strict read: see spent). */
export function spentByPrefix(home, prefix) {
  return readCallsStrict(home).filter((r) => r?.intent !== false && String(r?.phase ?? '').startsWith(prefix)).length;
}

/**
 * Run-scoped cap (GEPA MAX_CALLS): the calls of one run are the intent records whose phase
 * starts with `prefix`; the run may spend at most `cap` of them AND stays under the pilot cap
 * (D5). `remaining()` is the smaller of both margins; `check(planned)` throws (fail closed)
 * when a planned batch would exceed either. A resumed run counts its earlier calls.
 */
export function runBudget(home, { prefix, cap, pilotCap = BUDGET_CAP }) {
  if (!prefix) throw new Error('run budget refused: a phase prefix is required');
  if (!Number.isInteger(cap) || cap <= 0) throw new Error(`run budget refused: cap must be a positive integer (got ${cap})`);
  const state = () => {
    const runSpent = spentByPrefix(home, prefix);
    const pilotSpent = spent(home);
    return { runSpent, pilotSpent, remaining: Math.min(cap - runSpent, pilotCap - pilotSpent) };
  };
  return {
    prefix, cap,
    spent: () => state().runSpent,
    remaining: () => state().remaining,
    fits: (planned) => planned <= state().remaining,
    check(planned) {
      const s = state();
      if (planned > s.remaining) {
        throw new Error(`run budget refused: ${s.runSpent} run calls spent (cap ${cap}), ${s.pilotSpent} pilot calls spent (cap ${pilotCap}), ${planned} planned > remaining ${s.remaining}`);
      }
      return { ...s, planned, remaining: s.remaining - planned };
    },
  };
}
