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

/** Loads and validates the pre-registered series manifest: tracked, clean, kind-checked. */
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
  return m;
}
