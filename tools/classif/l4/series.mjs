// Pre-registered series manifest (Annex M M.5, review §9): tools/classif/l4/manifests/
// series-<k>.json is committed BEFORE the tuning run and required by dev AND blind.
// It carries the frozen prompt sha, routes, halves sha256, shown floors, failure ceiling,
// indeterminate supports and the budget snapshot. Changing any of them after opening a
// half makes the series exploratory.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { CLASSIF_DIR, REPO } from '../lib/paths.mjs';

export const SERIES_MANIFEST_KIND = 'l4-series';

export function seriesManifestFile(k) {
  return path.join(CLASSIF_DIR, 'l4', 'manifests', `series-${k}.json`);
}

/** Loads and validates the pre-registered series manifest: tracked, clean, kind-checked.
    Review §9b/c: routes, halves sha, floors in ]0,1], failure ceiling in ]0,1] and supports
    shapes are validated — a `floors:{}` no longer passes with floors at 0. */
export function loadSeriesManifest(k) {
  const file = seriesManifestFile(k);
  if (!existsSync(file)) throw new Error(`series ${k} refused: pre-registered manifest ${file} absent (commit it before dev)`);
  const git = (...a) => spawnSync('git', a, { cwd: REPO, encoding: 'utf8' });
  const rel = path.relative(REPO, file);
  if (git('ls-files', '--error-unmatch', rel).status !== 0) throw new Error(`series ${k} refused: ${rel} is not committed`);
  if (git('diff', '--quiet', 'HEAD', '--', rel).status !== 0) throw new Error(`series ${k} refused: ${rel} differs from the committed version`);
  const m = JSON.parse(readFileSync(file, 'utf8'));
  if (m.kind !== SERIES_MANIFEST_KIND) throw new Error(`series ${k} refused: ${rel} kind must be ${SERIES_MANIFEST_KIND}`);
  for (const key of ['promptSha256', 'routes', 'floors', 'failureCeiling', 'supports']) {
    if (m[key] === undefined) throw new Error(`series ${k} refused: ${rel} misses pre-registered '${key}'`);
  }
  if (typeof m.promptSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.promptSha256)) throw new Error(`series ${k} refused: ${rel} promptSha256 must be a 64-hex sha`);
  if (!Array.isArray(m.routes) || !m.routes.length || m.routes.some((r) => typeof r !== 'string' || !r)) {
    throw new Error(`series ${k} refused: ${rel} routes must be a non-empty string array`);
  }
  const in01 = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1;
  if (!m.floors || typeof m.floors !== 'object' || !in01(m.floors.recall) || !in01(m.floors.precision)) {
    throw new Error(`series ${k} refused: ${rel} floors.recall/precision must be numbers in ]0,1]`);
  }
  if (!in01(m.failureCeiling)) throw new Error(`series ${k} refused: ${rel} failureCeiling must be a number in ]0,1]`);
  if (!m.supports || typeof m.supports !== 'object' || !Number.isInteger(m.supports.recall) || m.supports.recall < 0
    || !Number.isInteger(m.supports.precision) || m.supports.precision < 0) {
    throw new Error(`series ${k} refused: ${rel} supports.recall/precision must be non-negative integers`);
  }
  return m;
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
  if (!h || typeof h.tuningSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(h.tuningSha256)
    || typeof h.blindSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(h.blindSha256)) {
    throw new Error(`series ${k} refused: pre-registered manifest misses halves.{tuningSha256,blindSha256} (freeze the halves before dev)`);
  }
  if (!splitSha || h.tuningSha256 !== splitSha.tuning || h.blindSha256 !== splitSha.blind) {
    throw new Error(`series ${k} refused: halves sha differs from the committed split (re-freeze the series halves)`);
  }
}
