// Content and placement of the three scenes that are not component diagrams:
//   criteres-steve      matrix (Markdown table of Annexe B)
//   modele-donnees      entity-relationship diagram (Mermaid erDiagram of Annexe B)
//   flux-import-oracle  architecture in vertical swimlanes, oracle band at the bottom
//                       (Mermaid flowchart of Annexe B, one subgraph per lane)
// Evidence: observed = exists on origin/main 27891b10; declared = proposed by the
// dossier, not built; historical = frozen reference.

export const SCENE_KINDS = {
  'criteres-steve': 'matrix',
  'modele-donnees': 'er',
  'flux-import-oracle': 'lanes',
  'architecture-ui': 'flow',
  'affichage-abc': 'flow',
};

export const MATRIX = {
  columns: ['Critère', 'Steve demande', "Radar aujourd'hui", 'Couverture', 'Bruit passe 1'],
  coverage: ['couvert', 'partiel', 'absent'],
  totalRow: 'Vue de travail · passe 1',
  // Denominator of the noise column: the 73 signals of Steve's working view.
  workingView: 73,
};

export const ER_SPEC = {
  layers: ['1 · Sources immuables', '2 · Référentiels de Steve', '3 · Jugements versionnés', '4 · Ancres durables', '5 · Publication conforme'],
  placement: {
    annotation_sources: { col: 0, row: 0 },
    annotation_raw_rows: { col: 0, row: 1 },
    annotation_rules: { col: 1, row: 0 },
    annotation_codes: { col: 1, row: 1 },
    annotation_findings: { col: 1, row: 2 },
    annotation_assessments: { col: 2, row: 1 },
    oracle_releases: { col: 2, row: 2 },
    annotation_anchors: { col: 3, row: 1 },
    graph_nodes: { col: 3, row: 2 },
    comment_projection: { col: 4, row: 1 },
    prospect_notes: { col: 4, row: 2 },
  },
  // Relation names are Mermaid identifiers (ASCII); this is how the scene prints them.
  labels: { normalisee_en: 'normalisée en', rattachee_a: 'rattachée à', rattache_a: 'rattaché à', cle_texte_sans_fk: 'clé texte, sans FK',
    selection_gelee: 'sélection gelée', publie_en: 'publiée en', reponses_v1: 'réponses v1' },
  // Tables that already exist on main; every other table is a proposal (§6.3).
  existing: ['graph_nodes', 'prospect_notes'],
};

const node = (evidence, tag, detail) => ({ evidence, tag, detail });

export const LANE_SPEC = {
  lanes: [
    { id: 'L1', kind: 'user' },
    { id: 'L2', kind: 'ui' },
    { id: 'L3', kind: 'backend' },
    { id: 'L4', kind: 'data' },
  ],
  band: { id: 'OR', titleWidth: 1060, order: ['OE', 'BEN', 'SCO', 'OC', 'ADJ'] },
  rows: {
    EQP: 0, STV: 2, OPS: 3,
    MAP: 0, PAN: 1, RAI: 2, REV: 3,
    COL: 0, DET: 1, IMP: 2, RAT: 3, GSA: 4, ANA: 5,
    DOCS: 0, SNAP: 1, XLSB: 2, GRA: 3, ANN: 4, PNO: 5,
  },
  nodes: {
    EQP: node('observed', 'personne', 'lecture dans l’UI'),
    STV: node('observed', 'personne', 'classeur 7 feuilles · analyse'),
    OPS: node('observed', 'personne', 'acte distinct en prod'),
    MAP: node('observed', 'écran', 'SignauxMapView · MapLibre'),
    PAN: node('observed', 'écran', 'SignauxSelPanel · avis U1'),
    RAI: node('observed', 'écran', 'SignauxRail · P / S / N'),
    REV: node('declared', 'écran', 'ambiguës · abrégées · disparues'),
    COL: node('observed', 'job', 'refresh · sources municipales'),
    DET: node('observed', 'job', 'extraction · graphe canonique'),
    IMP: node('declared', 'job', 'Node/TS · 1 transaction/fichier'),
    RAT: node('declared', 'job', 'résolution sur snapshot'),
    GSA: node('observed', 'API Hono', 'vivier B · filtres'),
    ANA: node('declared', 'API Hono', 'lecture groupée · Comment'),
    DOCS: node('observed', 'S3', 'PV, règlements · bruts'),
    SNAP: node('observed', 'S3', 'graph/<ville>/latest.json'),
    XLSB: node('declared', 'S3', 'immuables · sha256'),
    GRA: node('observed', 'PG', 'graphe canonique · vivier'),
    ANN: node('declared', 'PG', 'sources, évaluations, ancres'),
    PNO: node('observed', 'PG', 'réponses · suppression logique'),
    ADJ: node('declared', 'oracle', 'labels C étayés · auteur'),
    OC: node('declared', 'oracle', 'oracle_releases · #783'),
    SCO: node('declared', 'oracle', 'précision, rappel · B puis C'),
    OE: node('historical', 'oracle', 'extraction d’actes · v3'),
    BEN: node('declared', 'oracle', 'volets ciblage et extraction'),
  },
  // Edges whose evidence differs from "declared" (proposed by the dossier).
  edges: {
    'EQP|MAP': 'observed', 'MAP|PAN': 'observed', 'MAP|GSA': 'observed', 'COL|DOCS': 'observed', 'DET|DOCS': 'observed',
    'DET|SNAP': 'observed', 'DET|GRA': 'observed', 'GSA|GRA': 'observed', 'OE|BEN': 'historical',
  },
};

export const LANE_TITLES = { user: 'Utilisateurs', ui: 'Écrans UI', backend: 'Fonctions backend', data: 'Données' };
