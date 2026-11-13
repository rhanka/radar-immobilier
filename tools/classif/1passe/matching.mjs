// Appariement prudent. Une incertitude devient une omission à arbitrer.
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const number = (s) => String(s ?? '').toLowerCase().replace(/[\s.\-]/g, '');
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 3));
export function stage(s) {
  const t = norm(s);
  if (/avis.{0,10}motion/.test(t)) return 'motion';
  if (/second|deuxieme|2e/.test(t) && /projet/.test(t)) return 'projet2';
  if (/projet/.test(t)) return 'projet';
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
  const pages = text.split('\f');
  if (!q.trim() || q.length > 300 || !Number.isInteger(a?.page) || !pages[a.page - 1]?.includes(q)) issues.push('citation_ou_page_invalide');
  if (typeof a?.reason !== 'string' || !a.reason.trim() || a.reason.trim().split(/\s+/).length > 40) issues.push('motif_invalide');
  if (a?.ambiguous !== false) issues.push('ambiguite');
  return { ...a, issues, valid: issues.length === 0, class: issues.length ? 'Non classé' : codes.get(a.code) };
}
function score(b, a, text) {
  if (!a.quote || !text.includes(a.quote)) return null;
  const bs = stage(b.stage), as = stage(a.stage);
  if (bs && as && bs !== as) return null;
  if (bs && !as) return null;
  const sources = [b.citation, ...(b.alternativeSites ?? []).map((s) => s.citation)].filter((s) => typeof s === 'string');
  const aq = a.quote.trim();
  const exact = sources.some((q) => text.includes(q) && (q.includes(aq) || aq.includes(q)) && Math.min(q.length, aq.length) >= 30);
  const n = a.target_number;
  const numbered = n && number(`${b.label} ${b.objet} ${b.anchor}`).includes(number(n));
  // Aucun règlement parent présent dans une citation ne suffit à lui seul.
  if (n && !numbered) return null;
  const bw = words(`${b.label} ${b.objet}`), aw = words(`${a.object} ${a.quote}`);
  const common = [...bw].filter((w) => aw.has(w)).length;
  if (!exact && !(numbered && common >= 2 && bs && as === bs)) return null;
  if (!exact && Number.isInteger(b.page) && b.page !== a.page) return null;
  return Number(Boolean(numbered)) * 100 + Number(exact) * 10 + Math.min(common, 9);
}
export function matchActs(units, acts, text) {
  const edges = units.map((b) => acts.map((a, i) => ({ i, score: score(b, a, text) }))
    .filter((e) => e.score !== null).sort((a, b) => b.score - a.score || a.i - b.i));
  const owner = new Map();
  function augment(u, seen) {
    for (const e of edges[u]) {
      if (seen.has(e.i)) continue;
      seen.add(e.i);
      if (!owner.has(e.i) || augment(owner.get(e.i), seen)) { owner.set(e.i, u); return true; }
    }
    return false;
  }
  [...units.keys()].sort((a, b) => units[a].id.localeCompare(units[b].id)).forEach((i) => augment(i, new Set()));
  return new Map([...owner].map(([a, u]) => [units[u].id, acts[a]]));
}
export function agreement(rows) {
  const classes = ['P', 'S', 'N', 'Non classé'];
  const matrix = classes.map(() => classes.map(() => 0));
  for (const r of rows) matrix[classes.indexOf(r.votes[0].class)][classes.indexOf(r.votes[1].class)]++;
  const n = rows.length, margA = matrix.map((r) => r.reduce((a, b) => a + b, 0));
  const margB = classes.map((_, i) => matrix.reduce((s, r) => s + r[i], 0));
  const po = matrix.reduce((s, r, i) => s + r[i], 0) / n;
  const pe = margA.reduce((s, m, i) => s + m * margB[i], 0) / n ** 2;
  return { n, classes, matrix, rawAgreement: po, kappa: pe === 1 ? null : (po - pe) / (1 - pe),
    validatedAgreement: rows.filter((r) => !r.disputed).length / n,
    perClass: Object.fromEntries(classes.map((c, i) => [c, { astra: margA[i], opus: margB[i], both: matrix[i][i],
      symmetricAgreement: margA[i] + margB[i] ? 2 * matrix[i][i] / (margA[i] + margB[i]) : null }])) };
}
