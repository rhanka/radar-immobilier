import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Parseur Mermaid, gabarit, géométrie et routage : chaîne existante, pas de copie.
import { parseMermaid } from '../../../../architecture/focus/parse-mermaid.mjs';
import { decorateGraph, sceneIds } from './scene-metadata.js';

const DOSSIER = '../DOSSIER_DECISION_BACKUP_PRA_V2_2026-09-18.md';
const markdown = await readFile(DOSSIER, 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');

const expected = [
  ['architecture-sauvegardes', "Scène 1 · l'architecture des sauvegardes, immo et geo ensemble"],
  ['sequence-bout-en-bout', 'Scène 2 · la séquence de bout en bout, sauvegarde puis restauration'],
  ['mise-en-service', "Scène 3 · la preuve avant la fusion, puis l'activation simultanée"],
];
const matches = [...markdown.matchAll(/### `([^`]+)` — ([^\n]+)\n\n```mermaid\n([\s\S]*?)```/g)];
if (matches.length !== expected.length) throw Error(`canonical Mermaid count ${matches.length}, expected ${expected.length}`);
const graphs = matches.map((match, index) => {
  const [sceneId, title] = expected[index];
  if (match[1] !== sceneId) throw Error(`scene order mismatch: ${match[1]} != ${sceneId}`);
  return decorateGraph(parseMermaid(match[3], sceneId, title, 'decision', '2026-09-18'));
});
if (JSON.stringify(graphs.map(graph => graph.id)) !== JSON.stringify(sceneIds)) throw Error('scene inventory differs from the metadata table');

const canonicalProjection = graph => ({
  sceneId: graph.id, pair: graph.pair, date: graph.date,
  nodes: [...graph.nodes, ...graph.groups].map(item => ({ id: item.id, kind: item.metadata.kind,
    label: item.label, evidenceClass: item.metadata.evidenceClass, runtimeState: item.metadata.runtimeState,
    parentId: item.parent, repo: item.metadata.repo })).sort((a, b) => a.id.localeCompare(b.id)),
  edges: graph.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label,
    dashed: edge.dashed, both: edge.both, evidenceClass: edge.metadata.evidenceClass,
    runtimeState: edge.metadata.runtimeState })).sort((a, b) => a.id.localeCompare(b.id)),
});
for (const graph of graphs) {
  graph.projection = canonicalProjection(graph);
  graph.canonicalJson = JSON.stringify(graph.projection).normalize('NFC');
  graph.sceneHash = sha256(graph.canonicalJson);
}

// Le corps du dossier, découpé sur ses propres titres de niveau 2 : les 12
// sections, puis les annexes A à C. Les textes verbatim des annexes portent leurs
// propres titres « ## » (dont « ## 1. » chez Gemini) : avant l'annexe A, tout
// titre « ## » découpe ; après, seuls les titres « ## Annexe X — ». Le texte
// n'est pas réécrit, seulement découpé.
const body = markdown.split('\n## Annexe D — Scènes Focus')[0];
const annexStart = body.indexOf('\n## Annexe A — ');
if (annexStart < 0) throw Error('missing annexe A');
const [head, ...rest] = body.slice(0, annexStart).split(/\n(?=## )/);
const annexChunks = body.slice(annexStart + 1).split(/\n(?=## Annexe [A-Z] — )/);
const chunkToSection = (chunk, index) => {
  const heading = chunk.split('\n')[0].replace(/^## /, '').trim();
  return { id: `section-${index + 1}`, heading, markdown: chunk.split('\n').slice(1).join('\n').trim() };
};
const sections = [{ id: 'entete', heading: head.split('\n')[0].replace(/^# /, ''), markdown: head.split('\n').slice(1).join('\n').trim() },
  ...[...rest, ...annexChunks].map(chunkToSection)];
const decisionSections = sections.filter(section => /^\d+\. /.test(section.heading));
if (decisionSections.length !== 12) throw Error(`expected the 12 dossier sections, found ${decisionSections.length}`);
const annexes = sections.filter(section => section.heading.startsWith('Annexe'));
if (annexes.map(section => section.heading.slice(0, 8)).join() !== 'Annexe A,Annexe B,Annexe C') throw Error('annexes A, B, C expected');

const choices = await readFile('choices.js', 'utf8');
const rendererSources = Object.fromEntries(await Promise.all([
  'scenes.js', 'Flow.svelte', 'ServiceNode.svelte', 'ServiceIcon.svelte', 'Subflow.svelte',
  'RoutedEdge.svelte', 'Viewport.svelte', 'service-icons.js', 'style.css', 'parse-mermaid.mjs',
].map(async name => [name, await readFile(`../../../../architecture/focus/${name}`, 'utf8')])));

const manifest = {
  schema: 'immo-focus-712-decision-map/v2',
  dossier: 'docs/spec/reports/dossier-backup-pra-712/DOSSIER_DECISION_BACKUP_PRA_V2_2026-09-18.md',
  dossierHash: sha256(markdown), choicesHash: sha256(choices),
  reuse: 'gabarit A’, géométrie Dagre LR et routeur du kit h2a réutilisés depuis docs/architecture/focus',
  serviceRendererHash: sha256(JSON.stringify(rendererSources)),
  artifactInputHash: sha256(JSON.stringify({ markdown, graphs, choices, rendererSources })),
  mapping: 'Trois graphes Mermaid canoniques produisent trois scènes SvelteFlow natives ; les subgraphs gardent parentId.',
  geometry: 'Placement Dagre récursif rankdir LR et routeur orthogonal du kit ; carte unique A’ 460 x 200.',
  graphOrder: graphs.map(graph => graph.id),
  graphs: graphs.map(graph => ({ id: graph.id, title: graph.title, sceneHash: graph.sceneHash,
    projection: graph.projection, nodes: graph.nodes.length, edges: graph.edges.length, subflows: graph.groups.length })),
  sections: sections.map(section => ({ id: section.id, heading: section.heading })),
};
await mkdir('.generated', { recursive: true });
await writeFile('.generated/data.json', JSON.stringify({ graphs, sections, decisionSections, annexes, manifest }));
console.log(JSON.stringify(manifest.graphs.map(graph => ({ id: graph.id, nodes: graph.nodes, edges: graph.edges, subflows: graph.subflows }))));
