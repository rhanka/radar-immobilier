// Shared draw helpers: committed seeds, seeded hash order, exclusion lists, fingerprint guard.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { CLASSIF_DIR, GOLD_STEVE_30 } from './paths.mjs';
import { baseCity, scanText } from './fingerprint.mjs';

export const SEEDS_FILE = path.join(CLASSIF_DIR, 'l0', 'seeds.json');
export const MANIFEST_DIR = path.join(CLASSIF_DIR, 'l0', 'manifests');

export function loadSeed(kind, override) {
  const seeds = JSON.parse(readFileSync(SEEDS_FILE, 'utf8'));
  const seed = seeds[kind];
  if (!seed) throw new Error(`no ${kind} seed in ${SEEDS_FILE}`);
  if (override && override !== seed) throw new Error(`--seed differs from the committed ${kind} seed`);
  return seed;
}

/** Seeded uniform permutation: order by sha256(seed ‖ id). */
export const hashKey = (seed, id) => createHash('sha256').update(`${seed}\u0000${id}`).digest('hex');
export const seededOrder = (seed, items, idOf = (x) => x.id) => [...items].sort((a, b) => (hashKey(seed, idOf(a)) < hashKey(seed, idOf(b)) ? -1 : 1));

/** Exclusion lists: the guard's exclusions.json when present, else the public Gold Steve 30 cities. */
export function loadExclusions(home, { require = false } = {}) {
  const file = path.join(home, 'guard', 'exclusions.json');
  if (existsSync(file)) {
    const e = JSON.parse(readFileSync(file, 'utf8'));
    return { source: 'guard/exclusions.json', complete: true, cities: new Set(e.citySlugs.map(baseCity)), nodeIds: new Set(e.nodeIds), docShas: new Set(e.docShas), bylaws: new Set(e.bylaws) };
  }
  if (require) throw new Error(`draw refused: ${file} does not exist (run make classif-guard-unseal ENV=preprod first)`);
  const gold = Object.keys(JSON.parse(readFileSync(GOLD_STEVE_30, 'utf8'))).filter((k) => !k.startsWith('_'));
  return { source: 'gold-steve-30 (partial)', complete: false, cities: new Set(gold.map(baseCity)), nodeIds: new Set(), docShas: new Set(), bylaws: new Set() };
}

/** Fingerprint guard (plan §C.4); returns null when the guard material is absent. */
export function loadFingerprints(home) {
  const dir = path.join(home, 'guard');
  if (!existsSync(path.join(dir, 'fingerprints.json'))) return null;
  return { salt: readFileSync(path.join(dir, 'salt'), 'utf8').trim(), fps: JSON.parse(readFileSync(path.join(dir, 'fingerprints.json'), 'utf8')) };
}

/** Fail-closed fingerprint guard: throws when the guard material is absent, so no draw
    or complement step can run un-scanned. */
export function requireFingerprints(home) {
  const fp = loadFingerprints(home);
  if (!fp) throw new Error(`refused: ${path.join(home, 'guard', 'fingerprints.json')} missing (fail closed; run make classif-guard-unseal ENV=preprod first)`);
  return fp;
}

export function fingerprintHits(fp, text, _citySlugs = []) {
  if (!fp) return null;
  const h = scanText(fp.salt, fp.fps, text);
  return Object.values(h).reduce((a, b) => a + b, 0) ? h : null;
}

export const regionBand = (km) => (km === null || km === undefined ? 'unknown' : km < 50 ? 'lt50km' : km < 150 ? '50-150km' : km < 300 ? '150-300km' : 'gt300km');
