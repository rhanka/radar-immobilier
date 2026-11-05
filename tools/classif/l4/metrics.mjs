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
 * Lexicographic selection (Annex M M.3, tuning half only): shown recall (LB, then point),
 * shown precision (LB, then point), most recent prompt version, lowest cost. Returns <0 when
 * `a` ranks first. Routes failing the failure ceiling or indeterminate on the compared
 * criterion never outrank a passing one.
 */
export function compareRoutes(a, b) {
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
