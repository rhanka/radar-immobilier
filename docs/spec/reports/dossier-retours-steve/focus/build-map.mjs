import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Parseur Mermaid, gabarit, géométrie et routage : chaîne existante, pas de copie.
import { parseMermaid } from '../../../../architecture/focus/parse-mermaid.mjs';
import { decorateGraph, sceneIds } from './scene-metadata.js';

const DOSSIER = '../DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md';
const markdown = await readFile(DOSSIER, 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');
// Must match portable.mjs: 64 zeros, present exactly once in the bundled page.
const HTML_SHA256_PLACEHOLDER = '0'.repeat(64);

const expected = [
  ['criteres-steve', "Scène 1 · les trois critères de Steve en regard de l'existant"],
  ['modele-donnees', 'Scène 2 · modèle de données, de la source à la publication'],
  ['flux-import-oracle', 'Scène 3 · flux import, annotation, oracle et affichage'],
  ['architecture-ui', 'Scène 4 · architecture UI et état de la migration'],
  ['affichage-abc', 'Scène 5 · A, B et C sur le même inventaire'],
];
const [body, annexB] = markdown.split('\n## Annexe B — Scènes Focus');
if (!annexB) throw Error('missing Annexe B');
const matches = [...annexB.matchAll(/### `([^`]+)` — ([^\n]+)\n\n```mermaid\n([\s\S]*?)```/g)];
if (matches.length !== expected.length) throw Error(`canonical Mermaid count ${matches.length}, expected ${expected.length}`);
const graphs = matches.map((match, index) => {
  const [sceneId, title] = expected[index];
  if (match[1] !== sceneId) throw Error(`scene order mismatch: ${match[1]} != ${sceneId}`);
  if (match[2].trim() !== title) throw Error(`scene title mismatch: ${match[2]} != ${title}`);
  return decorateGraph(parseMermaid(match[3], sceneId, title, 'decision', '2026-10-03'));
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

// Le corps du dossier, découpé sur ses titres de niveau 2 : les 12 sections,
// puis l'annexe A (convergence). Le texte n'est pas réécrit. Seuls les blocs
// Mermaid du corps sont remplacés par un renvoi : la page les rend en scènes
// natives (annexe B), le Markdown reste la source lisible telle quelle.
const mermaidNote = '> Diagramme : voir les scènes Focus rendues plus bas (source Mermaid dans le Markdown du dossier).';
const [head, ...rest] = body.split(/\n## /);
const strip = text => text.replace(/```mermaid\n[\s\S]*?```/g, mermaidNote);
const sections = [{ id: 'entete', heading: head.split('\n')[0].replace(/^# /, ''), markdown: strip(head.split('\n').slice(1).join('\n').trim()) },
  ...rest.map((chunk, index) => {
    const heading = chunk.split('\n')[0].trim();
    return { id: `section-${index + 1}`, heading, markdown: strip(chunk.split('\n').slice(1).join('\n').trim()) };
  })];
const decisionSections = sections.filter(section => /^(1[0-2]|[1-9])\./.test(section.heading));
if (decisionSections.length !== 12) throw Error(`expected the 12 dossier sections, found ${decisionSections.length}`);
const annexes = sections.filter(section => section.heading.startsWith('Annexe'));
if (annexes.length !== 1 || !annexes[0].heading.startsWith('Annexe A')) throw Error('missing the convergence annexe');
const header = sections[0];

const choices = (await readFile('choices.js', 'utf8')) + (await readFile('roles.json', 'utf8')) + (await readFile('decision-yaml.js', 'utf8'));
const rendererSources = Object.fromEntries(await Promise.all([
  'scenes.js', 'Flow.svelte', 'ServiceNode.svelte', 'ServiceIcon.svelte', 'Subflow.svelte',
  'RoutedEdge.svelte', 'Viewport.svelte', 'service-icons.js', 'style.css', 'parse-mermaid.mjs',
].map(async name => [name, await readFile(`../../../../architecture/focus/${name}`, 'utf8')])));

const manifest = {
  schema: 'immo-focus-steve-decision-map/v1',
  dossier: 'docs/spec/reports/dossier-retours-steve/DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md',
  title: header.heading,
  // Placeholder for the page's own sha256, replaced by portable.mjs (see there).
  htmlSha256: HTML_SHA256_PLACEHOLDER,
  dossierHash: sha256(markdown), choicesHash: sha256(choices),
  reuse: 'gabarit A’, géométrie Dagre LR et routeur du kit h2a réutilisés depuis docs/architecture/focus',
  serviceRendererHash: sha256(JSON.stringify(rendererSources)),
  artifactInputHash: sha256(JSON.stringify({ markdown, graphs, choices, rendererSources })),
  mapping: 'Cinq graphes Mermaid canoniques produisent cinq scènes SvelteFlow natives ; les subgraphs gardent parentId.',
  geometry: 'Placement Dagre récursif rankdir LR et routeur orthogonal du kit ; carte unique A’ 460 x 200.',
  graphOrder: graphs.map(graph => graph.id),
  graphs: graphs.map(graph => ({ id: graph.id, title: graph.title, sceneHash: graph.sceneHash,
    projection: graph.projection, nodes: graph.nodes.length, edges: graph.edges.length, subflows: graph.groups.length })),
  sections: sections.map(section => ({ id: section.id, heading: section.heading })),
};
await mkdir('.generated', { recursive: true });
await writeFile('.generated/data.json', JSON.stringify({ graphs, sections, header, decisionSections, annexes, manifest }));
console.log(JSON.stringify(manifest.graphs.map(graph => ({ id: graph.id, nodes: graph.nodes, edges: graph.edges, subflows: graph.subflows }))));
