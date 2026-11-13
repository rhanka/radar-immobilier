import { matchActs } from '../matching.mjs';
export function metric(found, n) {
  if (!n) return { found, missed: 0, support: n, recall: null, wilsonLower95: null };
  const z = 1.959963984540054, p = found / n, zz = z * z;
  return { found, missed: n - found, support: n, recall: p,
    wilsonLower95: (p + zz / (2 * n) - z * Math.sqrt(p * (1 - p) / n + zz / (4 * n * n))) / (1 + zz / n) };
}
// One group may have several citations, but can cover at most ONE reference act.
// Each edge uses the inherited, frozen compatibility and evidence test unchanged.
export function pair(units, groups, text) {
  const edges = units.map((b) => groups.flatMap((g, i) => {
    const v = (g.variants ?? [g]).find((a) => matchActs([b], [a], text).has(b.id));
    return v ? [{ i, v }] : [];
  }));
  const owners = new Map();
  function augment(u, seen) {
    for (const e of edges[u]) {
      if (seen.has(e.i)) continue; seen.add(e.i);
      if (!owners.has(e.i) || augment(owners.get(e.i).u, seen)) { owners.set(e.i, { u, v: e.v }); return true; }
    }
    return false;
  }
  [...units.keys()].sort((a, b) => units[a].id.localeCompare(units[b].id)).forEach((u) => augment(u, new Set()));
  return new Map([...owners.values()].map(({ u, v }) => [units[u].id, v]));
}
export function predictionClass(a, codes) {
  const c = codes.get(a.code) ?? (a.code === 'UNCLASSIFIED' ? 'Non classé' : null);
  const stated = ({ pertinent: 'P', a_surveiller: 'S', ecarte: 'N', non_classe: 'Non classé' })[a.classe];
  // As in production, ambiguity is a flag, not a reason to replace a valid class.
  return c && c === stated && typeof a.reason === 'string' && a.reason.trim() ? c : 'Non classé';
}
