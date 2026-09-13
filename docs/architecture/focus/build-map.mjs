import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extractDiagrams } from './parse-mermaid.mjs';

const architecture = await readFile('../../architecture.md', 'utf8');
const proposal = await readFile('../proposal.md', 'utf8');
const graphs = [...extractDiagrams(architecture, ['Accès & composants', 'PV → Signaux · Immo', 'Geo · sources & jointures', 'Livraison ≠ refresh'], 'asis'),
  ...extractDiagrams(proposal, ['Option A · cible proposée, non déployée'], 'target')];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const docs = {};
for (const name of ['decision-dossier', 'continuation-audit', 'storage-audit', 'decision-reviews']) {
  docs[name] = await readFile(`../${name}.md`, 'utf8');
}
docs.architecture = architecture; docs.proposal = proposal;
const kitNode = await readFile('/kit/src/ArchitectureNode.svelte', 'utf8');
const manifest = { schema: 'immo-focus-mermaid-map/v1', architectureHash: sha256(architecture),
  proposalHash: sha256(proposal), dossierHash: sha256(docs['decision-dossier']),
  reference: 'Sentropic decision-kit / September 7, 2026',
  nativeFocusNodeHash: sha256(kitNode), mapping: 'Every node, edge and subgraph retained; collapsed internal edges remain in navigable subflows.',
  geometry: 'Node bounds checked; edge crossings are NOT certified zero-overlap.',
  graphs: graphs.map(g => ({ id: g.id, nodes: g.nodes.length, edges: g.edges.length, subflows: g.groups.length })) };
await mkdir('.generated', { recursive: true });
await writeFile('.generated/data.json', JSON.stringify({ graphs, docs, manifest }));
console.log(JSON.stringify(manifest));
