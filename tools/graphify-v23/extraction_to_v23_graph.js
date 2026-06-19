/* global process */
/**
 * extraction_to_v23_graph.js
 *
 * Transform: validated extraction format → final graph JSON (ontology_version 2.3).
 * This is step 7 of worker.sh, run after graphify validate-extraction passes.
 *
 * Usage: node extraction_to_v23_graph.js <extraction.json> <municipality> <pv_count> <output.json>
 */

import fs from 'node:fs';

const extractionPath = process.argv[2];
const municipality   = process.argv[3] || '';
const pvCount        = Number(process.argv[4] || 0);
const outputPath     = process.argv[5];

if (!extractionPath || !outputPath) {
  process.stderr.write('Usage: node extraction_to_v23_graph.js <extraction.json> <municipality> <pv_count> <output.json>\n');
  process.exit(1);
}

const ext = JSON.parse(fs.readFileSync(extractionPath, 'utf8'));
const evidenceMap = new Map();
for (const e of ext.evidence || []) {
  if (e && e.id) evidenceMap.set(String(e.id), e);
}

const mkRef = (c) => {
  if (!c || typeof c !== 'object') return null;
  const out = {};
  const source = c.source_file || '';
  if (source) {
    if (/^[0-9a-fA-F]{64}$/.test(source))             out.docSha    = source;
    else if (/^http/i.test(source))                    out.sourceUrl = source;
    else if (source.includes('.pdf') || source.includes('/pdf/')) out.pdfPath = source;
    else                                               out.rawRef    = source;
  }
  const page = c.page || 0;
  if (page) out.page = page;
  if (c.text) out.excerpt = String(c.text);
  return out;
};

const toNode = (n) => {
  const props = Object.assign({}, n.properties || {});
  if ((n.node_type === 'Signal' || n.node_type === 'DesignationEvent') && !props.description) {
    props.description = n.label || '';
  }
  return {
    id:         n.id,
    type:       n.node_type,
    label:      n.label || n.id,
    properties: props,
  };
};

const toEdge = (e) => {
  const refs = [];
  for (const c of e.citations || []) {
    const ref = mkRef(c) || {};
    if (c.id && evidenceMap.has(c.id)) {
      const ev = evidenceMap.get(c.id);
      if (ev.source_file && !ref.sourceUrl && !ref.pdfPath && !ref.rawRef && !ref.docSha) {
        const sf = ev.source_file;
        if (/^[0-9a-fA-F]{64}$/.test(sf))             ref.docSha    = sf;
        else if (/^http/i.test(sf))                    ref.sourceUrl = sf;
        else if (sf.includes('.pdf') || sf.includes('/pdf/')) ref.pdfPath = sf;
        else                                           ref.rawRef    = sf;
      }
      if (ev.page && !ref.page) ref.page = ev.page;
      if (!ref.excerpt && ev.text) ref.excerpt = String(ev.text);
    }
    if (Object.keys(ref).length > 0) refs.push(ref);
  }

  if (refs.length === 0) {
    const fallback = e.source_file ? mkRef({ source_file: e.source_file }) : null;
    if (fallback) refs.push(fallback);
  }

  return {
    source: e.source,
    target: e.target,
    type:   e.relation,
    refs,
  };
};

const nodes = (ext.nodes || []).map(toNode);
const edges = (ext.edges || []).map(toEdge);

const out = {
  municipality,
  generated_at:     new Date().toISOString(),
  ontology_version: '2.3',
  pv_count:         pvCount,
  nodes,
  edges,
};

fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
