import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Parseur Mermaid, gabarit, géométrie et routage : chaîne existante, pas de copie.
import { parseMermaid } from '../../../../architecture/focus/parse-mermaid.mjs';
import { decorateGraph, sceneIds } from './scene-metadata.js';
import { parseEr } from './parse-er.mjs';
import { erLayout, laneLayout } from './diagram-layout.js';
import { SCENE_KINDS, MATRIX, ER_SPEC, LANE_SPECS } from './diagram-specs.js';

const DOSSIER = '../DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md';
const markdown = await readFile(DOSSIER, 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');
// Must match portable.mjs: 64 zeros, present exactly once in the bundled page.
const HTML_SHA256_PLACEHOLDER = '0'.repeat(64);

const expected = [
  ['criteres-steve', "Scène 1 · les trois critères de Steve en regard de l'existant"],
  ['modele-donnees', 'Scène 2 · stockage réel et propriétaires : Postgres, S3, geo, dépôt'],
  ['flux-import-oracle', "Scène 3 · architecture de l'import à l'affichage, jeu de référence transversal"],
  ['architecture-ui', 'Scène 4 · architecture UI et état de la migration'],
  ['affichage-abc', "Scène 5 · A, B et C : ce que voit l'application, ce que mesure l'évaluation"],
];
const [body, annexB] = markdown.split('\n## Annexe B — Scènes Focus');
if (!annexB) throw Error('missing Annexe B');
// Each scene: a Mermaid block (flowchart or erDiagram) or, for the matrix, a Markdown table.
const matches = [...annexB.matchAll(/### `([^`]+)` — ([^\n]+)\n\n(```mermaid\n[\s\S]*?```|(?:\|[^\n]*\n)+)/g)];
if (matches.length !== expected.length) throw Error(`canonical scene count ${matches.length}, expected ${expected.length}`);
const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

// Matrix: one row per criterion, a closed coverage value, a noise count that adds up.
function matrixScene(source, id, title) {
  const [head, rule, ...lines] = source.trim().split('\n');
  if (JSON.stringify(cells(head)) !== JSON.stringify(MATRIX.columns) || !/^\|[-:| ]+\|$/.test(rule)) throw Error(`${id}: matrix header`);
  const rows = lines.map(line => {
    const [criterion, steve, radar, coverage, noise] = cells(line);
    return { criterion, steve, radar, coverage, noise: Number(noise) };
  });
  const total = rows.pop();
  if (total.criterion !== MATRIX.totalRow) throw Error(`${id}: missing total row`);
  for (const row of rows) if (!MATRIX.coverage.includes(row.coverage) || !Number.isInteger(row.noise)) throw Error(`${id}: bad row ${row.criterion}`);
  if (rows.reduce((sum, row) => sum + row.noise, 0) !== total.noise) throw Error(`${id}: noise does not add up`);
  const projection = { sceneId: id, kind: 'matrix', rows, total: { ...total, workingView: MATRIX.workingView } };
  return { id, title, kind: 'matrix', date: '2026-10-03', source, projection };
}

function erScene(source, id, title) {
  const model = parseEr(source, id);
  for (const name of ER_SPEC.existing) if (!model.entities.some(entity => entity.id === name)) throw Error(`${id}: existing table ${name} missing`);
  const entities = model.entities.map(entity => ({ ...entity, existing: ER_SPEC.existing.includes(entity.id), status: ER_SPEC.status?.[entity.id], owner: ER_SPEC.owner?.[entity.id] }));
  const projection = { sceneId: id, kind: 'er',
    entities: entities.map(entity => ({ id: entity.id, existing: entity.existing, columns: entity.attributes.map(attribute => [attribute.name, ...attribute.keys].join(' ')) })),
    relations: model.relations.map(({ line, ...relation }) => relation) };
  return { id, title, kind: 'er', date: '2026-10-03', source, entities, relations: model.relations, projection, layout: erLayout(model, ER_SPEC) };
}

function laneScene(source, id, title) {
  const LANE_SPEC = LANE_SPECS[id];
  if (!LANE_SPEC) throw Error(`${id}: no lane spec`);
  const graph = parseMermaid(source, id, title, 'decision', '2026-10-03');
  const lanes = [...LANE_SPEC.lanes.map(lane => lane.id), LANE_SPEC.band.id];
  for (const lane of lanes) if (!graph.groups.some(group => group.id === lane && group.parent === null)) throw Error(`${id}: lane ${lane} missing`);
  const laneOf = item => { while (item && !lanes.includes(item.id)) item = graph.groups.find(group => group.id === item.parent); return item?.id; };
  for (const item of graph.nodes) if (!LANE_SPEC.nodes[item.id]) throw Error(`${id}: no lane metadata for ${item.id}`);
  for (const key of Object.keys(LANE_SPEC.nodes)) if (!graph.nodes.some(item => item.id === key)) throw Error(`${id}: extra lane metadata ${key}`);
  for (const key of Object.keys(LANE_SPEC.edges)) if (!graph.edges.some(edge => `${edge.source}|${edge.target}` === key)) throw Error(`${id}: extra edge metadata ${key}`);
  const nodes = graph.nodes.map(item => ({ ...item, lane: laneOf(item), ...LANE_SPEC.nodes[item.id] }));
  const edges = graph.edges.map(edge => ({ ...edge, evidence: LANE_SPEC.edges[`${edge.source}|${edge.target}`] ?? 'declared' }));
  const projection = { sceneId: id, kind: 'lanes', laneKinds: LANE_SPEC.lanes.map(lane => lane.kind), zone: LANE_SPEC.zone?.title ?? null,
    stores: graph.groups.filter(group => group.parent && lanes.includes(group.parent)).length,
    lanes: graph.groups.map(group => ({ id: group.id, label: group.label, parentId: group.parent })),
    nodes: nodes.map(item => ({ id: item.id, label: item.label, lane: item.lane, parentId: item.parent, evidence: item.evidence, tag: item.tag, detail: item.detail })),
    edges: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label, evidence: edge.evidence })) };
  return { id, title, kind: 'lanes', date: '2026-10-03', source, groups: graph.groups, nodes, edges, projection, layout: laneLayout(graph, LANE_SPEC) };
}

