import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Parseur Mermaid, gabarit, géométrie et routage : chaîne existante, pas de copie.
import { parseMermaid } from '../../../../architecture/focus/parse-mermaid.mjs';
import { decorateGraph, sceneIds } from './scene-metadata.js';

const DOSSIER = '../DOSSIER_DECISION_VILLES_ECART_2026-10-04.md';
const markdown = await readFile(DOSSIER, 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');
// Must match portable.mjs: 64 zeros, present exactly once in the bundled page.
const HTML_SHA256_PLACEHOLDER = '0'.repeat(64);

const expected = [
  ['architecture-ecart', 'Scène 1 · qui écrit et qui lit le graphe d’une ville'],
];
const [body, annexB] = markdown.split('\n## Annexe B — Scène Focus');
if (!annexB) throw Error('missing Annexe B');
const matches = [...annexB.matchAll(/### `([^`]+)` — ([^\n]+)\n\n```mermaid\n([\s\S]*?)```/g)];
if (matches.length !== expected.length) throw Error(`canonical Mermaid count ${matches.length}, expected ${expected.length}`);
const graphs = matches.map((match, index) => {
  const [sceneId, title] = expected[index];
  if (match[1] !== sceneId) throw Error(`scene order mismatch: ${match[1]} != ${sceneId}`);
  if (match[2].trim().replace(/'/g, '’') !== title) throw Error(`scene title mismatch: ${match[2]} != ${title}`);
  return decorateGraph(parseMermaid(match[3], sceneId, title, 'decision', '2026-10-04'));
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

// Le corps du dossier, découpé sur ses titres de niveau 2 : les 9 sections,
// puis l'annexe A (listes). Le texte n'est pas réécrit. Les blocs Mermaid du
// corps sont remplacés par un renvoi : la page les rend en scène native
// (annexe B) ou en Figure 2 (tables), le Markdown reste la source lisible.
const mermaidNote = '> Diagramme : voir la Figure 2 (tables) rendue dans la page ; la source Mermaid reste dans le Markdown du dossier.';
const [head, ...rest] = body.split(/\n## /);
const strip = text => text.replace(/```mermaid\n[\s\S]*?```/g, mermaidNote);
const sections = [{ id: 'entete', heading: head.split('\n')[0].replace(/^# /, ''), markdown: strip(head.split('\n').slice(1).join('\n').trim()) },
  ...rest.map((chunk, index) => {
    const heading = chunk.split('\n')[0].trim();
    return { id: `section-${index + 1}`, heading, markdown: strip(chunk.split('\n').slice(1).join('\n').trim()) };
  })];
const numbered = sections.filter(section => /^[1-9]\./.test(section.heading));
if (numbered.length !== 9) throw Error(`expected the 9 dossier sections, found ${numbered.length}`);
const annexes = sections.filter(section => section.heading.startsWith('Annexe'));
if (annexes.length !== 1 || !annexes[0].heading.startsWith('Annexe A')) throw Error('missing the city lists annexe');
const header = sections[0];

// §7 : chaque décision (### Dx — titre) est rendue dans son bloc de choix, avec
// son introduction, son tableau Avantages / Inconvénients et sa recommandation.
const options = numbered.find(section => section.heading.startsWith('7.'));
const [optionsIntro, ...decisionChunks] = options.markdown.split(/\n### (?=D\d+ — )/);
const decisionDetails = Object.fromEntries(decisionChunks.map(chunk => {
  const [title, ...lines] = chunk.split('\n');
  const key = title.match(/^(D\d+) — /)[1];
  if (!/\| Option \| Avantages \| Inconvénients \|/.test(chunk)) throw Error(`${key}: options table needs Avantages and Inconvénients`);
  if (!/\nRecommandation \*\*/.test(chunk)) throw Error(`${key}: recommendation line missing`);
  // La ligne « Décide · Consulté » du Markdown est portée par les badges du bloc : retirée ici.
  const markdown = lines.join('\n').trim();
  if (!/^\*\*Décide : Fabien/.test(markdown)) throw Error(`${key}: decider line missing`);
  return [key, { title: title.trim(), markdown: markdown.replace(/^\*\*Décide :[^\n]*\n+/, '') }];
}));
if (Object.keys(decisionDetails).join() !== 'D1,D2,D3,D4,D5,D6,D7') throw Error(`decisions ${Object.keys(decisionDetails)}`);
const [intention, context, synthesis, ...rest2] = numbered;
const body2 = rest2.filter(section => !section.heading.startsWith('7.'));

const choices = (await readFile('choices.js', 'utf8')) + (await readFile('roles.json', 'utf8')) + (await readFile('decision-yaml.js', 'utf8'));
const figure = (await readFile('TableDiagram.svelte', 'utf8')) + (await readFile('groups.js', 'utf8'));
const rendererSources = Object.fromEntries(await Promise.all([
  'scenes.js', 'Flow.svelte', 'ServiceNode.svelte', 'ServiceIcon.svelte', 'Subflow.svelte',
  'RoutedEdge.svelte', 'Viewport.svelte', 'service-icons.js', 'style.css', 'parse-mermaid.mjs',
].map(async name => [name, await readFile(`../../../../architecture/focus/${name}`, 'utf8')])));

const manifest = {
  schema: 'immo-focus-villes-ecart-decision-map/v1',
  dossier: 'docs/spec/reports/dossier-villes-ecart/DOSSIER_DECISION_VILLES_ECART_2026-10-04.md',
  title: header.heading,
  // Placeholder for the page's own sha256, replaced by portable.mjs (see there).
  htmlSha256: HTML_SHA256_PLACEHOLDER,
  dossierHash: sha256(markdown), choicesHash: sha256(choices), figureHash: sha256(figure),
  reuse: 'gabarit A’, géométrie Dagre LR et routeur du kit h2a réutilisés depuis docs/architecture/focus',
  serviceRendererHash: sha256(JSON.stringify(rendererSources)),
  artifactInputHash: sha256(JSON.stringify({ markdown, graphs, choices, figure, rendererSources })),
  mapping: 'Un graphe Mermaid canonique produit une scène SvelteFlow native ; chaque subgraph est un couloir vertical parentId.',
  geometry: 'Placement Dagre récursif rankdir LR et routeur orthogonal du kit ; carte unique A’ 460 x 200.',
  graphOrder: graphs.map(graph => graph.id),
  graphs: graphs.map(graph => ({ id: graph.id, title: graph.title, sceneHash: graph.sceneHash,
    projection: graph.projection, nodes: graph.nodes.length, edges: graph.edges.length, subflows: graph.groups.length })),
  sections: sections.map(section => ({ id: section.id, heading: section.heading })),
};
await mkdir('.generated', { recursive: true });
await writeFile('.generated/data.json', JSON.stringify({ graphs, sections, header, intention, context, synthesis,
  body: body2, optionsIntro: optionsIntro.trim(), decisionDetails, annexes, manifest }));
console.log(JSON.stringify(manifest.graphs.map(graph => ({ id: graph.id, nodes: graph.nodes, edges: graph.edges, subflows: graph.subflows }))));
