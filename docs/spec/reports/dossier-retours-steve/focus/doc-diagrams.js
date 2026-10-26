// Entity-relationship diagrams placed in the dossier text by `<!-- diagram:<id> -->`
// markers, rendered with the same engine as scene 2 (MiniEr). The Mermaid source is the
// block just above the marker in the Markdown (mapping.test.mjs checks they are equal).
import { STEVE_MODEL } from './steve-model.js';
import { PHYSICAL } from './physical-model.js';

export const DIAGRAM_MARKER = /<!-- diagram:([\w-]+) -->/;

export const DOC_DIAGRAMS = {
  // Annexe III.7 — store Postgres d'engram (codé, non déployé dans immo) ; relations logiques, aucune clé étrangère.
  'engram-store': {
    title: 'Store Postgres d’engram : 6 tables (codé à c96fc01e, non déployé dans immo)',
    layers: ['Métadonnées', 'Graphe', 'Dérivés'],
    placement: {
      graph_meta: { col: 0, row: 0 }, graph_group_counts: { col: 0, row: 1 },
      graph_nodes: { col: 1, row: 0 }, graph_edges: { col: 1, row: 1 },
      graph_positions: { col: 2, row: 0 }, graph_tombstones: { col: 2, row: 1 },
    },
    existing: [],
    labels: { city_slug: 'city_slug', source_id_target_id: 'source_id, target_id', node_id: 'node_id', snapshot_id: 'snapshot_id', edge_triple: 'triplet d’arête' },
    colGap: 190,
    er: `erDiagram
    graph_meta ||--o{ graph_nodes : city_slug
    graph_nodes ||--o{ graph_edges : source_id_target_id
    graph_nodes ||--o{ graph_positions : node_id
    graph_meta ||--o{ graph_group_counts : snapshot_id
    graph_nodes ||..o{ graph_tombstones : node_id
    graph_edges ||..o{ graph_tombstones : edge_triple
    graph_meta {
        text city_slug PK
        text topology_signature
        text pushed_at
        text tool_version
    }
    graph_nodes {
        text city_slug PK
        text id PK
        text label
        text type
        int community
        jsonb props
    }
    graph_edges {
        text city_slug PK
        text source_id PK
        text target_id PK
        text relation PK
        text confidence
        jsonb props
    }
    graph_group_counts {
        text city_slug PK
        text axis PK
        text key PK
        text snapshot_id
        int count
    }
    graph_positions {
        text city_slug PK
        text layout_id PK
        text node_id PK
        float x
        float y
        int degree
    }
    graph_tombstones {
        text city_slug PK
        text target_kind PK
        text node_id PK
        text edge_source PK
        text edge_target PK
        text edge_relation PK
        bigint t
        text reason
    }`,
  },
  // Annexe III.1 — physical model, current state. The proposed state is the modele-donnees
  // scene (§9.2), not repeated in the text (PHYSICAL['etat-propose'] stays for the tests).
  'etat-actuel': PHYSICAL['etat-actuel'],
  // §9.2 — the minimal model proposed from Steve’s needs (same as D2 option a).
  'modele-minimal': { title: 'Modèle cible par propriétaire : sentropic (annotations), immo (profil, données), engram (jeu de référence)', ...STEVE_MODEL },
  // Annexe III.2 — what exists on main today (schema.ts, migrations 0005 and 0011).
  existant: {
    title: 'Existant sur main : deux tables d’annotation, aucune table de jeu de référence',
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
  // §4.9 — old jeu de référence (extraction, E) and new jeu de référence (targeting, C), two separate
  // sections of benchmark #782. Boxes are artefacts, columns their main properties.
  'jeux-reference': {
    title: 'Ancien jeu de référence (E, extraction) et nouveau jeu de référence (C, ciblage) : deux volets du benchmark #782',
    layers: ['Sources', 'Jeux de référence, versions gelées', 'Benchmark #782'],
    placement: {
      consensus_modeles: { col: 0, row: 0 }, annotations: { col: 0, row: 1 },
      jeu_ref_e_v3: { col: 1, row: 0 }, jeu_ref_c_v2: { col: 1, row: 1 },
      volet_extraction: { col: 2, row: 0 }, volet_ciblage: { col: 2, row: 1 },
    },
    existing: ['consensus_modeles', 'jeu_ref_e_v3', 'volet_extraction'],
    labels: { construit: 'construit', adjugees_gelees: 'adjugées, gelées', note: 'note', note_b_puis_c: 'note B puis C' },
    colGap: 190,
    er: `erDiagram
    consensus_modeles ||--|| jeu_ref_e_v3 : construit
    annotations ||--|| jeu_ref_c_v2 : adjugees_gelees
    jeu_ref_e_v3 ||--|| volet_extraction : note
    jeu_ref_c_v2 ||--|| volet_ciblage : note_b_puis_c
    consensus_modeles {
      text methode "7 passes, 3 familles de modèles"
      text arbitrage "vote unanime + arbitrage"
    }
    annotations {
      text source "verdicts de Steve (124 lignes)"
      text adjudication "par critère, auteur nommé"
    }
    jeu_ref_e_v3 {
      text question "a-t-on extrait l'acte ?"
      text unite "acte d'un PV : étape + citation"
      int taille "674 sur 100 documents"
      text stockage "fichiers JSON du dépôt"
    }
    jeu_ref_c_v2 {
      text question "fallait-il montrer ce signal ?"
      text unite "signal, regroupé par dossier"
      text jeux "dev 51 villes, test neuf (§7.3)"
      text stockage "reference_set_versions + JSON gelé"
    }
    volet_extraction {
      text mesure "extraction historique, inchangée"
    }
    volet_ciblage {
      text mesure "précision, rappel : B puis C"
    }`,
  },
};
