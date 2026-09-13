import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extractDiagrams } from './parse-mermaid.mjs';

const architecture = await readFile('../../architecture.md', 'utf8');
const proposal = await readFile('../proposal.md', 'utf8');
const graphs = [...extractDiagrams(architecture, ['Accès & composants', 'PV → Signaux · Immo', 'Geo · sources & jointures', 'Livraison ≠ refresh'], 'asis'),
  ...extractDiagrams(proposal, ['Option A · cible proposée, non déployée'], 'target')];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const docs = {};
for (const name of ['decision-dossier', 'continuation-audit', 'storage-audit', 'decision-reviews', 'decision-review-codex', 'README', 'focus-verification', 'gemini-review/response-findings', 'gemini-review/review-inline', 'gemini-review/response-mapping']) {
  docs[name.split('/').at(-1)] = await readFile(`../${name}.md`, 'utf8');
}
docs.architecture = architecture; docs.proposal = proposal;
const kitNode = await readFile('/kit/src/ArchitectureNode.svelte', 'utf8');
const kitRouter = await readFile('/kit/src/architecture-routing.js', 'utf8');
const presentation = await readFile('presentation-fr.js', 'utf8');
const choices = await readFile('choices.js', 'utf8');
const manifest = { schema: 'immo-focus-mermaid-map/v1', architectureHash: sha256(architecture),
  proposalHash: sha256(proposal), dossierHash: sha256(docs['decision-dossier']),
  reference: 'Sentropic decision-kit / September 7, 2026',
  nativeFocusNodeHash: sha256(kitNode), nativeFocusRouterHash: sha256(kitRouter),
  presentationHash: sha256(presentation), choicesHash: sha256(choices), artifactInputHash: sha256(JSON.stringify({ docs, graphs, presentation, choices })),
  mapping: 'Every node and exact edge is rendered simultaneously; subgraphs are native nested parentId boxes. Navigation changes only the viewport.',
  geometry: 'Node bounds and route/node clearance checked; edge/label/arrow crossings are NOT certified zero-overlap.',
  graphs: graphs.map(g => ({ id: g.id, nodes: g.nodes.length, edges: g.edges.length, subflows: g.groups.length })) };
await mkdir('.generated', { recursive: true });
await writeFile('.generated/data.json', JSON.stringify({ graphs, docs, manifest }));
console.log(JSON.stringify(manifest));
