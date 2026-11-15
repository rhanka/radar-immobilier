// Multi-pass aggregation (owner 15/11, series 15): every item is called N times on the same route
// (independent passes, same frozen prompt and parsing), then the passes are combined by a rule
// PRE-REGISTERED in the series manifest (`passes`):
//   - the DECISION rule scores the route (verdict, aggregates): `union` of the first `of` passes —
//     an item is shown when any of those passes shows it;
//   - INFORMATION rules are reported beside it, never used for the verdict: `majority` of the first
//     `of` passes (shown when more than half show it), or a single pass.
// Fail closed: a combined row is failed when one of its passes failed (a failed call counts as
// shown in the metrics and in the failure share). Pure functions, no disk, no model call.
import { isShownPred } from './metrics.mjs';

export const PASS_RULES = new Set(['union', 'majority', 'single']);

/**
 * Pass plan of a series manifest, or null for a single-pass series. Shape:
 * `passes: { count: N, decision: { rule: 'union', of: 2 }, info: [{ rule: 'majority', of: 3 }] }`.
 */
export function passPlan(seriesSpec) {
  const p = seriesSpec?.passes;
  if (p === undefined || p === null) return null;
  const n = p.count;
  if (!Number.isInteger(n) || n < 2 || n > 5) throw new Error('series passes refused: count must be an integer in [2,5]');
  const check = (r, what) => {
    if (!r || !PASS_RULES.has(r.rule) || !Number.isInteger(r.of) || r.of < 1 || r.of > n) throw new Error(`series passes refused: ${what} must be {rule: union|majority|single, of: 1..${n}}`);
    if (r.rule === 'single' && !(r.of === 1 && Number.isInteger(r.pass) && r.pass >= 1 && r.pass <= n)) throw new Error(`series passes refused: ${what} single needs of 1 and pass 1..${n}`);
    return r;
  };
  return { count: n, decision: check(p.decision, 'decision'), info: (p.info ?? []).map((r, i) => check(r, `info[${i}]`)) };
}

/** Label of a rule (`union-2`, `majority-3`, `pass-1`). */
export const ruleLabel = (r) => (r.rule === 'single' ? `pass-${r.pass}` : `${r.rule}-${r.of}`);

/**
 * Combines the pass rows of one item ([row of pass 1, row of pass 2, ...]; a row is
 * { failed, why, pred: {verdict, code} | null, ...item fields }) by a rule. Item fields come from
 * the first pass row; `passVerdicts` keeps each pass verdict (null when failed).
 */
export function combinePasses(passRows, rule) {
  const used = rule.rule === 'single' ? [passRows[rule.pass - 1]] : passRows.slice(0, rule.of);
  if (used.length < rule.of || used.some((r) => !r)) throw new Error(`combinePasses: ${ruleLabel(rule)} needs ${rule.of} pass rows`);
  const base = { ...used[0], passVerdicts: used.map((r) => (r.failed ? null : r.pred?.verdict ?? null)) };
  const failed = used.find((r) => r.failed);
  if (failed) return { ...base, failed: true, why: failed.why ?? 'pass-failed', pred: null };
  const shown = used.filter((r) => isShownPred(r.pred));
  const isShown = rule.rule === 'union' ? shown.length > 0 : rule.rule === 'majority' ? shown.length * 2 > used.length : shown.length === 1;
  // The shown (or not shown) pass whose answer represents the combined row: the first one.
  const pick = (isShown ? shown : used.filter((r) => !isShownPred(r.pred)))[0];
  return { ...base, failed: false, why: null, pred: pick.pred };
}

/** Every rule of the plan (decision first) with its label: [{ label, rule, decision }]. */
export function planRules(plan) {
  return [{ label: ruleLabel(plan.decision), rule: plan.decision, decision: true },
    ...plan.info.map((r) => ({ label: ruleLabel(r), rule: r, decision: false }))];
}
