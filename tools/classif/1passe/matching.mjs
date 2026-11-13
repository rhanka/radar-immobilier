// Shared offline matcher. Ambiguous graph edges are reported, never assigned.
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function quotePages(quote, text) {
  const q = norm(quote);
  return q ? text.split('\f').flatMap((p, i) => norm(p).includes(q) ? [i + 1] : []) : [];
}
export function overlap(a, b) {
  const x = norm(a), y = norm(b);
  for (let i = 0; i <= x.length - 30; i++) if (y.includes(x.slice(i, i + 30))) return true;
  return false;
}
export function stage(s) {
  const t = norm(s);
  if (/avis.{0,10}motion/.test(t)) return 'motion';
  if (/second|deuxieme|2e/.test(t) && /projet/.test(t)) return 'projet2';
  if (/projet|depot|presentation/.test(t)) return 'projet';
  if (/adopt|final/.test(t)) return 'adoption';
  if (/consult|assemblee/.test(t)) return 'consultation';
  if (/entree|vigueur/.test(t)) return 'vigueur';
  if (/retir/.test(t)) return 'retrait';
  return null;
}
export function codesFrom(pack) {
  return new Map([...pack.matchAll(/^- `([^`]+)` \((pertinent|a_surveiller|non_pertinent)\)/gm)]
    .map((m) => [m[1], ({ pertinent: 'P', a_surveiller: 'S', non_pertinent: 'N' })[m[2]]]));
}
export function validate(a, text, codes) {
  const issues = [];
  if (!a || !codes.has(a.code)) issues.push('code_invalide');
  const q = typeof a?.quote === 'string' ? a.quote : '';
  const anchors = quotePages(q, text);
  const nearby = anchors.filter((p) => Number.isInteger(a?.page) && Math.abs(p - a.page) <= 1);
  const evidencePage = anchors.length === 1 ? anchors[0] : nearby.length === 1 ? nearby[0] : null;
  if (!q.trim() || q.length > 300 || !evidencePage) issues.push('citation_ou_page_invalide');
  if (typeof a?.reason !== 'string' || !a.reason.trim() || a.reason.trim().split(/\s+/).length > 40) issues.push('motif_invalide');
  if (typeof a?.ambiguous !== 'boolean') issues.push('ambiguity_missing');
  return { ...a, evidencePage, issues, valid: issues.length === 0,
    status: issues.length ? 'invalide' : 'valide', class: codes.get(a?.code) ?? null };
}
function compatible(b, a, text) {
  const anchors = quotePages(a.quote, text);
  const page = a.evidencePage ?? (anchors.length === 1 ? anchors[0] : a.page);
  if (!anchors.includes(page) || !Number.isInteger(b.page) || Math.abs(b.page - page) > 1) return false;
  const bs = stage(b.stage), as = stage(a.stage);
  if (bs && as !== bs) return false;
  const sources = [b.citation, ...(b.alternativeSites ?? []).map((s) => s.citation)].filter((s) => typeof s === 'string');
  const exact = sources.some((q) => quotePages(q, text).length && overlap(q, a.quote));
  const n = a.target_number;
  const target = norm(n).replace(/ /g, '[ .-]*');
  if (n && !new RegExp(`(?:^|[^a-z0-9])${target}(?:$|[^a-z0-9])`).test(norm(`${b.label} ${b.objet} ${b.anchor}`))) return false;
  return exact;
}
export function matchActs(units, acts, text) {
  const edges = units.map((b) => acts.flatMap((a, i) => compatible(b, a, text) ? [i] : []));
  function assignment(excludedU = -1, excludedA = -1) {
    const owner = new Map();
    function augment(u, seen) {
      for (const i of edges[u]) {
        if ((u === excludedU && i === excludedA) || seen.has(i)) continue;
        seen.add(i);
        if (!owner.has(i) || augment(owner.get(i), seen)) { owner.set(i, u); return true; }
      }
      return false;
    }
    for (const u of units.keys()) augment(u, new Set());
    return owner;
  }
  const owner = assignment(), result = new Map();
  for (const [a, u] of owner) if (assignment(u, a).size < owner.size) result.set(units[u].id, acts[a]);
  result.collisions = units.flatMap((b, u) => edges[u].length && !result.has(b.id) ? [{ id: b.id, candidates: edges[u] }] : []);
  return result;
}
export function agreement(rows) {
  const total = rows.length;
  rows = rows.filter((r) => r.votes.every((v) => v.valid && ['P', 'S', 'N'].includes(v.class)));
  const classes = ['P', 'S', 'N'];
  const matrix = classes.map(() => classes.map(() => 0));
  for (const r of rows) matrix[classes.indexOf(r.votes[0].class)][classes.indexOf(r.votes[1].class)]++;
  const n = rows.length, margA = matrix.map((r) => r.reduce((a, b) => a + b, 0));
  const margB = classes.map((_, i) => matrix.reduce((s, r) => s + r[i], 0));
  const po = matrix.reduce((s, r, i) => s + r[i], 0) / n;
  const pe = margA.reduce((s, m, i) => s + m * margB[i], 0) / n ** 2;
  return { n, total, excluded: total - n, coverage: total ? n / total : null, classes, matrix, rawAgreement: n ? po : null, kappa: !n || pe === 1 ? null : (po - pe) / (1 - pe),
    validatedAgreement: total ? rows.filter((r) => !r.disputed).length / total : null,
    perClass: Object.fromEntries(classes.map((c, i) => [c, { astra: margA[i], opus: margB[i], both: matrix[i][i],
      symmetricAgreement: margA[i] + margB[i] ? 2 * matrix[i][i] / (margA[i] + margB[i]) : null }])) };
}
