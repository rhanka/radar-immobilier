// Content and placement of the three scenes that are not component diagrams:
//   criteres-steve      matrix (Markdown table of Annexe B)
//   modele-donnees      entity-relationship diagram (Mermaid erDiagram of Annexe B)
//   flux-import-oracle  architecture in vertical swimlanes, oracle band at the bottom
//                       (Mermaid flowchart of Annexe B, one subgraph per lane)
// Evidence: observed = exists on origin/main 27891b10; declared = proposed by the
// dossier, not built; historical = frozen reference.

import { STEVE_MODEL } from './steve-model.js';

export const SCENE_KINDS = {
  'criteres-steve': 'matrix',
  'modele-donnees': 'er',
  'flux-import-oracle': 'lanes',
  'architecture-ui': 'flow',
  'affichage-abc': 'lanes',
};

export const MATRIX = {
  columns: ['Critère', 'Steve demande', "Radar aujourd'hui", 'Couverture', 'Bruit passe 1'],
  coverage: ['couvert', 'partiel', 'absent'],
  totalRow: 'Vue de travail · passe 1',
  // Denominator of the noise column: the 73 signals of Steve's working view.
  workingView: 73,
};

// Scene 2: the minimal model built from Steve’s needs (steve-model.js, §6.3).
export const ER_SPEC = { ...STEVE_MODEL };

const node = (evidence, tag, detail) => ({ evidence, tag, detail });

const FLUX = {
  lanes: [
    { id: 'L1', kind: 'user', title: 'Utilisateurs' },
    { id: 'L2', kind: 'ui', title: 'Écrans UI' },
    { id: 'L3', kind: 'backend', title: 'Fonctions backend' },
    { id: 'L4', kind: 'data', title: 'Données' },
  ],
  band: { id: 'OR', titleWidth: 1060, order: ['OE', 'BEN', 'SCO', 'OC', 'ADJ'],
    subtitle: 'système transversal : alimenté par les annotations stockées en base, il note les sélections B et C' },
  legend: 'couloirs de gauche à droite : qui agit, sur quel écran, quelle fonction backend, quelles données · bordure pleine : constaté sur main · tirets : proposé par le dossier · pointillés : référence gelée · les flèches suivent l’appel ou l’écriture · l’oracle, en bas, ne sert aucune vue : il évalue hors ligne.',
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
    ANN: node('declared', 'PG', 'fichiers, lignes, cibles'),
    PNO: node('observed', 'PG', 'réponses · suppression logique'),
    ADJ: node('declared', 'oracle', 'labels C étayés · auteur'),
    OC: node('declared', 'oracle', 'oracle_versions · #783'),
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

// Scène 5 : deux zones explicites. En haut, l'application (ce que les utilisateurs
// voient, et où chaque élément vit : écran, backend, base) ; en bas, l'évaluation hors
// ligne (job Node, aucune vue utilisateur) qui mesure B et C et prépare la bascule.
const ABC = {
  zone: { title: 'Application — ce que voient les utilisateurs', titleWidth: 640 },
  lanes: [
    { id: 'A1', kind: 'user', title: 'Utilisateurs' },
    { id: 'A2', kind: 'ui', title: 'Écrans' },
    { id: 'A3', kind: 'backend', title: 'Backend · API Hono' },
    { id: 'A4', kind: 'data', title: 'Base · PostgreSQL' },
  ],
  band: { id: 'EV', titleWidth: 1180, nodeWidth: 200, order: ['PA', 'DIFF', 'MES', 'GATE', 'DEC', 'ORA'],
    place: { PA: [0, 0], DIFF: [1, 0], MES: [2, 0], GATE: [3, 0], DEC: [4, 0], ORA: [4, 1] },
    subtitle: 'job Node hors de l’application : aucun utilisateur ne voit ces éléments ; ils mesurent B et C et préparent la bascule' },
  legend: 'zone du haut : ce que l’application montre et où chaque élément vit (écran, backend, base) · bande du bas : l’évaluation hors ligne, un job sans écran · bordure pleine : constaté sur main · tirets : proposé par le dossier · pointillés : référence gelée · seule la décision de Farid fait passer un utilisateur de B à C.',
  rows: {
    USR: 0, ADM: 2,
    MAPB: 0, MAPC: 1, UATC: 2,
    APIB: 0, APIC: 2,
    GRA: 0, ANN: 2, ORR: 3,
  },
  nodes: {
    USR: node('observed', 'personne', 'vue de travail quotidienne'),
    ADM: node('declared', 'personne', 'mode réservé UAT et admin'),
    MAPB: node('observed', 'écran', 'B par défaut, aucun sélecteur'),
    MAPC: node('declared', 'écran', 'après bascule : mêmes états'),
    UATC: node('declared', 'écran', 'confirmé, à instruire visibles'),
    APIB: node('observed', 'backend', 'vivier B′ · filtres actuels'),
    APIC: node('declared', 'backend', '3 états · exclu prouvé masqué'),
    GRA: node('observed', 'PG', 'snapshot commun à A, B, C'),
    ANN: node('declared', 'PG', 'verdicts de Steve rattachés'),
    ORR: node('declared', 'PG', 'version gelée · sha256'),
    PA: node('historical', 'job', 'référence z/m/p, gelée'),
    DIFF: node('declared', 'job', 'entrants, sortants, raison'),
    ORA: node('declared', 'job', 'labels C étayés, gelés'),
    MES: node('declared', 'job', 'précision, rappel, parité'),
    GATE: node('declared', 'job', 'aucun P masqué, P ∪ S > B'),
    DEC: node('declared', 'personne', 'D12, D13 · B reste défaut'),
  },
  edges: {
    'USR|MAPB': 'observed', 'MAPB|APIB': 'observed', 'APIB|GRA': 'observed', 'GRA|PA': 'historical', 'PA|DIFF': 'historical',
  },
};

export const LANE_SPECS = { 'flux-import-oracle': FLUX, 'affichage-abc': ABC };
