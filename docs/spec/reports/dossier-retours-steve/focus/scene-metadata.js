// Contenu des cartes du dossier de décision « retours de Steve ».
// Le gabarit, la géométrie et le routage viennent de la chaîne existante
// (`docs/architecture/focus`), qui importe elle-même le kit h2a monté en /kit.
// Ici : uniquement le contenu de la scène de composants (4) et le contrôle de contrat.
// Les scènes 1, 2, 3 et 5 (matrice, entité-relation, couloirs) sont dans diagram-specs.js.
// Classes : observed = constaté dans le code ou les fichiers ; declared = proposé
// par le dossier, non réalisé ; historical = référence gelée.
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';

const EVIDENCE = new Set(['observed', 'declared', 'historical', 'dormant', 'unknown', 'external']);
const RUNTIME = new Set(['active', 'suspended', 'dormant', 'manual', 'retained', 'unknown', 'not-applicable']);

const IMMO = ['radar-immobilier'];
const SENT = ['sentropic'];
const A = (repo, kind, evidenceClass, runtimeState, icon, spec) => ({
  card: 'A', kind, repo: [...repo].sort(), evidenceClass, runtimeState, icon,
  code: spec.code ?? '', role: spec.role ?? '', name: spec.name ?? '', detail: spec.detail ?? '',
});
const BOX = (repo, evidenceClass, runtimeState, spec) => ({
  card: 'box', kind: 'cluster', repo: [...repo].sort(), evidenceClass, runtimeState, icon: 'cluster',
  code: spec.code ?? '', role: '', name: spec.name ?? '', detail: '',
});
const e = (evidenceClass, runtimeState) => ({ evidenceClass, runtimeState });
// Proposé par le dossier, non réalisé.
const P = (kind, icon, spec) => A(IMMO, kind, 'declared', 'dormant', icon, spec);
// Constaté sur origin/main 27891b10 (ou dans les fichiers de Steve).
const O = (kind, icon, spec, repo = IMMO) => A(repo, kind, 'observed', 'active', icon, spec);
const PROPOSED = e('declared', 'dormant');
const OBSERVED = e('observed', 'active');

const scenes = {
  // Scène 4 — §8 : état mesuré de l'UI et de ses dépendances sentropic.
  'architecture-ui': {
    nodes: {
      U1: BOX(IMMO, 'observed', 'active', { code: 'U1', name: 'ui · Vite + Svelte 5' }),
      SMV: O('ui', 'web', { code: 'C-01', role: 'Vue · Signaux', name: 'SignauxMapView', detail: 'importe le DS' }),
      GCB: O('ui', 'map', { code: 'C-02', role: 'Carte · locale', name: 'GeoCityMapBase', detail: 'MapLibre · 2 761 lignes' }),
      SSP: O('ui', 'web', { code: 'C-03', role: 'Panneau · signal', name: 'SignauxSelPanel', detail: 'DS partiel · 16 boutons bruts' }),
      RAIL: O('ui', 'web', { code: 'C-04', role: 'Rail · DS', name: 'SignauxRail', detail: 'vivier B seul (f2c20573)' }),
      COL: O('ui', 'unknown', { code: 'C-05', role: 'Notes · non DS', name: 'collab/* · 3 composants', detail: '0 sur 3 importent le DS' }),
      AV: P('ui', 'check', { code: 'C-06', role: 'Nouveau · U1', name: 'Avis de Steve', detail: 'Badge · Card · Alert' }),
      GV: O('ui', 'map', { code: 'C-07', role: 'Pilote · geo', name: 'GeoView sur #/geo', detail: 'GeoMap + GeoDetailPanel' }),
      U2: BOX(IMMO, 'observed', 'active', { code: 'U2', name: 'api · Hono' }),
      GS: O('route', 'api', { code: 'R-01', role: 'Route · vivier', name: '/api/graph-signals', detail: 'B′ calculé côté serveur' }),
      PNA: O('route', 'api', { code: 'R-02', role: 'Route · notes', name: '/api/v1/prospects/notes', detail: 'signal_id UUID exigé' }),
      ANN: P('route', 'api', { code: 'R-03', role: 'Route · nouvelle', name: 'Annotations en lecture', detail: 'lecture groupée · lot L2' }),
      U3: BOX(SENT, 'observed', 'active', { code: 'U3', name: 'sentropic' }),
      DS: O('package', 'web', { code: 'S-01', role: 'Paquet · DS', name: 'design-system-svelte', detail: '39 sur 69 composants' }, SENT),
      GEO: O('package', 'map', { code: 'S-02', role: 'Paquet · geo', name: 'geo-ui-svelte', detail: 'moteur 3D désactivé' }, SENT),
      CMS: O('package', 'api', { code: 'S-03', role: 'Paquet · fils', name: 'comments 0.2.0', detail: 'delete physique par ligne' }, SENT),
    },
    edges: {
      'SMV|GCB|carte locale': OBSERVED,
      'SMV|SSP|panneau': OBSERVED,
      'SMV|RAIL|rail': OBSERVED,
      'SSP|COL|notes v1': OBSERVED,
      'SSP|AV|U1 · lecture seule': PROPOSED,
      'COL|PNA|ancre à réparer': OBSERVED,
      'AV|ANN|lecture groupée': PROPOSED,
      'SSP|GS|vivier B': OBSERVED,
      'ANN|CMS|cibles et lecture': PROPOSED,
      'AV|DS|Badge, Card, Alert': PROPOSED,
      'GV|GEO|pilote #/geo': OBSERVED,
      'GCB|GEO|migration future': PROPOSED,
    },
  },
};

