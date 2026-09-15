// Contenu des cartes du dossier de décision Kanban / itération.
// Le gabarit, la géométrie et le routage viennent de la chaîne existante
// (`docs/architecture/focus`), qui importe elle-même le kit h2a monté en /kit.
// Ici : uniquement le contenu des deux scènes et le contrôle de contrat.
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';

const EVIDENCE = new Set(['observed', 'declared', 'historical', 'dormant', 'unknown', 'external']);
const RUNTIME = new Set(['active', 'suspended', 'dormant', 'manual', 'retained', 'unknown', 'not-applicable']);

const IMMO = ['radar-immobilier'], GEO = ['geo'], PLATFORM = ['poc-k8s'];
const A = (repo, kind, evidenceClass, runtimeState, icon, spec) => ({
  card: 'A', kind, repo: [...repo].sort(), evidenceClass, runtimeState, icon,
  code: spec.code ?? '', role: spec.role ?? '', name: spec.name ?? '', detail: spec.detail ?? '',
});
const BOX = (repo, evidenceClass, runtimeState, spec) => ({
  card: 'box', kind: 'cluster', repo: [...repo].sort(), evidenceClass, runtimeState, icon: 'cluster',
  code: spec.code ?? '', role: '', name: spec.name ?? '', detail: '',
});
const e = (evidenceClass, runtimeState) => ({ evidenceClass, runtimeState });

// Scène 1 — une colonne = un conteneur ; ses cartes disent le critère d'entrée,
// le critère de sortie, la main qui déplace, l'artefact et, quand elle existe,
// l'automatisation. Tout vient de §2.2 et §2.3 du dossier : donc « declared ».
const column = (index, short, exact, wip) => ({
  [`C${index}`]: BOX(IMMO, 'declared', 'unknown', { code: `COL${index}`, name: short }),
  [`C${index}_COL`]: A(IMMO, 'column', 'declared', 'unknown', 'check',
    { code: `COL-${index}`, role: 'Colonne · owner', name: exact, detail: wip }),
});