const graphs = matches.map((match, index) => {
  const [sceneId, title] = expected[index];
  if (match[1] !== sceneId) throw Error(`scene order mismatch: ${match[1]} != ${sceneId}`);
  if (match[2].trim() !== title) throw Error(`scene title mismatch: ${match[2]} != ${title}`);
  const block = match[3].startsWith('```mermaid') ? match[3].replace(/^```mermaid\n/, '').replace(/```$/, '') : match[3];
  const kind = SCENE_KINDS[sceneId];
  if (kind === 'matrix') return matrixScene(block, sceneId, title);
  if (kind === 'er') return erScene(block, sceneId, title);
  if (kind === 'lanes') return laneScene(block, sceneId, title);
  return { ...decorateGraph(parseMermaid(block, sceneId, title, 'decision', '2026-10-03')), kind: 'flow' };
});
if (JSON.stringify(graphs.filter(graph => graph.kind === 'flow').map(graph => graph.id)) !== JSON.stringify(sceneIds)) throw Error('scene inventory differs from the metadata table');

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
  if (graph.kind === 'flow') graph.projection = canonicalProjection(graph);
  graph.canonicalJson = JSON.stringify(graph.projection).normalize('NFC');
  graph.sceneHash = sha256(graph.canonicalJson);
}

// Le corps du dossier, découpé sur ses titres de niveau 2 : les 12 sections,
// puis l'annexe A (convergence). Le texte n'est pas réécrit. Seuls les blocs
// Mermaid du corps sont remplacés par un renvoi : la page les rend en scènes
// natives (annexe B), le Markdown reste la source lisible telle quelle.
const mermaidNote = '> Diagramme : rendu dans la page, dans les scènes Focus ou dans les options de décision (source Mermaid dans le Markdown du dossier).';
const [head, ...rest] = body.split(/\n## /);
// A Mermaid block followed by a diagram marker is rendered natively at the marker.
const strip = text => text.replace(/```mermaid\n(?:(?!```)[\s\S])*```\n\n(<!-- (?:diagram|lanes):[\w-]+ -->)/g, '$1').replace(/```mermaid\n[\s\S]*?```/g, mermaidNote);
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
// Glossaire, en tête du dossier : rendu ouvert dans la page, juste après « Comment lire ce dossier ».
const glossary = sections.find(section => section.heading === 'Glossaire');
if (!glossary) throw Error('missing the glossary');

const choices = (await readFile('choices.js', 'utf8')) + (await readFile('roles.json', 'utf8')) + (await readFile('decision-yaml.js', 'utf8'));
const rendererSources = Object.fromEntries(await Promise.all([
  'scenes.js', 'Flow.svelte', 'ServiceNode.svelte', 'ServiceIcon.svelte', 'Subflow.svelte',
  'RoutedEdge.svelte', 'Viewport.svelte', 'service-icons.js', 'style.css', 'parse-mermaid.mjs',
].map(async name => [name, await readFile(`../../../../architecture/focus/${name}`, 'utf8')])));
// Renderers of the matrix, table and swimlane scenes, local to this dossier.
const diagramSources = Object.fromEntries(await Promise.all([
  'diagram-router.js', 'diagram-layout.js', 'diagram-specs.js', 'parse-er.mjs', 'DiagramFrame.svelte', 'ErDiagram.svelte',
  'LaneDiagram.svelte', 'MatrixScene.svelte', 'Scenes.svelte', 'BarChart.svelte', 'charts.js', 'Sections.svelte', 'protocol.js', 'ZoomFrame.svelte', 'doc-diagrams.js', 'option-details.js', 'steve-model.js', 'physical-model.js', 'generic-decisions.js',
].map(async name => [name, await readFile(name, 'utf8')])));

const manifest = {
  schema: 'immo-focus-steve-decision-map/v1',
  dossier: 'docs/spec/reports/dossier-retours-steve/DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md',
  title: header.heading,
  // Placeholder for the page's own sha256, replaced by portable.mjs (see there).
  htmlSha256: HTML_SHA256_PLACEHOLDER,
  dossierHash: sha256(markdown), choicesHash: sha256(choices),
  reuse: 'gabarit A’, géométrie Dagre LR et routeur du kit h2a réutilisés depuis docs/architecture/focus',
  serviceRendererHash: sha256(JSON.stringify(rendererSources)), diagramRendererHash: sha256(JSON.stringify(diagramSources)),
  artifactInputHash: sha256(JSON.stringify({ markdown, graphs, choices, rendererSources, diagramSources })),
  mapping: 'Scène 1 : matrice (tableau Markdown) ; scène 2 : erDiagram rendu en tables et relations ; scène 3 : flowchart en couloirs verticaux, jeu de référence en bande basse ; scènes 4 et 5 : SvelteFlow natif, subgraphs en parentId.',
  geometry: 'Scènes 4 et 5 : Dagre récursif rankdir LR et routeur orthogonal du kit, carte A’ 460 x 200 ; scènes 2 et 3 : grille explicite et routeur orthogonal A* du dossier.',
  graphOrder: graphs.map(graph => graph.id),
  graphs: graphs.map(graph => ({ id: graph.id, title: graph.title, kind: graph.kind, sceneHash: graph.sceneHash, projection: graph.projection,
    nodes: (graph.nodes ?? graph.entities ?? graph.projection.rows).length, edges: (graph.edges ?? graph.relations ?? []).length, subflows: (graph.groups ?? []).length })),
  sections: sections.map(section => ({ id: section.id, heading: section.heading })),
};
await mkdir('.generated', { recursive: true });
// Lane diagrams of the text: the Mermaid block just above each <!-- lanes:<id> --> marker.
const docLanes = Object.fromEntries([...markdown.matchAll(/```mermaid\n((?:(?!```)[\s\S])*)```\n\n<!-- lanes:([\w-]+) -->/g)]
  .map(([, source, id]) => [id, laneScene(source, id, id)]));
await writeFile('.generated/data.json', JSON.stringify({ graphs, sections, header, glossary, decisionSections, annexes, manifest, docLanes }));
console.log(JSON.stringify(manifest.graphs.map(graph => ({ id: graph.id, nodes: graph.nodes, edges: graph.edges, subflows: graph.subflows }))));
