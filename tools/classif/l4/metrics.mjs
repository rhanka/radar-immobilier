// Annex M implementation (plan v3 D4, tools/classif/l4/ANNEX-M.md): pure functions over
// { reference, prediction } pairs. No model call, no disk read.
const SHOWN = new Set(['pertinent', 'a_surveiller']);

/** Binomial CDF P(X ≤ k) by term recurrence (n ≤ a few thousand: no overflow). */
export function binomCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  let term = Math.pow(1 - p, n);
  let sum = term;
  for (let i = 0; i < k; i++) {
    term *= (p / (1 - p)) * ((n - i) / (i + 1));
    sum += term;
  }
  return Math.min(1, sum);
}

/** Exact one-sided Clopper–Pearson upper bound: smallest p with P(X ≤ k) ≤ alpha. */
export function cpUpper(k, n, alpha = 0.05) {
  if (n === 0) return 1;
  if (k >= n) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (binomCdf(k, n, mid) <= alpha) hi = mid; else lo = mid;
  }
  return hi;
}

/** Exact one-sided Clopper–Pearson lower bound: largest p with P(X ≥ k) ≤ alpha. */
export function cpLower(k, n, alpha = 0.05) {
  if (n === 0) return 0;
  if (k <= 0) return 0;
  return 1 - cpUpper(n - k, n, alpha);
}

export const isShownRef = (verdict) => SHOWN.has(verdict);
// A prediction shows the case when it says P/S, fails, or leaves the input unread.
export const isShownPred = (p) => !p || p.failed === true || p.unread === true || SHOWN.has(p.verdict);

/**
 * Shown recall/precision of one route on resolved reference rows.
 * Rows: { ref (verdict|null), pred ({verdict, failed, unread}|null), unresolved (bool) }.
 * Unresolved rows are excluded from every denominator (Annex M M.1).
 */
export function shownStats(rows, { recallSupport = 30, precisionSupport = 30 } = {}) {
  const scored = rows.filter((r) => !r.unresolved && r.ref);
  const refShown = scored.filter((r) => isShownRef(r.ref));
  const predShown = scored.filter((r) => isShownPred(r.pred));
  const hit = refShown.filter((r) => isShownPred(r.pred)).length;
  const trueShown = predShown.filter((r) => isShownRef(r.ref) && SHOWN.has(r.pred?.verdict)).length;
  const recall = refShown.length ? hit / refShown.length : null;
  const precision = predShown.length ? trueShown / predShown.length : null;
  return {
    scored: scored.length, refShown: refShown.length, predShown: predShown.length,
    recall, recallLB: recall === null ? null : cpLower(hit, refShown.length),
    precision, precisionLB: precision === null ? null : cpLower(trueShown, predShown.length),
    indeterminate: { recall: refShown.length < recallSupport, precision: predShown.length < precisionSupport },
  };
}

/** Pertinent masked on S113 (secondary, diagnostic, outside selection): k masked of n P. */
export function pertinentMasked(masked, pTotal) {
  return { masked, pTotal, rate: pTotal ? masked / pTotal : null, upper95: cpUpper(masked, pTotal) };
}

/** Cohen's κ over a fixed category list; pairs with a missing side are excluded. */
export function cohenKappa(pairs, categories) {
  const kept = pairs.filter(([a, b]) => categories.includes(a) && categories.includes(b));
  const n = kept.length;
  if (!n) return { kappa: null, n: 0 };
  const agree = kept.filter(([a, b]) => a === b).length;
  const po = agree / n;
  const pa = {};
  const pb = {};
  for (const [a, b] of kept) { pa[a] = (pa[a] ?? 0) + 1; pb[b] = (pb[b] ?? 0) + 1; }
  const pe = categories.reduce((s, c) => s + ((pa[c] ?? 0) / n) * ((pb[c] ?? 0) / n), 0);
  return { kappa: pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe), n, po, pe };
}

