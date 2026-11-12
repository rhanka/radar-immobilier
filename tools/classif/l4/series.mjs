// Pre-registered series manifest (Annex M M.5, review §9): tools/classif/l4/manifests/
// series-<k>.json is committed BEFORE the tuning run and required by dev AND blind.
// It carries the frozen prompt sha, routes, halves sha256, shown floors, failure ceiling,
// indeterminate supports and the budget snapshot. Changing any of them after opening a
// half makes the series exploratory.
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { classifDir, repoRoot } from '../lib/paths.mjs';
import { GEPA_FAILURE_CEILING, GEPA_METHOD, GEPA_ROUTES } from './gepa-common.mjs';

export const SERIES_MANIFEST_KIND = 'l4-series';

export function seriesManifestFile(k, env = process.env) {
  return path.join(classifDir(env), 'l4', 'manifests', `series-${k}.json`);
}

/** Loads and validates the pre-registered series manifest: tracked, clean, kind-checked.
    Review §9b/c: routes, halves sha, floors in ]0,1], failure ceiling in ]0,1] and supports
    shapes are validated — a `floors:{}` no longer passes with floors at 0.
    Review §9: halves are REQUIRED (a manifest without frozen halves refuses).
    GEPA series (`method: 'gepa'`): routes = a non-empty subset of the GEPA routes (owner 12/11:
    a single-route evaluation such as P0 × sol-6.1-low), failureCeiling <= 5 %, no
    floors (precision reported, never a floor), no recallNonRegression (own verdict). */
export function loadSeriesManifest(k, env = process.env) {
  const file = seriesManifestFile(k, env);
  const repo = repoRoot(env);
  if (!existsSync(file)) throw new Error(`series ${k} refused: pre-registered manifest ${file} absent (commit it before dev)`);
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  const rel = path.relative(repo, file);
  if (git('ls-files', '--error-unmatch', rel).status !== 0) throw new Error(`series ${k} refused: ${rel} is not committed`);
  if (git('diff', '--quiet', 'HEAD', '--', rel).status !== 0) throw new Error(`series ${k} refused: ${rel} differs from the committed version`);
  const m = JSON.parse(readFileSync(file, 'utf8'));
  if (m.kind !== SERIES_MANIFEST_KIND) throw new Error(`series ${k} refused: ${rel} kind must be ${SERIES_MANIFEST_KIND}`);
  if (m.method !== undefined && m.method !== GEPA_METHOD) throw new Error(`series ${k} refused: ${rel} method must be '${GEPA_METHOD}' when set`);
  const gepa = m.method === GEPA_METHOD;
  for (const key of ['promptSha256', 'routes', ...(gepa ? [] : ['floors']), 'failureCeiling', 'supports']) {
    if (m[key] === undefined) throw new Error(`series ${k} refused: ${rel} misses pre-registered '${key}'`);
  }
  if (typeof m.promptSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.promptSha256)) throw new Error(`series ${k} refused: ${rel} promptSha256 must be a 64-hex sha`);
  if (!Array.isArray(m.routes) || !m.routes.length || m.routes.some((r) => typeof r !== 'string' || !r)) {
    throw new Error(`series ${k} refused: ${rel} routes must be a non-empty string array`);
  }
  const in01 = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1;
  if (gepa) assertGepaSeriesShape(m, k, rel);
  else if (!m.floors || typeof m.floors !== 'object' || !in01(m.floors.recall) || !in01(m.floors.precision)) {
    throw new Error(`series ${k} refused: ${rel} floors.recall/precision must be numbers in ]0,1]`);
  }
  if (!in01(m.failureCeiling)) throw new Error(`series ${k} refused: ${rel} failureCeiling must be a number in ]0,1]`);
  if (!m.supports || typeof m.supports !== 'object' || !Number.isInteger(m.supports.recall) || m.supports.recall < 0
    || !Number.isInteger(m.supports.precision) || m.supports.precision < 0) {
    throw new Error(`series ${k} refused: ${rel} supports.recall/precision must be non-negative integers`);
  }
  const hex64 = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
  if (!m.halves || typeof m.halves !== 'object' || !hex64(m.halves.tuningSha256) || !hex64(m.halves.blindSha256)) {
    throw new Error(`series ${k} refused: ${rel} halves.{tuningSha256,blindSha256} must be 64-hex shas (freeze the halves before dev)`);
  }
  if (m.recallNonRegression !== undefined) assertRecallNonRegressionShape(m.recallNonRegression, k, rel);
  return m;
}

/**
 * GEPA series shape: a non-empty subset of the GEPA routes without duplicates (the registered
 * routes are the mandatory routes of the series verdict), a failure ceiling in ]0, 5 %], no
 * floors, no recallNonRegression.
 */
export function assertGepaSeriesShape(m, k, rel = `series-${k}.json`) {
  if (!Array.isArray(m.routes) || !m.routes.length || new Set(m.routes).size !== m.routes.length || m.routes.some((r) => !GEPA_ROUTES.includes(r))) {
    throw new Error(`series ${k} refused: ${rel} gepa routes must be a non-empty subset of [${GEPA_ROUTES.join(',')}] without duplicates`);
  }
  if (typeof m.failureCeiling !== 'number' || !(m.failureCeiling > 0) || m.failureCeiling > GEPA_FAILURE_CEILING) {
    throw new Error(`series ${k} refused: ${rel} gepa failureCeiling must be in ]0,${GEPA_FAILURE_CEILING}]`);
  }
  if (m.floors !== undefined) throw new Error(`series ${k} refused: ${rel} gepa series carry no floors (precision is reported, never a floor)`);
  if (m.recallNonRegression !== undefined) throw new Error(`series ${k} refused: ${rel} gepa series carry their own verdict (no recallNonRegression)`);
}

