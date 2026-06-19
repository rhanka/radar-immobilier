/* global process */
/**
 * graphify_to_extraction_v23.js
 *
 * Transform: baseline graph (v2.1/v2.2/v2.3) → extraction format for graphify validate-extraction.
 *
 * Fix v2.3 (2026-06-18):
 *   - Builds a node-type index from input nodes (id → node_type).
 *   - For every edge, resolves (relation, source_node_type, target_node_type) and:
 *     · REMAPS Signal→targets_lot→Lot   to Signal→concerns→Lot   (concerns allows [Signal,DE]→[Zone,Lot])
 *     · REMAPS Signal→targets_zone→Zone to Signal→concerns→Zone  (same)
 *     · REMAPS Bylaw→targets_zone→Zone  to Bylaw→defines→Zone    (defines allows Bylaw→Zone)
 *     · DROPS any other edge whose (relation, src_type, tgt_type) is not allowed by the ontology.
 *   - Preserves etape/etape_date (v2.1) and zone_ref/no_lot/reglement_number (v2.2) on Signal and DesignationEvent.
 *   - Normalises has_signal → raises_signal (ontology synonym_relations).
 *
 * Usage: node graphify_to_extraction_v23.js <input_graph.json> <city> <output_extraction.json>
 */

import fs from 'node:fs';

const inputPath  = process.argv[2];
const city       = process.argv[3] || '';
const outputPath = process.argv[4];

if (!inputPath || !outputPath) {
  process.stderr.write('Usage: node graphify_to_extraction_v23.js <input> <city> <output>\n');
  process.exit(1);
}

const g = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// ── Ontology allowed edge matrix ──────────────────────────────────────────────
// Derived verbatim from radar/ontology/ontology-profile.yaml relation_types.
// Update here whenever ontology-profile.yaml changes.
const ALLOWED = {
  located_in:    { source: ['Zone', 'Lot', 'Adresse', 'Municipality', 'Source'], target: ['Municipality'] },
  located_at:    { source: ['Lot'],                                              target: ['Adresse'] },
  governed_by:   { source: ['Zone'],                                             target: ['Bylaw'] },
  amends:        { source: ['Bylaw'],                                            target: ['Bylaw'] },
  defines:       { source: ['Bylaw'],                                            target: ['Zone'] },
  rezones:       { source: ['DesignationEvent'],                                 target: ['Zone'] },
  splits:        { source: ['DesignationEvent'],                                 target: ['Zone'] },
  merges:        { source: ['DesignationEvent'],                                 target: ['Zone'] },
  subdivides:    { source: ['DesignationEvent'],                                 target: ['Lot'] },
  supersedes:    { source: ['DesignationEvent'],                                 target: ['DesignationEvent'] },
  targets_zone:  { source: ['DesignationEvent'],                                 target: ['Zone'] },
  targets_lot:   { source: ['DesignationEvent'],                                 target: ['Lot'] },
  raises_signal: { source: ['DesignationEvent'],                                 target: ['Signal'] },
  concerns:      { source: ['Signal', 'DesignationEvent'],                       target: ['Zone', 'Lot'] },
  assigned_zone: { source: ['Lot'],                                              target: ['Zone'] },
  issued_for:    { source: ['Bylaw', 'DesignationEvent'],                        target: ['Lot'] },
  subject_of:    { source: ['Lot'],                                              target: ['DesignationEvent'] },
  constrains:    { source: ['Constraint'],                                       target: ['Lot', 'Zone'] },
  applies_to:    { source: ['Constraint', 'Bylaw'],                              target: ['Zone', 'Lot'] },
  mentions:      { source: ['Source'],                                           target: ['Zone', 'Bylaw', 'DesignationEvent', 'Constraint', 'Lot', 'Adresse', 'Signal'] },
  supports:      { source: ['Source'],                                           target: ['Bylaw', 'DesignationEvent', 'Signal'] },
  references:    { source: ['Source'],                                           target: ['Bylaw', 'DesignationEvent'] },
  flags:         { source: ['Source'],                                           target: ['Bylaw', 'DesignationEvent'] },
  derived_from:  { source: ['Zone', 'Bylaw', 'DesignationEvent', 'Constraint', 'Lot', 'Adresse'], target: ['Source'] },
  has_source:    { source: ['Municipality'],                                     target: ['Source'] },
};