/** Exact two-sided McNemar p-value on discordant pairs (b: ref-only, c: pred-only). */
export function mcnemar(b, c) {
  const n = b + c;
  if (!n) return { b, c, p: 1 };
  // 2 * P(X ≤ min(b,c)), X ~ Bin(n, 1/2), via the binomial pmf in log domain.
  const k = Math.min(b, c);
  let p = 0;
  for (let i = 0; i <= k; i++) {
    let l = 0;
    for (let j = 1; j <= i; j++) l += Math.log(n - i + j) - Math.log(j);
    p += Math.exp(l - n * Math.LN2);
  }
  return { b, c, p: Math.min(1, 2 * p) };
}

/**
 * χ² of a 2-group count split (a, b) against the even expectation (a+b)/2, df = 1.
 * Used per stratum of the 50/50 balance report. 0/0 → { chi2: 0 }.
 */
export function chiSquareHalves(a, b) {
  if (a + b === 0) return { a, b, expected: 0, chi2: 0 };
  const e = (a + b) / 2;
  return { a, b, expected: e, chi2: ((a - e) ** 2 + (b - e) ** 2) / e };
}

/**
 * Series verdict (Annex M M.2, review §9): `pass` if shown-recall AND shown-precision pass
 * (lower bounds ≥ floors); `fail` if either fails or the failure share exceeds the
 * pre-registered ceiling; `indeterminate` otherwise (supports unmet). Failures stay in
 * every denominator.
 * Recall non-regression (owner rule 06/11, manifests declaring `recallNonRegression`): when
 * `spec.baselineRecall` is a number, a recall point estimate below it (minus
 * `spec.recallTolerance`) is `fail`, whatever the precision or the supports. Specs without
 * a baseline (series 0-2) are unchanged.
 */
export function seriesVerdict({ stats, failures, items }, spec) {
  const ceiling = spec?.failureCeiling ?? 0.1;
  if (items && failures / items > ceiling) return 'fail';
  if (recallRegressed(stats?.recall, spec?.baselineRecall, spec?.recallTolerance ?? 0)) return 'fail';
  if (stats?.indeterminate?.recall || stats?.indeterminate?.precision) return 'indeterminate';
  const rf = spec?.recallFloor ?? 0;
  const pf = spec?.precisionFloor ?? 0;
  if ((stats?.recallLB ?? -1) >= rf && (stats?.precisionLB ?? -1) >= pf) return 'pass';
  if ((stats?.recallLB ?? 1) < rf || (stats?.precisionLB ?? 1) < pf) return 'fail';
  return 'indeterminate';
}

/**
 * A route is failed when its verdict is `fail` or its failure share exceeds the
 * pre-registered ceiling (review D4). Routes without shaped failure evidence
 * (legacy unit-test objects) count as eligible: the rule only ever demotes.
 */
export function routeFailed(r) {
  if (!r || typeof r !== 'object') return false;
  if (r.verdict === 'fail') return true;
  const ceiling = r.failureCeiling ?? null;
  const items = r.items ?? null;
  const failures = r.failures ?? 0;
  if (ceiling !== null && ceiling !== undefined && items) return failures / items > ceiling;
  return false;
}

/**
 * Lexicographic selection (Annex M M.3, tuning half only): eligible routes first
 * (a route failing the failure ceiling or with verdict `fail` never outranks an
 * eligible one), then shown recall (LB, then point), shown precision (LB, then
 * point), most recent prompt version, lowest cost. Returns <0 when `a` ranks
 * first. Routes indeterminate on the compared criterion never outrank a passing one.
 */
