/**
 * Spearman rank correlation with tie handling, plus gross-inversion detection.
 *
 * Spearman is the primary convergence metric (§4.5): the business use is to
 * SORT opportunities, so rank agreement matters more than absolute error.
 * Ties are handled by the average-rank method (Spearman ρ then equals the
 * Pearson correlation of the fractional ranks), because Steve's notes have
 * many ties (two 10s, three 7s, two 2s, two 0s).
 */

/** Fractional (average) ranks: tied values share the mean of their ranks. */
export function averageRanks(values: readonly number[]): number[] {
  const n = values.length;
  const idx = values.map((v, i) => ({ v, i }));
  idx.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(n);
  let k = 0;
  while (k < n) {
    let j = k;
    // extend the tie group [k, j]
    while (j + 1 < n && idx[j + 1]!.v === idx[k]!.v) j++;
    // ranks are 1-based; average rank of the group
    const avg = (k + 1 + (j + 1)) / 2;
    for (let m = k; m <= j; m++) ranks[idx[m]!.i] = avg;
    k = j + 1;
  }
  return ranks;
}

/** Pearson correlation of two equal-length numeric vectors. */
export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n !== b.length) throw new Error("pearson: length mismatch");
  if (n === 0) throw new Error("pearson: empty input");
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) throw new Error("pearson: zero variance");
  return cov / Math.sqrt(va * vb);
}

/**
 * Spearman rank correlation coefficient in [-1, 1], tie-aware.
 * Throws on length mismatch, empty input, or a constant vector.
 */
export function spearman(a: readonly number[], b: readonly number[]): number {
  return pearson(averageRanks(a), averageRanks(b));
}

export interface RankedItem {
  id: string;
  reference: number; // Steve's note
  candidate: number; // radar score
}

export interface GrossInversion {
  highId: string; // item Steve rates high
  lowId: string; // item Steve rates low
  referenceHigh: number;
  referenceLow: number;
  candidateHigh: number; // radar score of the high-reference item
  candidateLow: number; // radar score of the low-reference item
}

/**
 * Gross inversions: pairs where the reference (Steve) strongly prefers A over
 * B (A in the high band, B in the low band) yet the candidate score ranks B
 * at least as high as A. §4.5 target: "no unexplained inversion between
 * 8–10/10 opportunities and 0–3/10 cases".
 */
export function grossInversions(
  items: readonly RankedItem[],
  opts: { highBand?: number; lowBand?: number } = {},
): GrossInversion[] {
  const highBand = opts.highBand ?? 8;
  const lowBand = opts.lowBand ?? 3;
  const out: GrossInversion[] = [];
  for (const hi of items) {
    if (hi.reference < highBand) continue;
    for (const lo of items) {
      if (lo.reference > lowBand) continue;
      // Steve clearly prefers hi over lo; flag if the score fails to.
      if (hi.candidate <= lo.candidate) {
        out.push({
          highId: hi.id,
          lowId: lo.id,
          referenceHigh: hi.reference,
          referenceLow: lo.reference,
          candidateHigh: hi.candidate,
          candidateLow: lo.candidate,
        });
      }
    }
  }
  return out;
}
