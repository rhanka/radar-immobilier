import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extractCanonicalDiagrams } from './parse-mermaid.mjs';
import { decorateGraph } from './scene-metadata.js';

const architecture = await readFile('../../architecture.md', 'utf8');
const proposal = await readFile('../proposal.md', 'utf8');
const transitionTargets = await readFile('../transitions-target.md', 'utf8');
const graphs = extractCanonicalDiagrams(architecture).map(decorateGraph);
const sha256 = value => createHash('sha256').update(value).digest('hex');
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
const docs = {};
for (const name of ['decision-dossier', 'transitions', 'transitions-target', 'continuation-audit', 'storage-audit', 'service-provenance', 'decision-reviews', 'decision-review-codex', 'README', 'focus-verification', 'focus-service-review', 'gemini-review/response-findings', 'gemini-review/review-inline', 'gemini-review/response-mapping']) {
  docs[name.split('/').at(-1)] = await readFile(`../${name}.md`, 'utf8');
}
docs.architecture = architecture; docs.proposal = proposal; docs['transitions-target'] = transitionTargets;
const presentation = await readFile('presentation-fr.js', 'utf8');
const choices = await readFile('choices.js', 'utf8');
const rendererSources = Object.fromEntries(await Promise.all(['ServiceNode.svelte', 'ServiceIcon.svelte', 'service-icons.js', 'Subflow.svelte', 'scenes.js', 'style.css', 'render-mermaid.mjs', 'mermaid-labels.mjs'].map(async name => [name, await readFile(name, 'utf8')])));
const manifest = { schema: 'immo-focus-mermaid-map/v3', architectureHash: sha256(architecture),
  proposalHash: sha256(proposal), transitionTargetsHash: sha256(transitionTargets), dossierHash: sha256(docs['decision-dossier']),
  reference: 'docs/architecture.md / two dated transitions',
  serviceRendererHash: sha256(JSON.stringify(rendererSources)),
  presentationHash: sha256(presentation), choicesHash: sha256(choices), artifactInputHash: sha256(JSON.stringify({ docs, graphs, presentation, choices, rendererSources })),
  mapping: 'Four complete canonical Mermaid graphs produce four native SvelteFlow scenes; subgraphs retain parentId.',
  geometry: 'Native scenes render at scale(1); Chromium verifies compact cards, readable text and complete inventory.',
  graphOrder: graphs.map(graph => graph.id),
  graphs: graphs.map(g => ({ id: g.id, pair: g.pair, date: g.date, sceneHash: g.sceneHash,
    projection: g.projection, nodes: g.nodes.length, edges: g.edges.length, subflows: g.groups.length })) };
await mkdir('.generated', { recursive: true });
await writeFile('.generated/data.json', JSON.stringify({ graphs, docs, manifest }));
console.log(JSON.stringify(manifest));
