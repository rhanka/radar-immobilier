// GEPA method constants and pure scoring rules (owner-validated GEPA method), shared by the
// optimiser loop (l4/gepa.mjs), the series manifest loader, dev and blind. No disk read, no
// model call.
//
// Lexicographic objective, per case and aggregated over the GEPA evaluation routes:
//   1. misses: reference pertinent/a_surveiller predicted non_pertinent, on ANY route (each
//      route counts); a failed call counts as shown (metrics.mjs isShownPred), never a miss;
//   2. noise: reference non_pertinent predicted shown (a failed call counts as shown).
// A pertinent <-> a_surveiller confusion is not penalised.
import { isShownPred, isShownRef } from './metrics.mjs';

export const GEPA_METHOD = 'gepa';
/**
 * Mandatory evaluation routes: a miss on any of them counts. Owner decisions: « on prend sol pas
 * luna » (06/11, luna-6-low stays a run-seat.mjs seat but is no GEPA route), then 12/11 « le
 * pilote se finit sans Vibe »: glm-5.3-low and mistral-large-4-low are dropped (Vibe budget
 * exhausted, 402), 2 routes remain. A resume keeps the per-route cache (the context sha does
 * not cover the routes); the candidates are re-scored on these routes at load.
 */
export const GEPA_ROUTES = ['opus-5.5-low', 'sol-6.1-low'];
/**
 * Routes a series scored with the GEPA rule (0 miss, failures <= 5 %) may register: the GEPA
 * routes plus the ChatGPT routes of the owner 12/11 decisions (P0 on Astra and Sol, then on
 * Luna, low and medium). Optimisation (gepa.mjs) still uses GEPA_ROUTES only (sol, not luna).
 */
export const GEPA_SERIES_ROUTES = [...GEPA_ROUTES, 'sol-6.1-medium', 'astra-low', 'astra-medium', 'luna-6-low', 'luna-6-medium'];
/** Reflective mutation / crossover seat, and its reconciliation + fallback seat. */
export const GEPA_MUTATOR = 'astra-max';
export const GEPA_RECONCILER = 'opus-5.5-max';
/** Call-failure ceiling of the GEPA blind verdict (and of the loop circuit breaker). */
export const GEPA_FAILURE_CEILING = 0.05;

/** Outcome of one route on one case: { miss, noise, failed } (0/1 each). */
export function routeOutcome(refVerdict, pred) {
  const p = !pred || pred.failed ? { failed: true } : pred;
  const shown = isShownPred(p);
  return {
    miss: isShownRef(refVerdict) && !shown ? 1 : 0,
    noise: refVerdict === 'non_pertinent' && shown ? 1 : 0,
    failed: p.failed === true ? 1 : 0,
  };
}

/** Case score summed over the routes of `predsByRoute` ({ route: pred }): { misses, noise, failures }. */
export function caseScore(refVerdict, predsByRoute, routes = GEPA_ROUTES) {
  const s = { misses: 0, noise: 0, failures: 0 };
  for (const route of routes) {
    const o = routeOutcome(refVerdict, predsByRoute?.[route]);
    s.misses += o.miss;
    s.noise += o.noise;
    s.failures += o.failed;
  }
  return s;
}

/** Lexicographic comparison (misses, then noise): < 0 when `a` is better. */
export function compareScore(a, b) {
  if (a.misses !== b.misses) return a.misses - b.misses;
  return a.noise - b.noise;
}

/** Sum of case scores over `ids` (missing cases throw: a score is never partial). */
export function totalScore(scores, ids) {
  const t = { misses: 0, noise: 0, failures: 0, cases: 0 };
  for (const id of ids) {
    const s = scores[id];
    if (!s) throw new Error(`gepa: no score for case ${id}`);
    t.misses += s.misses;
    t.noise += s.noise;
    t.failures += s.failures ?? 0;
    t.cases++;
  }
  return t;
}

/**
 * GEPA verdict of one route on a half: `pass` only when the route has 0 miss AND its call
 * failure share is within the ceiling. Precision is reported, never a floor.
 */
export function gepaRouteVerdict({ misses, failures, items }, ceiling = GEPA_FAILURE_CEILING) {
  const failureShare = items ? failures / items : 1;
  return { verdict: misses === 0 && failureShare <= ceiling + 1e-12 ? 'pass' : 'fail', misses, failureShare };
}

/** Series verdict: `pass` only when EVERY mandatory route is present and passes. */
export function gepaSeriesVerdict(perRoute, routes = GEPA_ROUTES) {
  const missing = routes.filter((r) => !perRoute?.[r]);
  const failing = routes.filter((r) => perRoute?.[r] && perRoute[r].verdict !== 'pass');
  return { verdict: missing.length || failing.length ? 'fail' : 'pass', missing, failing };
}

/** Route universe of a series: its registered GEPA routes (default: every GEPA route) for a GEPA series, `classic` otherwise. */
export function seriesRouteUniverse(method, classic, gepaRoutes = null) {
  return method === GEPA_METHOD ? (gepaRoutes ?? GEPA_ROUTES) : classic;
}
