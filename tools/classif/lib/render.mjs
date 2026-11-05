// Frozen model input for a signal item: ONLY what the radar serves (label, typed properties,
// verbatim excerpts). Ported from origin/feat/oracle-c-draft 03-build-items.mjs renderNode().
// Shared by the evaluation-set sealing and the dev draw, so both use the same input format.
import { createHash } from 'node:crypto';

const PROPS = [
  ['date', 'date'], ['etape', 'étape'], ['etape_date', 'date de l\'étape'], ['kind', 'nature'], ['category', 'catégorie'],
  ['instrument', 'instrument'], ['status', 'statut'], ['regulatoryStatus', 'statut réglementaire'], ['outcome', 'issue'],
  ['intensite', 'intensité'], ['zone_ref', 'zone'], ['reglement_number', 'n° règlement'], ['bylaw_no', 'n° règlement (bylaw)'],
  ['reglementNo', 'n° règlement'], ['nb_unites_min', 'unités min'], ['nb_unites_max', 'unités max'], ['no_lot', 'lot'],
  ['lotNumber', 'lot'], ['resolution', 'résolution'], ['resolutionRef', 'réf. résolution'], ['amount_cad', 'montant ($)'],
  ['evidenceCompleteness', 'complétude de la preuve'],
];

export function renderNode(n) {
  const p = n.props?.properties ?? n.props ?? {};
  const lines = [`[${n.type}] ${n.id}`, `Libellé : ${n.label}`];
  const kv = [];
  for (const [k, label] of PROPS) {
    const v = p[k];
    if (v === undefined || v === null || v === '') continue;
    kv.push(`${label} = ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  if (kv.length) lines.push(`Propriétés : ${kv.join(' ; ')}`);
  if (p.description && p.description !== n.label) lines.push(`Description : ${p.description}`);
  const refs = [...(n.props?.refs ?? []), ...(p.refs ?? [])];
  const seen = new Set();
  const ex = [];
  for (const t of [p.citation, ...refs.flatMap((r) => [r.excerpt, r.citation])]) {
    if (!t || seen.has(String(t).trim())) continue;
    seen.add(String(t).trim());
    ex.push(String(t).trim());
  }
  if (ex.length) lines.push('Extraits du document source (verbatim) :', ...ex.map((t) => `- « ${t} »`));
  return lines.join('\n');
}

export const renderItem = (citySlug, nodes) => `Municipalité : ${citySlug}\n\n${nodes.map(renderNode).join('\n\n')}`;

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * Canonical JSON with sorted object keys (review D3): two aggregates with the
 * same content hash identically whatever the route insertion order was (a
 * resumed S113 restore must not change aggregatesSha256 at equal data).
 */
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

/** docShas cited by a node (properties.docSha, refs[].docSha at both levels). */
export function nodeDocShas(n) {
  const p = n.props?.properties ?? {};
  const out = new Set();
  for (const v of [p.docSha, n.props?.docSha]) if (v) out.add(v);
  for (const r of [...(n.props?.refs ?? []), ...(p.refs ?? [])]) if (r?.docSha) out.add(r.docSha);
  return [...out];
}

/** Bylaw numbers carried by a node's typed properties. */
export function nodeBylaws(n) {
  const p = n.props?.properties ?? {};
  return [...new Set([p.reglement_number, p.bylaw_no, p.reglementNo, p.number].filter((v) => v !== undefined && v !== null && v !== '').map(String))];
}
