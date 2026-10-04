// Contenu des cartes du dossier de décision « villes en écart S3 / PG ».
// Le gabarit, la géométrie et le routage viennent de la chaîne existante
// (`docs/architecture/focus`), qui importe elle-même le kit h2a monté en /kit.
// Ici : uniquement le contenu de la scène d'architecture et le contrôle de contrat.
// Une carte = un composant réel (écran, job, traitement, objet ou table) ;
// les tables en détail sont dans la Figure 2, dessinée à part (TableDiagram.svelte).
// Classes : observed = constaté dans le code ou le diagnostic en lecture seule.
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';

const EVIDENCE = new Set(['observed', 'declared', 'historical', 'dormant', 'unknown', 'external']);
const RUNTIME = new Set(['active', 'suspended', 'dormant', 'manual', 'retained', 'unknown', 'not-applicable']);

const IMMO = ['radar-immobilier'];
const A = (repo, kind, evidenceClass, runtimeState, icon, spec) => ({
  card: 'A', kind, repo: [...repo].sort(), evidenceClass, runtimeState, icon,
  code: spec.code ?? '', role: spec.role ?? '', name: spec.name ?? '', detail: spec.detail ?? '',
});
const BOX = (repo, evidenceClass, runtimeState, spec) => ({
  card: 'box', kind: 'cluster', repo: [...repo].sort(), evidenceClass, runtimeState, icon: 'cluster',
  code: spec.code ?? '', role: '', name: spec.name ?? '', detail: '',
});
const e = (evidenceClass, runtimeState) => ({ evidenceClass, runtimeState });
// Constaté sur origin/main f6550765 et dans le diagnostic du 2026-10-04.
const O = (kind, icon, spec) => A(IMMO, kind, 'observed', 'active', icon, spec);
const OBSERVED = e('observed', 'active');

const scenes = {
  // Scène 1 — §2.2 : cinq couloirs verticaux, de gauche à droite (3a et 3b dans le backend).
  'architecture-ecart': {
    nodes: {
      L1: BOX(IMMO, 'observed', 'active', { code: 'L1', name: '1 · Utilisateurs' }),
      USR: O('user', 'user', { code: 'U-1', role: 'Utilisateurs · radar', name: 'Steve, Farid, équipe', detail: 'voient ce que PG sert' }),
      L2: BOX(IMMO, 'observed', 'active', { code: 'L2', name: '2 · Écrans UI' }),
      SIG: O('ui', 'web', { code: 'E-1', role: 'Écran · Signaux', name: 'SignauxMapView', detail: 'carte, rail et panneau' }),
      PDF: O('ui', 'document', { code: 'E-2', role: 'Écran · preuve', name: 'SignalPdfOverlay', detail: 'page du PV citée' }),
      COV: O('ui', 'check', { code: 'E-3', role: 'Écran · couverture', name: 'Couverture des sources', detail: 'compte les nœuds par ville' }),
      BE: BOX(IMMO, 'observed', 'active', { code: 'BE', name: '3 · Backend' }),
      L3: BOX(IMMO, 'observed', 'active', { code: 'L3', name: '3a · Déclencheurs' }),
      RFR: O('job', 'cronjob', { code: 'J-1', role: 'CronJob · planifié', name: 'radar-refresh', detail: '05:17 11:17 17:17 23:17 UTC' }),
      PRJ: O('job', 'release', { code: 'J-2', role: 'Job CD · run-job', name: 'projection', detail: 'entrée project_cities' }),
      REC: O('job', 'release', { code: 'J-3', role: 'Job CD · run-job', name: 'document-date-recovery', detail: 'recovery_cities · heal' }),
      EXP: A(IMMO, 'flow', 'observed', 'unknown', 'unknown', { code: 'J-4', role: 'Flux · ancien', name: 'runExploitation', detail: 'G1 · 2026-09-10 et 11' }),
      L4: BOX(IMMO, 'observed', 'active', { code: 'L4', name: '3b · Traitements' }),
      API: O('service', 'api', { code: 'T-1', role: 'Service · API', name: 'radar-api', detail: 'lit seulement PG' }),
      COL: O('step', 'url', { code: 'T-2', role: 'Étape · collecte', name: 'Collecte des PV', detail: 'gratuite, sans modèle' }),
      EXT: O('step', 'llm', { code: 'T-3', role: 'Étape · extraction', name: 'Graphify par modèle', detail: 'appel payant par PV' }),
      UGA: O('step', 'join', { code: 'T-4', role: 'Étape · projection', name: 'upsertGraphAtomic', detail: '3 garde-fous · collision' }),
      UPG: A(IMMO, 'step', 'observed', 'unknown', 'unknown', { code: 'T-5', role: 'Étape · ancienne', name: 'upsertGraph', detail: 'sans garde-fou ni S3' }),
      L5: BOX(IMMO, 'observed', 'active', { code: 'L5', name: '4 · Données' }),
      S3PV: O('object', 's3', { code: 'D-1', role: 'S3 · documents', name: 'PV collectés', detail: 'empreinte docSha' }),
      S3G: O('object', 's3', { code: 'D-2', role: 'S3 · graphe', name: 'graph/ville/latest.json', detail: 'un fichier par ville, propre' }),
      PGN: O('table', 'postgres', { code: 'D-3', role: 'PG · table', name: 'graph_nodes', detail: 'clé id seule · 164 mêlés' }),
      PGE: O('table', 'postgres', { code: 'D-4', role: 'PG · table', name: 'graph_edges', detail: 'src_id, dst_id sans ville' }),
    },
    edges: {
      'USR|SIG|consulte': OBSERVED,
      'USR|PDF|ouvre une preuve': OBSERVED,
      'USR|COV|suit la couverture': OBSERVED,
      'SIG|API|signaux de la ville': OBSERVED,
      'PDF|API|preuve du nœud': OBSERVED,
      'COV|API|nœuds par ville': OBSERVED,
      'RFR|COL|1 · collecte': OBSERVED,
      'RFR|EXT|2 · extrait': OBSERVED,
      'RFR|UGA|3 · projette': OBSERVED,
      'PRJ|UGA|S3 vers PG': OBSERVED,
      'REC|UGA|dates puis projection': OBSERVED,
      'EXP|UPG|PG seul, sans S3': e('observed', 'unknown'),
      'PRJ|S3G|lit latest.json': OBSERVED,
      'REC|S3G|réécrit les dates': OBSERVED,
      'API|PGN|lit seulement PG': OBSERVED,
      'COL|S3PV|dépose le PV': OBSERVED,
      'EXT|S3G|publie le graphe': OBSERVED,
      'UGA|PGN|ON CONFLICT id · collision': OBSERVED,
      'UGA|PGE|arêtes sans ville': OBSERVED,
      'UPG|PGN|G1 · nœuds vides': e('observed', 'unknown'),
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
