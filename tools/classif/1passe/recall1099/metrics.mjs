import { matchActs } from '../matching.mjs';
export function metric(found, n) {
  if (!n) return { found, missed: 0, support: n, recall: null, wilsonLower95: null };
  const z = 1.959963984540054, p = found / n, zz = z * z;
  return { found, missed: n - found, support: n, recall: p,
    wilsonLower95: (p + zz / (2 * n) - z * Math.sqrt(p * (1 - p) / n + zz / (4 * n * n))) / (1 + zz / n) };
}
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
// Group exactly the baseline's native acts. A raises_signal pair is one act, not two.
export function graphActs(output, d, annotations = []) {
  const evidence = new Map((output.evidence ?? []).map((e) => [e.id, e]));
  const eligible = output.nodes.filter((n) => ['Signal', 'DesignationEvent', 'Bylaw'].includes(n.node_type));
  const parents = new Map(eligible.map((n) => [n.id, n.id]));
  const root = (id) => parents.get(id) === id ? id : root(parents.get(id));
  for (const e of output.edges ?? []) if (e.relation === 'raises_signal' && parents.has(e.source) && parents.has(e.target)) parents.set(root(e.target), root(e.source));
  const groups = new Map();
  for (const n of eligible) groups.set(root(n.id), [...(groups.get(root(n.id)) ?? []), n]);
  return [...groups].map(([id, nodes]) => {
    const votes = annotations.filter((a) => nodes.some((n) => n.id === a.nodeId));
    const selected = ['pertinent', 'a_surveiller', 'non_classe', 'ecarte'].map((c) => votes.find((a) => a.classe === c)).find(Boolean);
    const classification = { classe: selected?.classe ?? 'non_classe', code: selected?.reasonCode ?? 'UNCLASSIFIED', reason: selected?.reason ?? 'No class annotation on a Bylaw-only group.' };
    return { id, ...classification, variants: nodes.flatMap((n) => {
      const props = n.properties ?? n;
      return [...(n.citations ?? []), ...(n.evidence_refs ?? []).map((id) => evidence.get(id)).filter(Boolean)]
        .filter((c) => c.docSha === d.sha256 && c.source_file === d.originalKey && c.rawRef === d.originalKey
          && c.sourceUrl === d.sourceUrl && c.modality === 'pdf')
        .map((c) => ({ id, target_number: props.no_reglement ?? null, object: `${n.label ?? ''} ${props.description ?? ''}`,
          stage: props.etape ?? props.stage ?? props.stade ?? '', page: c.page, quote: c.excerpt, ...classification }));
    }) };
  });
}
