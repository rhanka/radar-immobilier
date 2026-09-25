import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Parseur Mermaid, gabarit, géométrie et routage : chaîne existante, pas de copie.
import { parseMermaid } from '../../../../architecture/focus/parse-mermaid.mjs';
import { decorateGraph, sceneIds } from './scene-metadata.js';
// Un seul moteur de placement sur la description canonique : ELK (rendu xyflow),
// calculé ici, au build, puis contrôlé. Le rendu Graphviz dot a été supprimé du
// dossier à la demande de l'owner (ARCH-7, verbatim « supprimer la visauliation
// grafphviz ») : modules de placement et de vue supprimés, dépendance WASM retirée
// de package.json.
import { elkLayout, SCENE_OPTIONS, FRAME_FACES, FRAME_PLAN, gridExempt } from './elk-layout.mjs';
import { checkGeometry, checkGrid, checkPlan, columnsOf, geometryFrom, legibilityFrom, LEGIBILITY, GRID, FORMATS, TEXT_ROLES } from './geometry-check.mjs';

const DOSSIER = '../DOSSIER_DECISION_BACKUP_PRA_V2_2026-09-18.md';
const markdown = await readFile(DOSSIER, 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');

// Seul l'ordre des scènes est attendu ici. Le titre, lui, est celui que porte
// l'annexe D du dossier : le figer dans ce fichier ferait afficher à la page un
// titre que le dossier ne dit plus (c'était le cas des titres de la v2).
const expected = ['architecture-sauvegardes', 'sequence-bout-en-bout', 'mise-en-service'];
const matches = [...markdown.matchAll(/### `([^`]+)` — ([^\n]+)\n\n```mermaid\n([\s\S]*?)```/g)];
if (matches.length !== expected.length) throw Error(`canonical Mermaid count ${matches.length}, expected ${expected.length}`);
const graphs = matches.map((match, index) => {
  const sceneId = expected[index];
  if (match[1] !== sceneId) throw Error(`scene order mismatch: ${match[1]} != ${sceneId}`);
  return decorateGraph(parseMermaid(match[3], sceneId, match[2].trim(), 'decision', '2026-09-20'));
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
const round = value => Math.round(value * 100) / 100;
const layoutMetrics = {};
// Porte de lisibilité (geometry-check.mjs) : une scène dont un texte, ajusté à la
// vue, passe sous 12 px à 1440 × 900, ou sous sa porte d'impression en A4 paysage
// (8 pt pour le texte de lecture, 7 pt pour l'annotation secondaire), arrête le
// build, comme une liaison mal ancrée. Seule une dérogation explicite, motivée,
// passée au build (LEGIBILITE_DEROGATION="motif"), laisse sortir la page : elle est
// inscrite au manifeste et affichée dans la page, sous chaque scène concernée.
const derogation = process.env.LEGIBILITE_DEROGATION?.trim() || null;
const legibilityFaults = [];
for (const graph of graphs) {
  const elk = await elkLayout(graph);
  const geometry = { elk: geometryFrom(graph, elk) };
  const checks = { elk: checkGeometry(geometry.elk) };
  // Porte de mise en page (scènes à cadre) : un conteneur de quatre cartes ou plus
  // rangé sur une seule colonne arrête le build, comme une liaison mal ancrée —
  // sauf ceux que le plan de l'owner range lui-même sur une colonne.
  const gridFaults = FRAME_FACES[graph.id] ? checkGrid(geometry.elk.boxes, GRID, gridExempt(graph.id)) : [];
  // Porte du plan : la mise en page imposée par l'owner, contrôlée sur le rendu.
  const planFaults = FRAME_FACES[graph.id] ? checkPlan(geometry.elk.boxes, FRAME_FACES[graph.id], FRAME_PLAN[graph.id]) : [];
  const faults = [...Object.entries(checks).flatMap(([engine, check]) => check.faults.map(fault => `${engine}: ${fault}`)),
    ...gridFaults.map(fault => `grille: ${fault}`), ...planFaults.map(fault => `plan: ${fault}`)];
  // Un placement qui échoue à un contrôle ne sort pas : le build s'arrête.
  if (faults.length) throw Error(`${graph.id} : placement refusé\n${faults.join('\n')}`);
  // Taille effective du texte, scène ajustée à la vue : cadre de chaque moteur
  // (canevas ELK) dans chaque zone d'affichage.
  const legibility = { elk: legibilityFrom(geometry.elk, elk.canvas, 'elk') };
  for (const [engine, measure] of Object.entries(legibility)) legibilityFaults.push(...measure.faults.map(fault => `${graph.id} · ${engine} · ${fault}`));
  graph.elk = { canvas: elk.canvas,
    boxes: [...graph.groups, ...graph.nodes].map(item => ({ id: item.id, ...elk.relative.get(item.id), ...elk.size.get(item.id),
      absolute: elk.absolute.get(item.id) })),
    edges: elk.edges.map(edge => ({ id: edge.id, points: edge.points.map(point => ({ x: round(point.x), y: round(point.y) })), label: edge.label })) };
  layoutMetrics[graph.id] = Object.fromEntries(Object.entries(checks).map(([engine, check]) => [engine, {
    ratio: round(check.ratio), offBorder: check.offBorder, crossings: check.crossings, detachedLabels: check.detached, labelsOnCards: check.labelOnCard,
    obliqueSegments: check.oblique, worstSingleLinkCenterPx: round(check.worstCenterPx), worstLabelDistancePx: round(check.worstLabelPx),
    singleLinkBoxes: check.singleLinkBoxes, bends: check.bends, lengthPx: round(check.lengthPx),
    grid: FRAME_FACES[graph.id] ? { gate: GRID, faults: gridFaults, exempt: [...gridExempt(graph.id)],
      columns: Object.fromEntries(graph.groups.map(group => [group.id, columnsOf(geometry.elk.boxes, group.id)])) } : null,
    plan: FRAME_FACES[graph.id] ? { faces: FRAME_FACES[graph.id], sheets: FRAME_PLAN[graph.id] ?? {}, faults: planFaults } : null,
    canvas: { width: round(elk.canvas.width), height: round(elk.canvas.height) },
    legibility: { fill: { blocks: round(legibility[engine].fill.blocks), cards: round(legibility[engine].fill.cards) },
      formats: legibility[engine].formats.map(item => ({ format: item.format, scale: item.scale, minPx: item.minPx, minRole: item.minRole,
        minPt: item.minPt, byRolePx: item.byRolePx, frameRatio: round(item.frameRatio), panelRatio: round(item.panelRatio), faults: item.faults })) } }]));
}
if (legibilityFaults.length && !derogation) throw Error(`lisibilité : page refusée\n${legibilityFaults.join('\n')}\n`
  + 'Pour produire la page malgré tout, dérogation explicite et motivée : LEGIBILITE_DEROGATION="motif".');
if (legibilityFaults.length) console.error(`lisibilité : ${legibilityFaults.length} porte(s) non tenue(s), dérogation « ${derogation} »\n${legibilityFaults.join('\n')}`);
for (const graph of graphs) {
  graph.projection = canonicalProjection(graph);
  graph.canonicalJson = JSON.stringify(graph.projection).normalize('NFC');
  graph.sceneHash = sha256(graph.canonicalJson);
}

// Le corps du dossier, découpé sur ses propres titres de niveau 2 : les 13
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
if (decisionSections.length !== 13) throw Error(`expected the 13 dossier sections, found ${decisionSections.length}`);
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
  geometry: 'Un placement sur la description canonique : ELK layered (elkjs 0.12.0), ports hiérarchiques et repliement pour les séquences, rendu xyflow. Carte unique A’ 460 x 200. Rendu Graphviz dot supprimé (ARCH-7).',
  layoutOptions: { elk: SCENE_OPTIONS }, layoutMetrics,
  legibility: { gate: LEGIBILITY, formats: FORMATS, textRoles: TEXT_ROLES, faults: legibilityFaults, derogation },
  graphOrder: graphs.map(graph => graph.id),
  graphs: graphs.map(graph => ({ id: graph.id, title: graph.title, sceneHash: graph.sceneHash,
    projection: graph.projection, nodes: graph.nodes.length, edges: graph.edges.length, subflows: graph.groups.length })),
  sections: sections.map(section => ({ id: section.id, heading: section.heading })),
};
await mkdir('.generated', { recursive: true });
await writeFile('.generated/data.json', JSON.stringify({ graphs, sections, decisionSections, annexes, manifest }));
console.log(JSON.stringify(manifest.graphs.map(graph => ({ id: graph.id, nodes: graph.nodes, edges: graph.edges, subflows: graph.subflows }))));
console.log(JSON.stringify(layoutMetrics));
