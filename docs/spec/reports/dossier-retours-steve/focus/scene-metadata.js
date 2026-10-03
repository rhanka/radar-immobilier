// Contenu des cartes du dossier de décision « retours de Steve ».
// Le gabarit, la géométrie et le routage viennent de la chaîne existante
// (`docs/architecture/focus`), qui importe elle-même le kit h2a monté en /kit.
// Ici : uniquement le contenu des quatre scènes et le contrôle de contrat.
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
  // Scène 1 — §2 : les trois critères de Steve en regard de l'existant (main 27891b10).
  'criteres-steve': {
    nodes: {
      K1: BOX(IMMO, 'observed', 'retained', { code: 'K1', name: 'Critère 1 · Résidentiel' }),
      S1C: A(IMMO, 'criterion', 'observed', 'retained', 'user', { code: 'C-1', role: 'Steve · critère', name: 'Habitation seulement', detail: 'N-NON-RES 6 · N-FAUX-POSITIF 4' }),
      R1C: O('filter', 'graph', { code: 'F-RES', role: 'Radar · partiel', name: 'Filtre Résidentiel regex', detail: 'indéterminé + instrument' }),
      K2: BOX(IMMO, 'observed', 'retained', { code: 'K2', name: 'Critère 2 · Assouplissement' }),
      S2C: A(IMMO, 'criterion', 'observed', 'retained', 'user', { code: 'C-2', role: 'Steve · critère', name: 'Ouvre, ne resserre pas', detail: 'restriction 10 · indét. 38' }),
      R2C: A(IMMO, 'gap', 'observed', 'not-applicable', 'unknown', { code: 'F-SENS', role: 'Radar · absent', name: 'Aucun champ de sens', detail: 'ni filtre ni classification' }),
      K3: BOX(IMMO, 'observed', 'retained', { code: 'K3', name: 'Critère 3 · Densification' }),
      S3C: A(IMMO, 'criterion', 'observed', 'retained', 'user', { code: 'C-3', role: 'Steve · critère', name: 'Plus d’unités qu’avant', detail: 'P-DENSITE + P-USAGE-MULTI 16' }),
      R3C: A(IMMO, 'gap', 'observed', 'not-applicable', 'unknown', { code: 'F-EFF', role: 'Radar · absent', name: 'Effet toujours inconnu', detail: 'B′ ne prouve pas la densité' }),
      KX: BOX(IMMO, 'observed', 'retained', { code: 'KX', name: 'Exclusions transversales' }),
      SXC: A(IMMO, 'criterion', 'observed', 'retained', 'user', { code: 'C-X', role: 'Steve · règles', name: 'Règle générale, décision', detail: 'V2-PRECEDENT 21 · ODJ 4' }),
      RXC: O('filter', 'check', { code: 'F-EXC', role: 'Radar · partiel', name: 'PIIA et dérogation exclus', detail: 'PPCMOI et ODJ non exclus' }),
      EF: BOX(IMMO, 'observed', 'retained', { code: 'EF', name: 'Effet sur la vue de travail' }),
      NOI: A(IMMO, 'measure', 'observed', 'retained', 'check', { code: 'M-BR', role: 'Mesure · passe 1', name: 'Bruit 24 / 73 · 32,9 %', detail: '3 + 4 + 6 + 11 par critère' }),
      REC: A(IMMO, 'measure', 'observed', 'retained', 'check', { code: 'M-RA', role: 'Mesure · passe 1', name: 'Pertinents vus 34 / 40', detail: '6 hors vue · 7 manqués' }),
    },
    edges: {
      'S1C|R1C|partiel': OBSERVED,
      'S2C|R2C|absent': OBSERVED,
      'S3C|R3C|absent': OBSERVED,
      'SXC|RXC|partiel': OBSERVED,
      'R1C|NOI|3 hors critère': OBSERVED,
      'R2C|NOI|4 resserrements': OBSERVED,
      'R3C|NOI|6 sans effet': OBSERVED,
      'RXC|NOI|11 hors portée': OBSERVED,
      'NOI|REC|même vue · passe 1': OBSERVED,
    },
  },

  // Scène 2 — §6.3 : couches source → lignes → jugements → ancres → publication.
  'modele-donnees': {
    nodes: {
      S1: BOX(IMMO, 'declared', 'dormant', { code: 'S1', name: '1 · Sources immuables' }),
      SRC: P('table', 'document', { code: 'T-01', role: 'Table · source', name: 'annotation_sources', detail: 'sha256 · auteur · importateur' }),
      ROW: P('table', 'document', { code: 'T-02', role: 'Table · brute', name: 'annotation_raw_rows', detail: 'toutes les cellules · jsonb' }),
      S2: BOX(IMMO, 'declared', 'dormant', { code: 'S2', name: '2 · Référentiels de Steve' }),
      COD: P('table', 'check', { code: 'T-03', role: 'Table · codes', name: 'annotation_codes', detail: '28 codes · 24 employés' }),
      RUL: P('table', 'check', { code: 'T-04', role: 'Table · règles', name: 'annotation_rules', detail: 'R-01 à R-26 · datées' }),
      FND: P('table', 'check', { code: 'T-05', role: 'Table · constats', name: 'annotation_findings', detail: '77 constats · ids conservés' }),
      S3: BOX(IMMO, 'declared', 'dormant', { code: 'S3', name: '3 · Jugements versionnés' }),
      ASS: P('table', 'identity', { code: 'T-06', role: 'Table · jugement', name: 'annotation_assessments', detail: 'label_set · supersedes' }),
      ORC: P('table', 'release', { code: 'T-07', role: 'Table · oracle', name: 'oracle_releases', detail: 'version gelée · sha256' }),
      S4: BOX(IMMO, 'declared', 'dormant', { code: 'S4', name: '4 · Ancres durables' }),
      ANC: P('table', 'map', { code: 'T-08', role: 'Table · ancres', name: 'annotation_anchors', detail: '1 à N · clé texte sans FK' }),
      QUE: P('queue', 'user', { code: 'T-09', role: 'File · revue', name: 'File de résolution', detail: 'ambiguë · abrégée · disparue' }),
      S5: BOX(IMMO, 'declared', 'dormant', { code: 'S5', name: '5 · Publication conforme' }),
      CMT: P('projection', 'api', { code: 'P-01', role: 'Fil · conforme', name: 'Comment · kind record', detail: 'recordType radar.*' }),
      PN: O('table', 'postgres', { code: 'P-02', role: 'Notes · v1', name: 'prospect_notes', detail: 'réponses · suppression logique' }),
    },
    edges: {
      'SRC|ROW|1 fichier · N lignes': PROPOSED,
      'ROW|ASS|normalisée en': PROPOSED,
      'RUL|COD|justifie': PROPOSED,
      'COD|ASS|motif': PROPOSED,
      'ASS|ANC|1 à N ancres': PROPOSED,
      'FND|ANC|constat rattaché': PROPOSED,
      'ANC|QUE|ambiguë ou disparue': PROPOSED,
      'ASS|CMT|lecture conforme': PROPOSED,
      'CMT|PN|réponses v1': PROPOSED,
      'ASS|ORC|sélection gelée': PROPOSED,
    },
  },

  // Scène 3 — §6.5, §7 et §9.3 : de l'entrée à la mesure.
  'flux-import-oracle': {
    nodes: {
      F1: BOX(IMMO, 'observed', 'retained', { code: 'F1', name: '1 · Entrée' }),
      XLS: A(IMMO, 'source', 'observed', 'retained', 'document', { code: 'IN-1', role: 'Source · client', name: 'Classeur de Steve', detail: '7 feuilles · 433 lignes' }),
      DOC: A(IMMO, 'source', 'observed', 'retained', 'document', { code: 'IN-2', role: 'Source · client', name: 'Analyse du 21 sept.', detail: 'trois critères cumulatifs' }),
      F2: BOX(IMMO, 'declared', 'dormant', { code: 'F2', name: '2 · Import idempotent' }),
      DRY: P('job', 'cronjob', { code: 'IM-1', role: 'Script · Node/TS', name: 'Dry-run par défaut', detail: 'écarts aux comptes déclarés' }),
      TXN: P('job', 'postgres', { code: 'IM-2', role: 'Écriture · base', name: 'Transaction par fichier', detail: 'upsert par assessment_key' }),
      F3: BOX(IMMO, 'declared', 'dormant', { code: 'F3', name: '3 · Rattachement' }),
      RES: P('job', 'map', { code: 'RA-1', role: 'Ancre · snapshot', name: 'Résolution sur snapshot', detail: 'id exact, puis ville, étape' }),
      MAN: P('queue', 'user', { code: 'RA-2', role: 'Revue · humaine', name: 'File manuelle', detail: 'aucune ligne rejetée' }),
      F4: BOX(IMMO, 'declared', 'dormant', { code: 'F4', name: '4 · Annotation visible' }),
      PAN: P('ui', 'web', { code: 'UI-1', role: 'Panneau · signal', name: 'Avis de Steve', detail: 'classement · sens · motif' }),
      RAI: P('ui', 'web', { code: 'UI-2', role: 'Rail · villes', name: 'Compteurs P / S / N', detail: 'lecture groupée · lot L2' }),
      F5: BOX(IMMO, 'declared', 'dormant', { code: 'F5', name: '5 · Oracles' }),
      ADJ: P('review', 'identity', { code: 'OR-1', role: 'Revue · métier', name: 'Adjudication par critère', detail: 'K1 à K9 · auteur nommé' }),
      OC: P('oracle', 'release', { code: 'OR-2', role: 'Oracle · ciblage', name: 'Oracle C gelé', detail: 'dev 51 villes · test 52' }),
      OE: A(IMMO, 'oracle', 'historical', 'retained', 'release', { code: 'OR-3', role: 'Oracle · E', name: 'Oracle v3 674 / 676', detail: '676 locale à committer' }),
      F6: BOX(IMMO, 'declared', 'dormant', { code: 'F6', name: '6 · Mesure' }),
      SHA: P('view', 'graph', { code: 'ME-1', role: 'Vue · shadow', name: 'C calculée en parallèle', detail: 'B reste le défaut' }),
      BEN: P('benchmark', 'check', { code: 'ME-2', role: 'Benchmark · #782', name: 'Deux volets séparés', detail: 'extraction · ciblage' }),
    },
    edges: {
      'XLS|DRY|sha256 · 7 feuilles': PROPOSED,
      'DOC|ADJ|annotation distincte': PROPOSED,
      'DRY|TXN|0 écriture si connu': PROPOSED,
      'TXN|RES|lignes et évaluations': PROPOSED,
      'RES|MAN|ambiguë': PROPOSED,
      'RES|PAN|ancre confirmée': PROPOSED,
      'PAN|RAI|même cible': PROPOSED,
      'RES|ADJ|labels étayés': PROPOSED,
      'ADJ|OC|version gelée': PROPOSED,
      'OC|SHA|précision et rappel': PROPOSED,
      'OC|BEN|volet ciblage': PROPOSED,
      'OE|BEN|volet extraction': e('historical', 'retained'),
    },
  },

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

  // Scène 5 — §9.5 : trois profils calculés sur le même inventaire.
  'affichage-abc': {
    nodes: {
      I1: BOX(IMMO, 'declared', 'dormant', { code: 'I1', name: '1 · Inventaire' }),
      SNAP: P('data', 'postgres', { code: 'INV', role: 'Base · commune', name: 'Snapshot commun', detail: 'mêmes dates, mêmes filtres' }),
      P1: BOX(IMMO, 'observed', 'active', { code: 'P1', name: '2 · Profils' }),
      PA: A(IMMO, 'profile', 'historical', 'retained', 'graph', { code: 'PRF-A', role: 'Profil · gelé', name: 'Référence z / m / p', detail: 'comptes encore calculés' }),
      PB: O('profile', 'graph', { code: 'PRF-B', role: 'Profil · défaut', name: 'Vivier B′ actuel', detail: 'zonage, résidentiel, précoce' }),
      PC: P('profile', 'graph', { code: 'PRF-C', role: 'Profil · shadow', name: 'Ciblage Steve v1', detail: 'K1 à K9 · asymétrie' }),
      C1: BOX(IMMO, 'declared', 'dormant', { code: 'C1', name: '3 · États de C' }),
      CONF: P('state', 'check', { code: 'C-OK', role: 'État · confirmé', name: 'Opportunité confirmée', detail: 'critères requis étayés' }),
      INS: P('state', 'unknown', { code: 'C-AI', role: 'État · visible', name: 'À instruire', detail: 'indéterminé ou mixte' }),
      EXC: P('state', 'check', { code: 'C-EX', role: 'État · masqué', name: 'Exclu prouvé', detail: 'motif établi et expliqué' }),
      M1: BOX(IMMO, 'declared', 'dormant', { code: 'M1', name: '4 · Mesure et décision' }),
      DIFF: P('measure', 'graph', { code: 'M-1', role: 'Diff · nommé', name: 'Entrants et sortants', detail: 'raison par signal' }),
      ORA: P('measure', 'release', { code: 'M-2', role: 'Oracle · C', name: 'Précision et rappel', detail: 'jeu test · 52 villes' }),
      GATE: P('decision', 'check', { code: 'M-3', role: 'Décision · Farid', name: 'Seuil de bascule', detail: 'D13 · aucun P masqué' }),
    },
    edges: {
      'SNAP|PA|référence gelée': PROPOSED,
      'SNAP|PB|défaut actuel': PROPOSED,
      'SNAP|PC|shadow': PROPOSED,
      'PC|CONF|critères étayés': PROPOSED,
      'PC|INS|indéterminé ou mixte': PROPOSED,
      'PC|EXC|exclusion établie': PROPOSED,
      'PB|DIFF|entrants et sortants': PROPOSED,
      'CONF|DIFF|comparé à B': PROPOSED,
      'DIFF|ORA|noté sur': PROPOSED,
      'ORA|GATE|D13': PROPOSED,
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
