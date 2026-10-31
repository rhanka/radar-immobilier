// Salted fingerprints of the exposed material (plan §C.4): node ids, docShas, city slugs, bylaw
// numbers, and 12-word shingles of the evaluation-set inputs. Only salted sha256 values are kept;
// the scanner re-hashes candidate tokens with the same salt.
import { createHash } from 'node:crypto';

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

/** Scans a text against the fingerprint lists. Returns hit counts per list (no plaintext). */
export function scanText(salt, fps, text, { citySlugs = [] } = {}) {
  const sets = Object.fromEntries(['nodeIds', 'docShas', 'citySlugs', 'bylaws', 'shingles'].map((k) => [k, new Set(fps[k])]));
  const hits = { nodeIds: 0, docShas: 0, citySlugs: 0, bylaws: 0, shingles: 0 };
  const t = String(text ?? '');
  for (const m of t.matchAll(/\b(?:signal|event|doc|source|bylaw|zone|lot)-[a-z0-9][a-z0-9._-]*[a-z0-9]/gi)) if (sets.nodeIds.has(fp(salt, m[0]))) hits.nodeIds++;
  for (const m of t.matchAll(/\b[0-9a-f]{64}\b/g)) if (sets.docShas.has(fp(salt, m[0]))) hits.docShas++;
  for (const c of citySlugs) if (sets.citySlugs.has(fp(salt, baseCity(c)))) hits.citySlugs++;
  for (const s of shingles(t)) if (sets.shingles.has(fp(salt, s))) hits.shingles++;
  return hits;
}
