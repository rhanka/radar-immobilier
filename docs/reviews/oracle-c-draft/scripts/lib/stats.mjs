// Small, dependency-free statistics helpers (chi-square, kappa, PRNG).

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lnGamma(z) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Regularized upper incomplete gamma Q(s, x). */
function gammaQ(s, x) {
  if (x <= 0) return 1;
  if (x < s + 1) {
    let sum = 1 / s; let term = sum;
    for (let n = 1; n < 500; n++) { term *= x / (s + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-14) break; }
    return 1 - sum * Math.exp(-x + s * Math.log(x) - lnGamma(s));
  }
  let b = x + 1 - s; let c = 1e300; let d = 1 / b; let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - s); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + s * Math.log(x) - lnGamma(s)) * h;
}

/** Chi-square test of independence on a 2 x k table given as [[a1..ak],[b1..bk]]. */
export function chi2Test(table) {
  const cols = table[0].map((_, j) => j).filter((j) => table[0][j] + table[1][j] > 0);
  const t = table.map((row) => cols.map((j) => row[j]));
  const rowT = t.map((r) => r.reduce((a, b) => a + b, 0));
  const colT = cols.map((_, j) => t[0][j] + t[1][j]);
  const n = rowT[0] + rowT[1];
  let chi2 = 0; let minExpected = Infinity;
  for (let i = 0; i < 2; i++) for (let j = 0; j < cols.length; j++) {
    const e = (rowT[i] * colT[j]) / n;
    minExpected = Math.min(minExpected, e);
    if (e > 0) chi2 += (t[i][j] - e) ** 2 / e;
  }
  const df = Math.max(1, cols.length - 1);
  const p = cols.length < 2 ? 1 : gammaQ(df / 2, chi2 / 2);
  const cramerV = n > 0 && cols.length > 1 ? Math.sqrt(chi2 / n) : 0;
  return { chi2, df, p, cramerV, minExpected };
}

/** Cohen's kappa between two label arrays (same length, nulls skipped pairwise). */
export function cohenKappa(a, b, labels) {
  const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x != null && y != null);
  const n = pairs.length;
  if (!n) return { kappa: null, n: 0, agreement: null };
  const po = pairs.filter(([x, y]) => x === y).length / n;
  let pe = 0;
  for (const l of labels) pe += (pairs.filter(([x]) => x === l).length / n) * (pairs.filter(([, y]) => y === l).length / n);
  return { kappa: pe === 1 ? 1 : (po - pe) / (1 - pe), n, agreement: po };
}

/** Fleiss' kappa for m raters (rows = items; each row an array of labels, nulls rows skipped). */
export function fleissKappa(rows, labels) {
  const full = rows.filter((r) => r.every((x) => x != null));
  const N = full.length;
  if (!N) return { kappa: null, n: 0 };
  const m = full[0].length;
  const pj = labels.map((l) => full.reduce((s, r) => s + r.filter((x) => x === l).length, 0) / (N * m));
  const Pi = full.map((r) => (labels.reduce((s, l) => { const c = r.filter((x) => x === l).length; return s + c * c; }, 0) - m) / (m * (m - 1)));
  const Pbar = Pi.reduce((a, b) => a + b, 0) / N;
  const Pe = pj.reduce((s, p) => s + p * p, 0);
  return { kappa: Pe === 1 ? 1 : (Pbar - Pe) / (1 - Pe), n: N };
}

/** Wilson 95% interval for a proportion k/n. */
export function wilson(k, n) {
  if (!n) return [null, null];
  const z = 1.96; const p = k / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