/**
 * Route universe hint before the full manifest load: 'gepa' when series-<k>.json exists and
 * declares method gepa, 'classic' otherwise (the full load still validates everything).
 */
/**
 * Routes of a GEPA series before the full manifest load (its registered routes), null for a
 * classic series or an unreadable manifest (the full load still validates everything).
 */
export function gepaSeriesRoutes(k, env = process.env) {
  try {
    const m = JSON.parse(readFileSync(seriesManifestFile(k, env), 'utf8'));
    return m?.method === GEPA_METHOD && Array.isArray(m.routes) ? m.routes : null;
  } catch { return null; }
}

export function seriesMethod(k, env = process.env) {
  try {
    const m = JSON.parse(readFileSync(seriesManifestFile(k, env), 'utf8'));
    return m?.method === GEPA_METHOD ? GEPA_METHOD : 'classic';
  } catch { return 'classic'; }
}

/**
 * Optional `recallNonRegression: { baselineSeries, metric: 'recall', tolerance }` (owner rule
 * 06/11: a lower recall is a regression). Manifests without the field are unchanged.
 * baselineSeries is an earlier series (integer, < k), tolerance a number in [0,1[.
 */
export function assertRecallNonRegressionShape(r, k, rel = `series-${k}.json`) {
  const bad = (why) => { throw new Error(`series ${k} refused: ${rel} recallNonRegression ${why}`); };
  if (!r || typeof r !== 'object' || Array.isArray(r)) bad('must be an object');
  if (!Number.isInteger(r.baselineSeries) || r.baselineSeries < 0) bad('baselineSeries must be a non-negative integer');
  if (/^\d+$/.test(String(k)) && r.baselineSeries >= Number(k)) bad(`baselineSeries must be an earlier series than ${k}`);
  if (r.metric !== 'recall') bad("metric must be 'recall'");
  if (typeof r.tolerance !== 'number' || !Number.isFinite(r.tolerance) || r.tolerance < 0 || r.tolerance >= 1) bad('tolerance must be a number in [0,1[');
}

/**
 * Tuning-half recall baseline of a manifest declaring recallNonRegression: the per-route recall
 * point estimates of the committed `series-<baselineSeries>-dev.json` (metrics-only manifest).
 * Returns null when the field is absent. The blind-half comparison is the blind executor's
 * (aggregates only), never this loader's.
 */
export function loadTuningRecallBaseline(seriesSpec, k, env = process.env) {
  const r = seriesSpec?.recallNonRegression;
  if (r === undefined) return null;
  assertRecallNonRegressionShape(r, k);
  const repo = repoRoot(env);
  const file = path.join(classifDir(env), 'l4', 'manifests', `series-${r.baselineSeries}-dev.json`);
  const rel = path.relative(repo, file);
  if (!existsSync(file)) throw new Error(`series ${k} refused: recall baseline ${rel} absent`);
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  if (git('ls-files', '--error-unmatch', rel).status !== 0) throw new Error(`series ${k} refused: recall baseline ${rel} is not committed`);
  if (git('diff', '--quiet', 'HEAD', '--', rel).status !== 0) throw new Error(`series ${k} refused: recall baseline ${rel} differs from the committed version`);
  const dev = JSON.parse(readFileSync(file, 'utf8'));
  if (dev.kind !== 'l4-dev' || !dev.aggregates || typeof dev.aggregates !== 'object') throw new Error(`series ${k} refused: recall baseline ${rel} is not an l4-dev manifest`);
  const recall = {};
  for (const [route, a] of Object.entries(dev.aggregates)) if (typeof a?.recall === 'number') recall[route] = a.recall;
  return { baselineSeries: r.baselineSeries, tolerance: r.tolerance, half: 'tuning', recall };
}

/**
 * Review §9b: the executed routes must equal the pre-registered series routes — a
 * --deferred that silently changes the series is refused (update and recommit instead).
 */
export function assertSeriesRoutes(seriesSpec, routes, k) {
  const want = [...new Set(seriesSpec.routes)].sort();
  const got = [...new Set(routes)].sort();
  if (want.length !== got.length || want.some((r, i) => r !== got[i])) {
    throw new Error(`series ${k} refused: executed routes [${got.join(',')}] differ from the pre-registered manifest [${want.join(',')}] (update and recommit the manifest, else exploratory)`);
  }
}

/**
 * Review §9b (halves): the series halves sha must match the committed split draw.
 * The manifest carries halves:{tuningSha256,blindSha256}; absent or mismatched halves refuse.
 */
export function assertSeriesHalves(seriesSpec, k, splitSha) {
  const h = seriesSpec.halves;
  // (shape already enforced by loadSeriesManifest; re-checked for direct callers)
  if (!h || typeof h.tuningSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(h.tuningSha256)
    || typeof h.blindSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(h.blindSha256)) {
    throw new Error(`series ${k} refused: pre-registered manifest misses halves.{tuningSha256,blindSha256} (freeze the halves before dev)`);
  }
  if (!splitSha || h.tuningSha256 !== splitSha.tuning || h.blindSha256 !== splitSha.blind) {
    throw new Error(`series ${k} refused: halves sha differs from the committed split (re-freeze the series halves)`);
  }
}