export const sceneIds = Object.keys(scenes);

// Même contrat que la chaîne d'architecture : aucun nœud ni arête en trop ou
// manquant des deux côtés, états fermés, gabarit unique A' (ou conteneur).
export function metadataFor(graph) {
  const scene = scenes[graph.id];
  if (!scene) throw Error(`missing scene metadata ${graph.id}`);
  const actualNodes = new Set([...graph.groups, ...graph.nodes].map(item => item.id));
  const expectedNodes = new Set(Object.keys(scene.nodes));
  for (const id of actualNodes) if (!expectedNodes.has(id)) throw Error(`${graph.id}: missing node metadata ${id}`);
  for (const id of expectedNodes) if (!actualNodes.has(id)) throw Error(`${graph.id}: extra node metadata ${id}`);
  const groupIds = new Set(graph.groups.map(group => group.id));
  const edges = {};
  for (const edge of graph.edges) {
    const key = `${edge.source}|${edge.target}|${edge.label}`, value = scene.edges[key];
    if (!value) throw Error(`${graph.id}: missing edge metadata ${key}`);
    edges[edge.id] = value;
  }
  if (Object.keys(edges).length !== Object.keys(scene.edges).length) throw Error(`${graph.id}: extra edge metadata`);
  for (const value of [...Object.values(scene.nodes), ...Object.values(edges)]) {
    if (!EVIDENCE.has(value.evidenceClass) || !RUNTIME.has(value.runtimeState)) throw Error(`${graph.id}: invalid closed state`);
  }
  for (const [id, value] of Object.entries(scene.nodes)) {
    const isGroup = groupIds.has(id);
    if (isGroup !== (value.card === 'box')) throw Error(`${graph.id}/${id}: container and template disagree`);
    if (value.card === 'box') {
      if (value.role) throw Error(`${graph.id}/${id}: a container carries no role title`);
      continue;
    }
    if (value.card !== 'A') throw Error(`${graph.id}/${id}: unknown card template ${value.card}`);
    if (!value.code || !value.role || !value.name || !value.detail) throw Error(`${graph.id}/${id}: card needs code, role, name and detail`);
    if (value.name.includes(value.code)) throw Error(`${graph.id}/${id}: code repeated inside the name`);
    if (!roleIsShort(value.role)) throw Error(`${graph.id}/${id}: role title "${value.role}" is not two-by-two short`);
  }
  return { nodes: scene.nodes, edges };
}

export function decorateGraph(graph) {
  const metadata = metadataFor(graph);
  for (const item of [...graph.groups, ...graph.nodes]) item.metadata = metadata.nodes[item.id];
  for (const edge of graph.edges) edge.metadata = metadata.edges[edge.id];
  return graph;
}
