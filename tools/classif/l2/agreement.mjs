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

export const STOP = { alphaReport: 0.67, unanimityReport: 0.75, changed: 0.02, resolutionCap: 4, firstResolutionPass: 2, capPass: 5 };

// Plan v3 stop rule (review §E-5, §7): the α thresholds NEVER stop the phase alone (they are
// reported only). Stop when a pass changes < 2 % of the VALID re-annotated votes AND every
// residual item has a cause class AND at least one amendment round is traced. Cap at pass 5
// (passes 2–5 resolve; the chain loops 1–5). Denominator of the 2 %: valid votes
// re-annotated this pass (carried deferred votes excluded, invalid votes excluded).
// Residuals without a majority after the cap keep status `unresolved` with their cause class.
// Review §7b: a definition-gap fallback (fallback:true) is NOT a classification —
// fallback residuals block the stop, unless the 4-pass cap is reached; at the cap
// they are reported as such.
export function stopDecision({ changedShare, pass, residualsClassified, hasAmend = false, fallbackToDefinitionGap = 0 }) {
  const fallback = Number(fallbackToDefinitionGap ?? 0);
  if (pass >= STOP.capPass) {
    if (fallback > 0) return { stop: true, why: `cap reached (pass ${pass} ≥ ${STOP.capPass}) with ${fallback} fallback definition-gap residual(s) reported as such` };
    return { stop: true, why: `cap reached (pass ${pass} ≥ ${STOP.capPass})` };
  }
  if (changedShare !== null && changedShare < STOP.changed && residualsClassified === true) {
    if (fallback > 0) return { stop: false, why: `${(changedShare * 100).toFixed(2)} % changed but ${fallback} fallback definition-gap residual(s) block the stop (undecided, not classified)` };
    if (!hasAmend) return { stop: false, why: `${(changedShare * 100).toFixed(2)} % changed and residuals classified, but no amendment round traced yet (stop forbidden before an amendment)` };
    return { stop: true, why: `${(changedShare * 100).toFixed(2)} % of valid re-annotated votes changed (< 2 %) and every residual item is cause-classified` };
  }
  if (changedShare !== null && changedShare < STOP.changed && residualsClassified !== true) {
    return { stop: false, why: `${(changedShare * 100).toFixed(2)} % changed but residual items lack a cause class` };
  }
  return { stop: false, why: 'resolution continues' };
}
