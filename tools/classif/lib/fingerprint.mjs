// Salted fingerprints of the exposed material (plan §C.4): node ids, docShas, city slugs, bylaw
// numbers, and 12-word shingles of the evaluation-set inputs. Only salted sha256 values are kept;
// the scanner re-hashes candidate tokens with the same salt.
import { createHash } from 'node:crypto';
import { bylawsIn, slugify } from './triage.mjs';

export const SHINGLE = 12;

export const fp = (salt, value) => createHash('sha256').update(`${salt}\u0000${value}`).digest('hex');

export const words = (text) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .split(/[^a-z0-9]+/).filter(Boolean);

export function shingles(text, n = SHINGLE) {
  const w = words(text);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return [...out];
}

export const baseCity = (slug) => String(slug ?? '').split('--')[0];

export function buildFingerprints(salt, { nodeIds, docShas, citySlugs, bylaws, inputs }) {
  const h = (xs) => [...new Set(xs.map((x) => fp(salt, x)))].sort();
  return {
    version: 1,
    shingleWords: SHINGLE,
    nodeIds: h(nodeIds),
    docShas: h(docShas),
    citySlugs: h(citySlugs.map(baseCity)),
    bylaws: h(bylaws),
    shingles: h(inputs.flatMap((t) => shingles(t))),
  };
}

/**
 * Single shared scanner for every L0/L2 guard (plan §C.4): node ids, docShas, city slugs
 * (1–6 word n-grams of the text), bylaw numbers, 12-word shingles. Both `scanText` and the
 * sandbox `scanFile` delegate here so the lists cannot drift apart.
 */
export function scanShared(salt, fps, text) {
  const sets = Object.fromEntries(['nodeIds', 'docShas', 'citySlugs', 'bylaws', 'shingles'].map((k) => [k, new Set(fps[k])]));
  const has = (k, v) => sets[k].has(fp(salt, v));
  const hits = { nodeIds: 0, docShas: 0, citySlugs: 0, bylaws: 0, shingles: 0 };
  const t = String(text ?? '');
  for (const m of t.matchAll(/\b(?:signal|event|doc|source|bylaw|zone|lot)-[a-z0-9][a-z0-9._-]*[a-z0-9]/gi)) if (has('nodeIds', m[0])) hits.nodeIds++;
  for (const m of t.matchAll(/\b[0-9a-f]{64}\b/g)) if (has('docShas', m[0])) hits.docShas++;
  const w = words(t);
  const seen = new Set();
  for (let n = 1; n <= 6; n++) {
    for (let i = 0; i + n <= w.length; i++) {
      const s = slugify(w.slice(i, i + n).join(' '));
      if (!seen.has(s)) { seen.add(s); if (has('citySlugs', s)) hits.citySlugs++; }
    }
  }
  for (const b of bylawsIn(t)) if (has('bylaws', b)) hits.bylaws++;
  for (const s of shingles(t)) if (has('shingles', s)) hits.shingles++;
  return hits;
}

/**
 * Scans a text against the fingerprint lists. Returns hit counts per list (no plaintext).
 * The `citySlugs` option is kept for caller compatibility but no longer affects the counts:
 * city matching is text-based (same n-gram scan as the sandbox) so an allowed-city document
 * citing an excluded city is refused.
 */
export function scanText(salt, fps, text, _opts = {}) {
  return scanShared(salt, fps, text);
}
