// inject-grounding.mjs
// Injecte page + citation verbatim + pdfPath sur les noeuds Signal/DesignationEvent
// du baseline rimouski, ET enrichit les edges.refs correspondants avec {docSha,page,excerpt}.
// Usage: node inject-grounding.mjs <baseline.json> <cites_dir> <nodes-by-sha.json> <source> <out.json>
import fs from 'node:fs';
import path from 'node:path';

const [baselinePath, citesDir, nodesBySha, source, outPath] = process.argv.slice(2);
if (!baselinePath || !citesDir || !nodesBySha || !source || !outPath) {
  console.error('Usage: node inject-grounding.mjs <baseline> <citesDir> <nodes-by-sha.json> <source> <out>');
  process.exit(1);
}

const g = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const groups = JSON.parse(fs.readFileSync(nodesBySha, 'utf8'));

// Build node-id → {docSha, page, excerpt}
const cite = new Map();
for (const grp of groups) {
  const sha = grp.docSha;
  const cf = path.join(citesDir, `${sha}.json`);
  if (!fs.existsSync(cf)) { console.error(`[warn] pas de cites pour ${sha}`); continue; }
  const res = JSON.parse(fs.readFileSync(cf, 'utf8')).results || [];
  for (const r of res) {
    if (r && r.id && r.found && r.excerpt) {
      cite.set(String(r.id), { docSha: sha, page: Number(r.page) || 1, excerpt: String(r.excerpt).trim() });
    }
  }
}

// rawRef CAS pattern: raw/<source>/cas/<docSha>.pdf
const rawRefFor = (sha) => `raw/${source}/cas/${sha}.pdf`;

let nNode = 0;
for (const n of g.nodes || []) {
  if (n.type !== 'Signal' && n.type !== 'DesignationEvent') continue;
  const c = cite.get(String(n.id));
  if (!c) { console.error(`[warn] pas de citation pour node ${n.id}`); continue; }
  n.properties = n.properties || {};
  // node-level grounding (lu par la projection PG props.properties.*)
  n.properties.page = c.page;
  n.properties.citation = c.excerpt;
  n.properties.pdfPath = rawRefFor(c.docSha);
  // docSha déjà présent; on le réaffirme
  n.properties.docSha = c.docSha;
  delete n.properties.evidence_quality; // jamais missing
  nNode++;
}

// Enrichir les edges qui touchent un noeud groundé: ajouter une ref {docSha,page,excerpt}
let nEdge = 0;
for (const e of g.edges || []) {
  const src = String(e.source || '');
  const tgt = String(e.target || '');
  // on attache la citation du noeud Signal/DE impliqué (source ou target)
  const c = cite.get(src) || cite.get(tgt);
  if (!c) continue;
  e.refs = Array.isArray(e.refs) ? e.refs : [];
  // remplacer/initialiser la première ref par une ref groundée
  const grounded = { docSha: c.docSha, page: c.page, excerpt: c.excerpt };
  // dédupe: ne pas empiler
  const already = e.refs.find(r => r && r.docSha === c.docSha && r.excerpt);
  if (!already) {
    // si une ref vide existe (excerpt:"" page:1), on la remplace
    const emptyIdx = e.refs.findIndex(r => r && !r.excerpt && (r.docSha === c.docSha || !r.docSha));
    if (emptyIdx >= 0) e.refs[emptyIdx] = grounded;
    else e.refs.unshift(grounded);
    nEdge++;
  }
}

fs.writeFileSync(outPath, JSON.stringify(g, null, 2));
console.error(`[inject] ${nNode} noeuds groundés, ${nEdge} arêtes enrichies → ${outPath}`);
