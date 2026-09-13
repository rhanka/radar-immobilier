import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extractDiagrams } from './parse-mermaid.mjs';
import { provenanceFor } from './service-provenance.js';

const architecture = await readFile('../../architecture.md', 'utf8');
const proposal = await readFile('../proposal.md', 'utf8');
const graphs = [...extractDiagrams(architecture, ['Accès & composants', 'PV → Signaux · Immo', 'Geo · sources & jointures', 'Livraison ≠ refresh'], 'asis'),
  ...extractDiagrams(proposal, ['Option A · cible proposée, non déployée'], 'target')];
for (const graph of graphs) for (const item of [...graph.nodes, ...graph.groups]) item.provenance = provenanceFor(graph.id, item.id);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const docs = {};
for (const name of ['decision-dossier', 'transitions', 'continuation-audit', 'storage-audit', 'service-provenance', 'decision-reviews', 'decision-review-codex', 'README', 'focus-verification', 'focus-service-review', 'gemini-review/response-findings', 'gemini-review/review-inline', 'gemini-review/response-mapping']) {
  docs[name.split('/').at(-1)] = await readFile(`../${name}.md`, 'utf8');
}
docs.architecture = architecture; docs.proposal = proposal;
const kitNode = await readFile('/kit/src/ArchitectureNode.svelte', 'utf8');
const kitRouter = await readFile('/kit/src/architecture-routing.js', 'utf8');
const presentation = await readFile('presentation-fr.js', 'utf8');
const choices = await readFile('choices.js', 'utf8');
const rendererSources = Object.fromEntries(await Promise.all(['ServiceNode.svelte', 'ServiceIcon.svelte', 'service-icons.js', 'Subflow.svelte', 'scenes.js', 'style.css', 'render-mermaid.mjs', 'mermaid-labels.mjs'].map(async name => [name, await readFile(name, 'utf8')])));
const manifest = { schema: 'immo-focus-mermaid-map/v1', architectureHash: sha256(architecture),
  proposalHash: sha256(proposal), dossierHash: sha256(docs['decision-dossier']),
  reference: 'Sentropic decision-kit / September 7, 2026',
  referenceFocusNodeHash: sha256(kitNode), nativeFocusRouterHash: sha256(kitRouter), serviceRendererHash: sha256(JSON.stringify(rendererSources)),
  presentationHash: sha256(presentation), choicesHash: sha256(choices), artifactInputHash: sha256(JSON.stringify({ docs, graphs, presentation, choices, rendererSources })),
  mapping: 'Every node and exact edge is rendered simultaneously; subgraphs are native nested parentId boxes. Navigation changes only the viewport.',
  geometry: 'Node bounds and route/node clearance checked; edge/label/arrow crossings are NOT certified zero-overlap.',
  graphs: graphs.map(g => ({ id: g.id, nodes: g.nodes.length, edges: g.edges.length, subflows: g.groups.length })) };
await mkdir('.generated', { recursive: true });
await writeFile('.generated/data.json', JSON.stringify({ graphs, docs, manifest }));
console.log(JSON.stringify(manifest));