/** Returns true iff (relation, srcType, tgtType) is allowed by the ontology. */
function isAllowed(relation, srcType, tgtType) {
  const rule = ALLOWED[relation];
  if (!rule) return false; // unknown relation → drop
  if (srcType && !rule.source.includes(srcType)) return false;
  if (tgtType && !rule.target.includes(tgtType)) return false;
  return true;
}

/**
 * Remap hook — applied before the allowed-check.
 * Returns { relation, source, target } (possibly modified), or null to drop.
 */
function remap(relation, source, target, srcType, tgtType) {
  // Synonym: has_signal → raises_signal (ontology synonym_relations)
  if (relation === 'has_signal') {
    relation = 'raises_signal';
  }

  // Signal→targets_lot→Lot  →  Signal→concerns→Lot
  if (relation === 'targets_lot' && srcType === 'Signal' && tgtType === 'Lot') {
    return { relation: 'concerns', source, target };
  }

  // Signal→targets_zone→Zone  →  Signal→concerns→Zone
  if (relation === 'targets_zone' && srcType === 'Signal' && tgtType === 'Zone') {
    return { relation: 'concerns', source, target };
  }

  // Bylaw→targets_zone→Zone  →  Bylaw→defines→Zone  (bylaw defines/affects the zone)
  if (relation === 'targets_zone' && srcType === 'Bylaw' && tgtType === 'Zone') {
    return { relation: 'defines', source, target };
  }

  return { relation, source, target };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const canonicalType = (t = '') => {
  if (t === 'Address')   return 'Adresse';
  if (t === 'Document')  return 'Source';
  if (t === 'Valuation') return '';         // deprecated type → skip node
  return String(t);
};

const sourceFrom = (obj = {}) => {
  const props = obj.properties || {};
  const chain = [
    obj.source_file,
    obj.pdfPath,
    obj.sourceUrl,
    obj.rawRef,
    obj.docSha,
    props.pdfPath,
    props.sourceUrl,
    props.rawRef,
    props.docSha,
  ];
  for (const v of chain) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
};

const inferEtape = (props = {}) => {
  if (props.etape) return props.etape;
  const kind     = String(props.kind     || '').toLowerCase();
  const category = String(props.category || '').toLowerCase();
  const desc     = String(props.description || '').toLowerCase();
  if (kind === 'ppcmoi')                                                          return 'ppcmoi';
  if (kind === 'piia')                                                            return 'piia';
  if (kind === 'derogation' || kind === 'derogation_mineure')                    return 'derogation_mineure';
  if (kind === 'usage_conditionnel')                                              return 'usage_conditionnel';
  if (kind === 'rezonage')                                                        return 'projet_reglement';
  if (category.includes('ppcmoi'))                                               return 'ppcmoi';
  if (category.includes('piia'))                                                  return 'piia';
  if (category.includes('derog'))                                                 return 'derogation_mineure';
  if (desc.includes('2e projet') || desc.includes('deuxième projet') ||
      desc.includes('deuxieme projet'))                                           return 'second_projet';
  if (desc.includes('premier projet'))                                            return 'projet_reglement';
  if (desc.includes('avis de motion') || desc.includes('avis de'))               return 'avis_motion';
  if (desc.includes('consultation'))                                              return 'consultation_publique';
  if (desc.includes('adoption'))                                                  return 'adoption';
  return 'inconnu';
};

const inferEtapeDate = (props = {}) =>
  props.etape_date || props.date || props.meetingDate || '';

// ── Step 1: Build node-type index ─────────────────────────────────────────────
const nodeTypeById = new Map();
for (const n of g.nodes || []) {
  const t = canonicalType(String(n.type || ''));
  if (t && n.id) nodeTypeById.set(String(n.id), t);
}

// ── Step 2: Transform nodes ───────────────────────────────────────────────────
const nodes    = [];
const edges    = [];
const evidence = [];
let evidenceCounter = 0;

for (const n of g.nodes || []) {
  const nodeType = canonicalType(String(n.type || ''));
  if (!nodeType) continue; // skip deprecated types (Valuation)

  const props = Object.assign({}, n.properties || {});
  const label  = String(
    n.label || n.name || n.titre || n.title || n.code ||
    n.numero || n.lotNumber || n.dossier || `node ${n.id || ''}`
  );
  const descCandidate = String(props.description || n.description || '');

  if (nodeType === 'Signal' || nodeType === 'DesignationEvent') {
    props.description = descCandidate.trim() || label;
    // Preserve v2.1 fields
    props.etape      = props.etape      || inferEtape(props);
    props.etape_date = props.etape_date || inferEtapeDate(props);
    // v2.2 fields (zone_ref / no_lot / reglement_number) are already in props — preserved as-is
  }

  // Always produce a source_file: real source when available, generated:// fallback otherwise.
  // The generated:// citations are stripped by the clean-refs step in worker.sh after validation.
  const sourceRef    = sourceFrom(n) || `generated://node/${n.id || ''}`;
  const citations    = [];
  const evidenceRefs = [];

  {
    const citId = `ev-node-${String(n.id || '').replace(/[^a-zA-Z0-9_-]/g, '_')}-${++evidenceCounter}`;
    const txt   = descCandidate || label;
    citations.push({ id: citId, source_file: sourceRef, page: Number(props.page) || 1, text: txt });
    evidenceRefs.push(citId);
    evidence.push({ id: citId, text: txt, source_file: sourceRef, city, page: Number(props.page) || 1 });
  }

  nodes.push({
    id:            String(n.id || ''),
    label,
    file_type:     sourceRef.startsWith('generated://') ? 'concept' : 'document',
    source_file:   sourceRef,
    node_type:     nodeType,
    status:        String(n.status || 'candidate'),
    citations,
    evidence_refs: evidenceRefs,
    properties:    props,
  });
}

// ── Step 3: Transform edges — with ontology-aware filter ─────────────────────
let droppedCount  = 0;
let remappedCount = 0;

for (const e of g.edges || []) {
  const rawRelation = String(e.relation || e.type || '').trim();
  if (!rawRelation) continue;
  const source = String(e.source || e.from || '');
  const target = String(e.target || e.to   || '');
  if (!source || !target) continue;

  const srcType = nodeTypeById.get(source) || null;
  const tgtType = nodeTypeById.get(target) || null;

  // Apply remap rules (synonym + structural remaps)
  const remapped = remap(rawRelation, source, target, srcType, tgtType);
  if (!remapped) { droppedCount++; continue; }

  const { relation, source: finalSrc, target: finalTgt } = remapped;

  // Validate against ontology — drop if combination is not allowed
  if (!isAllowed(relation, srcType, tgtType)) {
    process.stderr.write(
      `[transform] DROP ${finalSrc}(${srcType || '?'})→${finalTgt}(${tgtType || '?'})` +
      ` rel=${rawRelation}${relation !== rawRelation ? '->' + relation : ''}\n`
    );
    droppedCount++;
    continue;
  }

  if (relation !== rawRelation) remappedCount++;

  const citations    = [];
  const evidenceRefs = [];

  for (const ref of (Array.isArray(e.refs) ? e.refs : [])) {
    if (!ref || typeof ref !== 'object') continue;
    const src = ref.sourceUrl || ref.pdfPath || ref.rawRef || ref.docSha || ref.source_file;
    if (!src) continue;
    const citId   = `ev-edge-${finalSrc}-${finalTgt}-${relation}-${++evidenceCounter}`;
    const excerpt = ref.excerpt || ref.citation || ref.text || '';
    citations.push({ id: citId, source_file: src, page: Number(ref.page) || 1, text: excerpt });
    evidenceRefs.push(citId);
    evidence.push({
      id:          citId,
      text:        excerpt,
      source_file: src,
      city,
      page:        Number(ref.page) || 1,
      excerpt:     excerpt || undefined,
    });
  }

  // Always produce at least one citation — generated:// fallback when no real refs.
  // Stripped by the clean-refs step in worker.sh after validation passes.
  if (citations.length === 0) {
    const genSrc  = `generated://edge/${finalSrc}/${finalTgt}`;
    const citId   = `ev-edge-${finalSrc}-${finalTgt}-${relation}-${++evidenceCounter}`;
    const txt     = `${relation} ${finalSrc} -> ${finalTgt}`;
    citations.push({ id: citId, source_file: genSrc, page: 1, text: txt });
    evidenceRefs.push(citId);
    evidence.push({ id: citId, text: txt, source_file: genSrc, city, page: 1 });
  }

  edges.push({
    source:        finalSrc,
    target:        finalTgt,
    relation,
    status:        String(e.status || 'candidate'),
    confidence:    e.confidence || 'EXTRACTED',
    source_file:   String(e.source_file || ''),
    citations,
    evidence_refs: evidenceRefs,
  });
}

process.stderr.write(
  `[transform] ${city}: ${nodes.length} nodes, ${edges.length} edges ` +
  `(dropped=${droppedCount} remapped=${remappedCount})\n`
);

fs.writeFileSync(outputPath, JSON.stringify({ nodes, edges, evidence }, null, 2));
