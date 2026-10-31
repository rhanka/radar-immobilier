// Agreement statistics for the convergence passes (plan §B-L2 stop rule, dossier-v3 Q10-A/B).

/** Krippendorff's alpha, nominal metric, with missing values. units = array of value arrays. */
export function krippendorffAlpha(units) {
  const coinc = new Map();
  const key = (a, b) => `${a}\u0000${b}`;
  let n = 0;
  for (const raw of units) {
    const vals = raw.filter((v) => v !== null && v !== undefined);
    const m = vals.length;
    if (m < 2) continue;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        if (i === j) continue;
        const k = key(vals[i], vals[j]);
        coinc.set(k, (coinc.get(k) ?? 0) + 1 / (m - 1));
      }
    }
    n += m;
  }
  if (n === 0) return null;
  const marg = new Map();
  let observedDis = 0;
  for (const [k, w] of coinc) {
    const [a, b] = k.split('\u0000');
    marg.set(a, (marg.get(a) ?? 0) + w);
    if (a !== b) observedDis += w;
  }
  let expectedDis = 0;
  const cats = [...marg.keys()];
  for (const a of cats) for (const b of cats) if (a !== b) expectedDis += marg.get(a) * marg.get(b);
  expectedDis /= (n - 1);
  if (expectedDis === 0) return 1;
  return 1 - observedDis / expectedDis;
}

/** Majority of non-null votes: { value, count, of } or null when no value has ≥ 2 votes. */
export function majority(votes) {
  const present = votes.filter((v) => v !== null && v !== undefined);
  const counts = new Map();
  for (const v of present) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = null;
  for (const [v, c] of counts) if (!best || c > best.count) best = { value: v, count: c, of: present.length };
  return best && best.count >= 2 ? best : null;
}

export const STOP = { alpha: 0.67, unanimity: 0.75, changed: 0.02, maxPasses: 4 };

export function stopDecision({ alphaVerdict, alphaCode, verdictUnanimity, changedShare, pass }) {
  if (alphaVerdict !== null && alphaCode !== null && alphaVerdict >= STOP.alpha && alphaCode >= STOP.alpha && verdictUnanimity >= STOP.unanimity) {
    return { stop: true, why: `α verdict ${alphaVerdict.toFixed(3)} and α code ${alphaCode.toFixed(3)} ≥ ${STOP.alpha}, verdict unanimity ${(verdictUnanimity * 100).toFixed(1)} % ≥ 75 %` };
  }
  if (changedShare !== null && changedShare < STOP.changed) return { stop: true, why: `${(changedShare * 100).toFixed(2)} % labels changed by the pass (< 2 %)` };
  if (pass >= STOP.maxPasses) return { stop: true, why: 'cap of 4 passes reached' };
  return { stop: false, why: 'thresholds not met' };
}
