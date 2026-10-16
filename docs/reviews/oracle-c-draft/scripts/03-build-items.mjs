#!/usr/bin/env node
// Step 3 — join Steve's labels (work/triage.json) with the radar records he was served
// (work/nodes.json) into one item per triage line. The model input is ONLY what the radar
// served (node label, typed properties, verbatim excerpts); none of Steve's columns enter it.
// Lines without any resolvable radar node are excluded and listed transparently.
import fs from 'node:fs';
import path from 'node:path';
import { WORK, MOTIF_FAMILY, passShort } from './lib/common.mjs';

const triage = JSON.parse(fs.readFileSync(path.join(WORK, 'triage.json'), 'utf8'));
const { nodes, pod } = JSON.parse(fs.readFileSync(path.join(WORK, 'nodes.json'), 'utf8'));
const byId = new Map(nodes.map((n) => [n.id, n]));

const PROPS = [
  ['date', 'date'], ['etape', 'étape'], ['etape_date', 'date de l\'étape'], ['kind', 'nature'], ['category', 'catégorie'],
  ['instrument', 'instrument'], ['status', 'statut'], ['regulatoryStatus', 'statut réglementaire'], ['outcome', 'issue'],
  ['intensite', 'intensité'], ['zone_ref', 'zone'], ['reglement_number', 'n° règlement'], ['bylaw_no', 'n° règlement (bylaw)'],
  ['reglementNo', 'n° règlement'], ['nb_unites_min', 'unités min'], ['nb_unites_max', 'unités max'], ['no_lot', 'lot'],
  ['lotNumber', 'lot'], ['resolution', 'résolution'], ['resolutionRef', 'réf. résolution'], ['amount_cad', 'montant ($)'],
  ['evidenceCompleteness', 'complétude de la preuve'],
];

function renderNode(n) {
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
    if (!t || seen.has(t.trim())) continue;
    seen.add(t.trim());
    ex.push(t.trim());
  }
  if (ex.length) lines.push('Extraits du document source (verbatim) :', ...ex.map((t) => `- « ${t} »`));
  return lines.join('\n');
}

const regionOf = (mrc) => {
  const s = (mrc ?? '').replace(/^MRC [^(]*\(([^)]+)\).*$/, '$1');
  const first = s.split(/\s+—\s+/)[0].trim();
  return /^(MRC|identification)/.test(first) ? 'other' : first;
};

// Column O is free text written by Steve; only its normalised class is kept (no verbatim).
const filtrageClass = (o) => (/^correct/i.test(o) ? 'correct' : /FUITE/.test(o) ? 'leak' : /ANOMALIE/.test(o) ? 'anomaly'
  : /À VÉRIFIER/.test(o) ? 'to-verify' : /ABSENT|SORTI/.test(o) ? 'absent-or-out-of-view' : 'other');

const items = [];
const excluded = [];
for (const r of triage.rows) {
  const found = r.nodeIds.filter((i) => byId.has(i));
  const label = {
    verdict: r.verdict, motif: r.motif, motifFamily: MOTIF_FAMILY[r.motif] ?? 'unknown', sens: r.sens,
    pass: passShort(r.pass), filtrage: filtrageClass(r.filtrage),
  };
  if (!found.length) {
    excluded.push({ excelRow: r.excelRow, city: r.city, ...label, reason: r.noSignal ? 'no radar signal (line describes a dossier absent from the radar)' : `node id(s) not found in graph_nodes: ${r.nodeIds.join(', ')}` });
    continue;
  }
  const text = `Municipalité : ${r.city}\n\n${found.map((i) => renderNode(byId.get(i))).join('\n\n')}`;
  items.push({
    id: `steve-r${String(r.excelRow).padStart(3, '0')}`,
    excelRow: r.excelRow,
    lineNo: r.lineNo,
    city: r.city,
    region: regionOf(r.mrc),
    docType: r.docType,
    nodeIds: found,
    missingNodeIds: r.nodeIds.filter((i) => !byId.has(i)),
    label,
    input: text,
    inputChars: text.length,
  });
}
const lens = items.map((i) => i.inputChars).sort((a, b) => a - b);
const t1 = lens[Math.floor(lens.length / 3)];
const t2 = lens[Math.floor((2 * lens.length) / 3)];
for (const it of items) it.lengthBucket = it.inputChars < t1 ? 'short' : it.inputChars < t2 ? 'medium' : 'long';

fs.writeFileSync(path.join(WORK, 'items.json'), JSON.stringify({
  source: { workbook: triage.source, sha256: triage.sha256, graphNodesReadFrom: pod, readAt: nodes[0]?.read_at },
  lengthTerciles: [t1, t2], items, excluded,
}, null, 1));
console.log(JSON.stringify({ items: items.length, excluded: excluded.length, terciles: [t1, t2] }));
