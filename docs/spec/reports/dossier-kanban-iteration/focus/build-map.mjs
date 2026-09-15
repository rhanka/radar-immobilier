import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Parseur Mermaid, gabarit, géométrie et routage : chaîne existante, pas de copie.
import { parseMermaid } from '../../../../architecture/focus/parse-mermaid.mjs';
import { decorateGraph, sceneIds } from './scene-metadata.js';

const DOSSIER = '../../DOSSIER_DECISION_KANBAN_ITERATION_2026-09-14.md';
const markdown = await readFile(DOSSIER, 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');

const expected = [
  ['way-of-working', 'Scène 1 · les 8 colonnes owner et « En prod (clos) »'],
  ['iteration-15-jours', 'Scène 2 · les neuf items dans leur colonne de départ'],
];
const matches = [...markdown.matchAll(/### `([^`]+)` — ([^\n]+)\n\n```mermaid\n([\s\S]*?)```/g)];
if (matches.length !== expected.length) throw Error(`canonical Mermaid count ${matches.length}, expected ${expected.length}`);
const graphs = matches.map((match, index) => {
  const [sceneId, title] = expected[index];
  if (match[1] !== sceneId) throw Error(`scene order mismatch: ${match[1]} != ${sceneId}`);
  return decorateGraph(parseMermaid(match[3], sceneId, title, 'decision', '2026-09-14'));
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

// Le corps du dossier, découpé sur ses titres de niveau 2 : les 7 sections
// demandées, puis les annexes. Le texte n'est pas réécrit, seulement découpé.
const body = markdown.split('\n## Annexe B — Scènes Focus')[0];
const [head, ...rest] = body.split(/\n## /);
const sections = [{ id: 'entete', heading: head.split('\n')[0].replace(/^# /, ''), markdown: head.split('\n').slice(1).join('\n').trim() },
  ...rest.map((chunk, index) => {
    const heading = chunk.split('\n')[0].trim();
    return { id: `section-${index + 1}`, heading, markdown: chunk.split('\n').slice(1).join('\n').trim() };
  })];
const decisionSections = sections.filter(section => /^[1-7]\./.test(section.heading));
if (decisionSections.length !== 7) throw Error(`expected the 7 dossier sections, found ${decisionSections.length}`);
const annexes = sections.filter(section => section.heading.startsWith('Annexe'));
if (!annexes.length) throw Error('missing annexe A');

const choices = await readFile('choices.js', 'utf8');
const rendererSources = Object.fromEntries(await Promise.all([
  'scenes.js', 'Flow.svelte', 'ServiceNode.svelte', 'ServiceIcon.svelte', 'Subflow.svelte',
  'RoutedEdge.svelte', 'Viewport.svelte', 'service-icons.js', 'style.css', 'parse-mermaid.mjs',
].map(async name => [name, await readFile(`../../../../architecture/focus/${name}`, 'utf8')])));

const manifest = {
  schema: 'immo-focus-kanban-decision-map/v1',
  dossier: 'docs/spec/reports/DOSSIER_DECISION_KANBAN_ITERATION_2026-09-14.md',
  dossierHash: sha256(markdown), choicesHash: sha256(choices),
  reuse: 'gabarit A’, géométrie Dagre LR et routeur du kit h2a réutilisés depuis docs/architecture/focus',
  serviceRendererHash: sha256(JSON.stringify(rendererSources)),
  artifactInputHash: sha256(JSON.stringify({ markdown, graphs, choices, rendererSources })),
  mapping: 'Deux graphes Mermaid canoniques produisent deux scènes SvelteFlow natives ; les subgraphs gardent parentId.',
  geometry: 'Placement Dagre récursif rankdir LR et routeur orthogonal du kit ; carte unique A’ 460 x 200.',
  graphOrder: graphs.map(graph => graph.id),
  graphs: graphs.map(graph => ({ id: graph.id, title: graph.title, sceneHash: graph.sceneHash,
    projection: graph.projection, nodes: graph.nodes.length, edges: graph.edges.length, subflows: graph.groups.length })),
  sections: sections.map(section => ({ id: section.id, heading: section.heading })),
};
await mkdir('.generated', { recursive: true });
await writeFile('.generated/data.json', JSON.stringify({ graphs, sections, decisionSections, annexes, manifest }));
console.log(JSON.stringify(manifest.graphs.map(graph => ({ id: graph.id, nodes: graph.nodes, edges: graph.edges, subflows: graph.subflows }))));