export function compareRoutes(a, b) {
  const af = routeFailed(a);
  const bf = routeFailed(b);
  if (af && !bf) return 1;
  if (bf && !af) return -1;
  for (const k of ['recallLB', 'recall', 'precisionLB', 'precision']) {
    const x = a.stats?.[k];
    const y = b.stats?.[k];
    const xi = k.startsWith('recall') ? a.stats?.indeterminate?.recall : a.stats?.indeterminate?.precision;
    const yi = k.startsWith('recall') ? b.stats?.indeterminate?.recall : b.stats?.indeterminate?.precision;
    if (xi && !yi) return 1;
    if (yi && !xi) return -1;
    if (x !== y && x !== null && y !== null && x !== undefined && y !== undefined) return y - x;
  }
  if (a.promptVersion !== b.promptVersion) return (b.promptVersion ?? '').localeCompare(a.promptVersion ?? '');
  return (a.costUsd ?? 0) - (b.costUsd ?? 0);
}

/**
 * Recall misses (owner rule 06/11): the ONLY penalised error is a reference P/S item predicted
 * non_pertinent (écarté). Rows in the dev-output shape { itemId, ref, refVerdict, unresolved,
 * pred, failed }; a failure counts as shown (never a miss), P↔S confusion is not a miss.
 */
export function shownMisses(rows) {
  return (rows ?? []).filter((r) => !r.unresolved && isShownRef(r.refVerdict) && !isShownPred(r.failed ? { failed: true } : r.pred));
}

/** true when `recall` is below the baseline recall minus the tolerance (both point estimates). */
export function recallRegressed(recall, baselineRecall, tolerance = 0) {
  if (typeof recall !== 'number' || typeof baselineRecall !== 'number') return false;
  return recall < baselineRecall - (tolerance ?? 0) - 1e-12;
}

/**
 * Recall-first comparison of one route against the baseline series (same route, same half):
 * delta of the recall point estimates and the miss count. Counts only (repo-manifest safe).
 */
export function recallComparison({ recall, misses }, baselineRecall, { baselineSeries, tolerance = 0 } = {}) {
  const has = typeof recall === 'number' && typeof baselineRecall === 'number';
  return { baselineSeries, baselineRecall: baselineRecall ?? null, recall: recall ?? null,
    delta: has ? recall - baselineRecall : null, tolerance, misses,
    regressed: recallRegressed(recall, baselineRecall, tolerance) };
}

/**
 * Best tuning recall over earlier series dev manifests ([{ series, aggregates }]): per series,
 * the best recall among the routes whose verdict is not `fail` (a route that fails every item
 * shows 100 % recall by construction, so it never sets the baseline). The baseline series is
 * the argmax, the earliest one on a tie. Returns null when no series has an eligible route.
 */
export function bestRecallBaseline(devManifests) {
  let out = null;
  for (const { series, aggregates } of devManifests ?? []) {
    const perRoute = {};
    for (const [route, a] of Object.entries(aggregates ?? {})) {
      if (a?.verdict !== 'fail' && typeof a?.recall === 'number') perRoute[route] = a.recall;
    }
    const vals = Object.values(perRoute);
    if (!vals.length) continue;
    const best = Math.max(...vals);
    if (!out || best > out.best + 1e-12) out = { series: Number(series), best, perRoute };
  }
  return out;
}

/**
 * Per-route recall-first comparison block of series-<k>-dev.json (manifests declaring
 * recallNonRegression): recall delta against the baseline series (same route, same half) and
 * the miss count. `perRoute` maps route → dev rows, `aggregates` route → { recall },
 * `baseline` = { baselineSeries, tolerance, recall: { route: recall } }. Counts only: no item
 * id, code or text reaches the repo manifest.
 */
export function buildRecallComparison(perRoute, aggregates, baseline) {
  const out = {};
  for (const [route, rows] of Object.entries(perRoute)) {
    out[route] = recallComparison({ recall: aggregates[route]?.recall ?? null, misses: shownMisses(rows).length },
      baseline.recall?.[route] ?? null, { baselineSeries: baseline.baselineSeries, tolerance: baseline.tolerance });
  }
  return out;
}
