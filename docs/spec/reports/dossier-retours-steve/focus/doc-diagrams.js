// Entity-relationship diagrams placed in the dossier text by `<!-- diagram:<id> -->`
// markers, rendered with the same engine as scene 2 (MiniEr). The Mermaid source is the
// block just above the marker in the Markdown (mapping.test.mjs checks they are equal).
import { STEVE_MODEL } from './steve-model.js';
import { PHYSICAL } from './physical-model.js';

export const DIAGRAM_MARKER = /<!-- diagram:([\w-]+) -->/;

export const DOC_DIAGRAMS = {
  // §6.0 — physical model: current state and proposed state (statuses).
  ...PHYSICAL,
  // §6.3 — the minimal model proposed from Steve’s needs (same as scene 2 and D2 option a).
  'modele-minimal': { title: 'Modèle minimal proposé : six tables nouvelles, une par besoin de Steve', ...STEVE_MODEL },
  // §6.0 — what exists on main today (schema.ts, migrations 0005 and 0011).
  existant: {
    title: 'Existant sur main : deux tables d’annotation, aucune table d’oracle',
    layers: ['Annotations existantes', 'Tables référencées', 'Graphe (identifiants texte)'],
    placement: {
      prospect_marks: { col: 0, row: 0 }, prospect_notes: { col: 0, row: 1 },
      lot_versions: { col: 1, row: 0 }, account_users: { col: 1, row: 1 }, signals: { col: 1, row: 2 },
      graph_nodes: { col: 2, row: 2 },
    },
    existing: ['prospect_marks', 'prospect_notes', 'lot_versions', 'account_users', 'signals', 'graph_nodes'],
    labels: { lot_version_id: 'lot', signal_id: 'signal_id, UUID', id_texte_refuse: 'id texte envoyé par l’UI, refusé (B0)' },
    colGap: 180,
    er: `erDiagram
    prospect_marks }o--|| lot_versions : lot_version_id
    prospect_marks }o--|| account_users : auteur
    prospect_notes }o--|| account_users : auteur
    prospect_notes }o--o| signals : signal_id
    prospect_notes }o..o| graph_nodes : id_texte_refuse
    prospect_marks {
      uuid id PK
      uuid lot_version_id FK "lot (bitemporel)"
      text no_lot
      text city_slug
      enum dimension "pipeline ou marche"
      enum statut "favori, ecarte, en_vente…"
      enum mode "real ou simulation"
      uuid author_id FK "compte obligatoire"
      uuid supersedes FK "chaîne append-only"
      uuid superseded_by FK
      numeric prix_demande
      text lien_annonce
    }
    prospect_notes {
      uuid id PK
      enum target_type "lot ou signal"
      text no_lot
      text city_slug
      uuid signal_id FK "UUID, ON DELETE SET NULL"
      uuid author_id FK "compte obligatoire"
      text body "10 000 caractères max"
      text tenant_id "inerte"
      timestamptz deleted_at "suppression logique"
    }
    lot_versions {
      uuid id PK
    }
    account_users {
      uuid id PK
    }
    signals {
      uuid id PK "aucune insertion sur main"
    }
    graph_nodes {
      text id PK "signal-… (texte)"
    }`,
  },
  // §9.3 — old oracle (extraction, E) and new oracle (targeting, C), two separate
  // sections of benchmark #782. Boxes are artefacts, columns their main properties.
  oracles: {
    title: 'Ancien oracle (E, extraction) et nouvel oracle (C, ciblage) : deux volets du benchmark #782',
    layers: ['Sources', 'Oracles, versions gelées', 'Benchmark #782'],
    placement: {
      consensus_modeles: { col: 0, row: 0 }, annotations: { col: 0, row: 1 },
      oracle_e_v3: { col: 1, row: 0 }, oracle_c_v1: { col: 1, row: 1 },
      volet_extraction: { col: 2, row: 0 }, volet_ciblage: { col: 2, row: 1 },
    },
    existing: ['consensus_modeles', 'oracle_e_v3', 'volet_extraction'],
    labels: { construit: 'construit', adjugees_gelees: 'adjugées, gelées', note: 'note', note_b_puis_c: 'note B puis C' },
    colGap: 190,
    er: `erDiagram
    consensus_modeles ||--|| oracle_e_v3 : construit
    annotations ||--|| oracle_c_v1 : adjugees_gelees
    oracle_e_v3 ||--|| volet_extraction : note
    oracle_c_v1 ||--|| volet_ciblage : note_b_puis_c
    consensus_modeles {
      text methode "7 passes, 3 familles de modèles"
      text arbitrage "vote unanime + arbitrage"
    }
    annotations {
      text source "verdicts de Steve (124 lignes)"
      text adjudication "par critère, auteur nommé"
    }
    oracle_e_v3 {
      text question "a-t-on extrait l'acte ?"
      text unite "acte d'un PV : étape + citation"
      int taille "674 sur 100 documents"
      text stockage "fichiers JSON du dépôt"
    }
    oracle_c_v1 {
      text question "fallait-il montrer ce signal ?"
      text unite "signal, regroupé par dossier"
      text jeux "dev 51 villes, test 52 villes"
      text stockage "oracle_versions + JSON gelé"
    }
    volet_extraction {
      text mesure "extraction historique, inchangée"
    }
    volet_ciblage {
      text mesure "précision, rappel : B puis C"
    }`,
  },
};