const scenes = {
  'way-of-working': {
    nodes: {
      ...column(1, '1 · Backlog', 'Backlog', 'hors borne de WIP'),
      C1_IN: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'IN-1', role: 'Critère · entrée', name: 'Chantier présent dans track', detail: 'TO-DO, AWAITED ou demande' }),
      C1_OUT: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'OUT-1', role: 'Critère · sortie', name: 'Chantier cadré', detail: 'titre, valeur, effort' }),
      C1_WHO: A(IMMO, 'hand', 'declared', 'manual', 'user',
        { code: 'WHO-1', role: 'Qui · déplace', name: 'Conducteur', detail: 'auto-ajout label kanban' }),
      C1_ART: A(IMMO, 'artifact', 'declared', 'unknown', 'document',
        { code: 'ART-1', role: 'Artefact · attendu', name: 'Issue + labels de domaine', detail: 'corps : ULID track' }),

      ...column(2, '2 · À prioriser', 'Proposé à priorisation', 'hors borne de WIP'),
      C2_IN: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'IN-2', role: 'Critère · entrée', name: 'Cadré, effort, prérequis', detail: 'avant tout GO owner' }),
      C2_OUT: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'OUT-2', role: 'Critère · sortie', name: 'GO owner ou refus', detail: 'coche « GO itération »' }),
      C2_WHO: A(IMMO, 'hand', 'declared', 'manual', 'user',
        { code: 'WHO-2', role: 'Qui · déplace', name: 'Conducteur puis owner', detail: 'aucune automatisation' }),
      C2_ART: A(IMMO, 'artifact', 'declared', 'unknown', 'document',
        { code: 'ART-2', role: 'Artefact · attendu', name: 'Valeur, effort, risque', detail: "commentaire d'issue" }),

      ...column(3, '3 · Priorisé', "Priorisé pour l'itération", 'WIP = taille validée'),
      C3_IN: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'IN-3', role: 'Critère · entrée', name: 'GO owner et label P1 à P3', detail: "label posé par l'owner" }),
      C3_OUT: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'OUT-3', role: 'Critère · sortie', name: 'Lane et branche ouvertes', detail: 'harness branch init' }),
      C3_WHO: A(IMMO, 'hand', 'declared', 'manual', 'user',
        { code: 'WHO-3', role: 'Qui · déplace', name: 'Owner puis conducteur', detail: 'aucune · kanban-move' }),
      C3_ART: A(IMMO, 'artifact', 'declared', 'unknown', 'document',
        { code: 'ART-3', role: 'Artefact · attendu', name: 'Label iteration-2026-09-15', detail: 'item realize in-progress' }),

      ...column(4, '4 · Design', 'En cours de design', 'WIP maximal 3'),
      C4_IN: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'IN-4', role: 'Critère · entrée', name: 'Spec ou dossier requis', detail: 'specStatus to-specify' }),
      C4_OUT: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'OUT-4', role: 'Critère · sortie', name: 'Spec specified', detail: 'dossier tranché si requis' }),
      C4_WHO: A(IMMO, 'hand', 'declared', 'manual', 'user',
        { code: 'WHO-4', role: 'Qui · déplace', name: 'Lane puis conducteur', detail: 'aucune · kanban-move' }),
      C4_ART: A(IMMO, 'artifact', 'declared', 'unknown', 'document',
        { code: 'ART-4', role: 'Artefact · attendu', name: 'SPEC ou DOSSIER_DECISION', detail: 'decision new puis select' }),

      ...column(5, '5 · Dev', 'En cours de dev', 'WIP maximal 4'),
      C5_IN: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'IN-5', role: 'Critère · entrée', name: 'Spec specified ou non requise', detail: 'branche de lane ouverte' }),
      C5_OUT: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'OUT-5', role: 'Critère · sortie', name: 'PR ouverte vers main', detail: 'CI verte · Refs #n' }),
      C5_WHO: A(IMMO, 'hand', 'declared', 'manual', 'user',
        { code: 'WHO-5', role: 'Qui · déplace', name: 'Lane', detail: 'aucune · kanban-move' }),
      C5_ART: A(IMMO, 'artifact', 'declared', 'unknown', 'document',
        { code: 'ART-5', role: 'Artefact · attendu', name: 'Branche, BRANCH.md, tests', detail: 'harness test et verify' }),

      ...column(6, '6 · Revue interne', 'En cours de revue interne', 'WIP maximal 4'),
      C6_IN: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'IN-6', role: 'Critère · entrée', name: 'PR ouverte et liée', detail: 'Refs #n · jamais Closes' }),
      C6_OUT: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'OUT-6', role: 'Critère · sortie', name: 'PR fusionnée', detail: 'merge commit sur main' }),
      C6_WHO: A(IMMO, 'hand', 'declared', 'unknown', 'network',
        { code: 'WHO-6', role: 'Qui · déplace', name: 'Action GitHub à écrire', detail: 'lot T12 · repli conducteur' }),
      C6_ART: A(IMMO, 'artifact', 'declared', 'unknown', 'document',
        { code: 'ART-6', role: 'Artefact · attendu', name: 'Revue de 2 pairs au moins', detail: 'accept run result pass' }),

      ...column(7, '7 · Préprod UAT', 'Déployé sur preprod (UAT)', 'WIP maximal 3'),
      C7_IN: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'IN-7', role: 'Critère · entrée', name: 'Fusion et préprod au vert', detail: 'SHA servi vérifié' }),
      C7_OUT: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'OUT-7', role: 'Critère · sortie', name: 'UAT OK écrit par l’owner', detail: 'UAT KO renvoie au dev' }),
      C7_WHO: A(IMMO, 'hand', 'declared', 'unknown', 'network',
        { code: 'WHO-7', role: 'Qui · déplace', name: 'Action puis owner', detail: 'lot T12 · repli conducteur' }),
      C7_ART: A(IMMO, 'artifact', 'declared', 'unknown', 'url',
        { code: 'ART-7', role: 'Artefact · attendu', name: 'URL préprod et SHA servi', detail: 'accept run env preprod' }),

      ...column(8, '8 · À déployer prod', 'À déployer sur prod', 'WIP maximal 2'),
      C8_IN: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'IN-8', role: 'Critère · entrée', name: 'UAT OK et backup attesté', detail: 'rollback attesté aussi' }),
      C8_OUT: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'OUT-8', role: 'Critère · sortie', name: 'Tag promu, SHA vérifié', detail: 'puis issue fermée' }),
      C8_WHO: A(IMMO, 'hand', 'declared', 'manual', 'user',
        { code: 'WHO-8', role: 'Qui · déplace', name: 'Conducteur puis owner', detail: 'aucune · GO environment' }),
      C8_ART: A(IMMO, 'artifact', 'declared', 'unknown', 'release',
        { code: 'ART-8', role: 'Artefact · attendu', name: 'GO prod et reçu promote', detail: 'item realize done' }),

      ...column(9, '9 · En prod (clos)', 'En prod (clos)', 'valeur terminale requise'),
      C9_IN: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'IN-9', role: 'Critère · entrée', name: 'Issue fermée', detail: 'à la promotion prod' }),
      C9_OUT: A(IMMO, 'gate', 'declared', 'unknown', 'check',
        { code: 'OUT-9', role: 'Critère · sortie', name: 'Auto-archivage', detail: 'carte retirée du board' }),
      C9_WHO: A(IMMO, 'hand', 'declared', 'unknown', 'network',
        { code: 'WHO-9', role: 'Qui · déplace', name: 'Automatisation intégrée', detail: 'fermée vers En prod' }),
      C9_ART: A(IMMO, 'artifact', 'declared', 'unknown', 'document',
        { code: 'ART-9', role: 'Artefact · attendu', name: 'Aucun nouvel artefact', detail: 'la valeur clôt le flux' }),
    },
    edges: {
      'C1_OUT|C2_IN|cadré': e('declared', 'manual'),
      'C2_OUT|C3_IN|GO owner · label P1': e('declared', 'manual'),
      'C3_OUT|C4_IN|branche ouverte': e('declared', 'manual'),
      'C4_OUT|C5_IN|spec specified': e('declared', 'manual'),
      'C5_OUT|C6_IN|PR ouverte · Refs #n': e('declared', 'unknown'),
      'C6_OUT|C7_IN|PR mergée · préprod': e('declared', 'unknown'),
      'C7_OUT|C8_IN|UAT OK · owner': e('declared', 'manual'),
      'C8_OUT|C9_IN|GO owner · tag v': e('declared', 'manual'),
    },
  },

  // Scène 2 — les neuf items recommandés (§4.2) dans leur colonne de départ, et
  // les dépendances de §4.3. « dormant » : ce qui est gaté par un GO owner.
  'iteration-15-jours': {
    nodes: {
      J0BOX: BOX(IMMO, 'declared', 'manual', { code: 'J0', name: 'Jour 0 · déblocages' }),
      J0_ROLE: A(IMMO, 'unblock', 'dormant', 'dormant', 'check',
        { code: 'J0-A', role: 'Déblocage · préprod', name: 'Apply du Role de la PR 690', detail: 'GO owner · CD au vert' }),
      J0_PR: A(IMMO, 'unblock', 'declared', 'manual', 'release',
        { code: 'J0-B', role: 'Déblocage · PR', name: 'PR 688 puis 682 à jour', detail: 'sortie de brouillon · J0 à J2' }),

      BDESIGN: BOX(IMMO, 'declared', 'unknown', { code: 'DESIGN', name: '4 · Design · S1' }),
      O2: A(IMMO, 'workstream', 'declared', 'unknown', 's3',
        { code: 'O2', role: 'Backup · PRA', name: 'Backup planifié et restore', detail: 'ordre 1 · S1 · 3 h owner' }),
      O7: A(IMMO, 'workstream', 'declared', 'unknown', 'web',
        { code: 'O7', role: 'Annotation · signaux', name: 'Annotations signaux, villes', detail: 'ordre 3 · S1 à S2 · 3 h' }),
      O3: A(GEO, 'workstream', 'declared', 'unknown', 'graph',
        { code: 'O3', role: 'DAG · geo', name: 'Design s3-dag et lot 1', detail: 'ordre 4 · S1 · 2 h owner' }),
      O5: A(IMMO, 'workstream', 'declared', 'unknown', 'document',
        { code: 'O5', role: 'Règlements · grilles', name: 'Industrialiser le scraping', detail: 'ordre 5 · S1 · 2 h owner' }),
      O6: A(IMMO, 'workstream', 'declared', 'unknown', 'join',
        { code: 'O6', role: 'Mapping · zones', name: 'Signal, zones et règlements', detail: 'ordre 6 · S1 à S2 · 2 h' }),
      O4: A(IMMO, 'workstream', 'declared', 'unknown', 'map',
        { code: 'O4', role: 'Plan · migration', name: 'Scraping PV côté geo', detail: 'ordre 7 · S2 · après O3' }),
      O8: A(GEO, 'workstream', 'declared', 'unknown', 'map',
        { code: 'O8', role: 'Plan · 3D', name: 'Vue zone photoréaliste', detail: 'ordre 8 · S2 · après O6' }),

      BDESIGN2: BOX(IMMO, 'declared', 'unknown', { code: 'DESIGN2', name: '4 · Design · S2' }),
      BDEV: BOX(IMMO, 'declared', 'unknown', { code: 'DEV', name: '5 · Dev' }),
      O1A: A(IMMO, 'workstream', 'observed', 'active', 'cronjob',
        { code: 'O1a', role: 'Refresh · fusion', name: 'PR 688, 682, 678 et 636', detail: 'ordre 2a · J0 à J5 · 1 h' }),
      T12: A(IMMO, 'workstream', 'declared', 'unknown', 'check',
        { code: 'T12', role: 'Track · kanban', name: 'Réconciliation et kanban-move', detail: 'ordre 9 · S1 · effort N-A' }),

      BPROD: BOX(IMMO, 'dormant', 'dormant', { code: 'PROD', name: '8 · À déployer prod' }),
      O1B: A(IMMO, 'workstream', 'dormant', 'dormant', 'cronjob',
        { code: 'O1b', role: 'Refresh · prod', name: 'CronJob radar-refresh-pv', detail: 'ordre 2b · S2 · effort N-A' }),
    },
    edges: {
      'J0_ROLE|O7|CD préprod vert': e('dormant', 'dormant'),
      'J0_PR|O2|jour 0 tenu': e('declared', 'manual'),
      'J0_PR|O1A|PR 688 et 682 à jour': e('declared', 'manual'),
      'O2|O1B|backup en place': e('dormant', 'dormant'),
      'O1A|O1B|cycle préprod prouvé': e('dormant', 'dormant'),
      'O3|O4|design DAG figé': e('declared', 'unknown'),
      'O6|O8|mesure Jalon 1': e('declared', 'unknown'),
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
