// Minimal data model built from Steve's needs (§6.3, scene 2, option a of D2). Annotations
// are living application data: Steve keeps annotating in the application with his own
// account, the team or the PO validates or contests, every decision is kept (validations)
// and every change is a new version (remplace_id). His spreadsheet is imported once and
// kept as is. Signals are reached by (city_slug, id texte), the graph key decided for
// #812, without a foreign key. Jeu de référence C is a frozen, versioned set of validated annotations.
// Previous proposal: six immo tables (kept as option b of D2, construit puis migré).
export const SIX_TABLES = {
  layers: ['Source et codes', 'Annotations et validations', 'Cibles, comptes, jeu de référence'],
  placement: {
    retours_fichiers: { col: 0, row: 0 }, motifs: { col: 0, row: 1 },
    annotations: { col: 1, row: 0 }, validations: { col: 1, row: 1 },
    annotation_cibles: { col: 2, row: 0 }, graph_nodes: { col: 2, row: 1 }, account_users: { col: 2, row: 2 }, reference_set_versions: { col: 1, row: 2 },
  },
  existing: ['graph_nodes', 'account_users'],
  labels: { importe: 'import unique', motif: 'motif', remplace: 'nouvelle version', vise: '1 à N cibles', ville_et_id_texte: 'ville + id texte, sans FK',
    decide: 'valide ou conteste', auteur: 'auteur (compte)', decideur: 'décideur (compte)', fige: 'gèle les validées' },
  colGap: 170,
  er: `erDiagram
    retours_fichiers ||--o{ annotations : importe
    annotations }o--o| motifs : motif
    annotations |o--o| annotations : remplace
    annotations ||--o{ annotation_cibles : vise
    annotation_cibles }o..o| graph_nodes : ville_et_id_texte
    annotations ||--o{ validations : decide
    annotations }o--|| account_users : auteur
    validations }o--|| account_users : decideur
    reference_set_versions }o..o{ annotations : fige
    retours_fichiers {
      uuid id PK
      text fichier_sha256 UK "même fichier = 0 écriture"
      text nom "radar-triage-signaux.xlsx"
      text revision "21 sept. 2026"
      uuid importe_par FK "compte de l'importateur"
    }
    annotations {
      uuid id PK
      text origine "import ou saisie"
      uuid fichier_id FK "si import : feuille, ligne"
      text ref "feuille, ligne, #7, C-79…"
      jsonb cellules "import : cellules brutes"
      uuid auteur_id FK "compte de Steve"
      text classement "P, S, N"
      text motif_code FK
      text sens "assouplissement…"
      text passe "1, 2 ou 3"
      text commentaire
      text statut "proposée, validée, contestée"
      uuid remplace_id FK "version précédente"
    }
    motifs {
      text code PK "P-DENSITE, N-RESTRICTIF…"
      text critere "K1 à K9 ou exclusion"
      text regle "R-xx qui le justifie"
    }
    validations {
      uuid id PK
      uuid annotation_id FK
      uuid decideur_id FK "équipe ou PO"
      text decision "validée ou contestée"
      text motif "pourquoi"
    }
    annotation_cibles {
      uuid id PK
      uuid annotation_id FK
      text cible_type "signal, ville, règlement…"
      text city_slug "clé du graphe (#812)"
      text cible_id "id texte, ex. signal-…"
      text resolution "résolue, ambiguë, disparue"
      jsonb vu_par_steve "ville, date, verbatim"
    }
    graph_nodes {
      text city_slug PK "clé (city_slug, id), #812"
      text id PK "signal-… (texte)"
    }
    account_users {
      uuid id PK "Steve, équipe, PO"
    }
    reference_set_versions {
      uuid id PK
      text libelle UK "reference-set-ciblage-steve-v1"
      jsonb unites "annotations validées, dev / test"
      text fichier_sha256 "export JSON gelé"
    }`,
};

// Target model by owner (synthèse sentropic + engram, §6.1; scene 2, option a of D2): immo
// builds no annotation table. sentropic (@sentropic/annotations, tables in immo’s Postgres
// through the ./pg adapter) carries annotations, revisions, validations and targets; the
// immo profile carries the label schema (verdicts, motifs, criteria) and immo keeps its
// data (graph, accounts); engram carries the frozen reference sets and the runs.
export const STEVE_MODEL = {
  layers: ['sentropic · @sentropic/annotations', 'immo · profil et données', 'engram · jeu de référence, hors ligne'],
  placement: {
    annotation_sources: { col: 0, row: 0 }, annotation_revisions: { col: 0, row: 1 }, annotation_validations: { col: 0, row: 2 }, annotation_targets: { col: 0, row: 3 },
    profil_domaine: { col: 1, row: 0 }, account_users: { col: 1, row: 2 }, graph_nodes: { col: 1, row: 3 },
    reference_set_versions: { col: 2, row: 1 }, eval_runs: { col: 2, row: 2 },
  },
  existing: ['graph_nodes', 'account_users', 'profil_domaine'],
  labels: { import: 'import unique', remplace: 'révision suivante', decide: 'valide ou conteste', vise: '1 à N cibles', ville_et_id_texte: 'ville + id texte, sans FK',
    auteur: 'auteur (IdP)', decideur: 'décideur (IdP)', schema_corps: 'schéma d’étiquettes', export_hache: 'export haché des validées', mesure: 'runs' },
  colGap: 200,
  er: `erDiagram
    annotation_sources ||--o{ annotation_revisions : import
    annotation_revisions |o--o| annotation_revisions : remplace
    annotation_revisions ||--o{ annotation_validations : decide
    annotation_revisions ||--o{ annotation_targets : vise
    annotation_targets }o..o| graph_nodes : ville_et_id_texte
    annotation_revisions }o--|| account_users : auteur
    annotation_validations }o--|| account_users : decideur
    profil_domaine ||..o{ annotation_revisions : schema_corps
    annotation_validations }o..o{ reference_set_versions : export_hache
    reference_set_versions ||--o{ eval_runs : mesure
    annotation_sources {
      uuid id PK
      text sha256 UK "classeur de Steve, une fois"
      text octets "S3 d’immo, par un port"
    }
    annotation_revisions {
      text content_hash PK "immuable"
      text prev_content_hash FK "révision précédente"
      uuid auteur FK "Steve, identité IdP"
      text origine "import ou saisie"
      jsonb corps "verdict, motif, sens, tags"
      text statut "calculé des validations"
    }
    annotation_validations {
      uuid id PK
      text revision_hash FK "révision visée"
      uuid decideur FK "équipe ou PO"
      text decision "accepter, contester, rejeter…"
      text motif "pourquoi"
    }
    annotation_targets {
      uuid id PK
      text cible_type "signal, ville, PV, zone, lot"
      text city_slug "clé du graphe (#812)"
      text cle "id, sha256 ou canonical_id"
      jsonb vu_par_steve "instantané observé"
    }
    profil_domaine {
      text fichier PK "ontology-profile.yaml"
      text etiquettes "verdicts, 28 motifs, critères"
      text promotion "règle D13"
    }
    account_users {
      uuid id PK
      text sub "sujet IdP sentropic"
    }
    graph_nodes {
      text city_slug PK "clé (city_slug, id), #812"
      text id PK "signal-… (texte)"
    }
    reference_set_versions {
      text id PK "ReferenceSet@version"
      text label_provenance "human_single pour C"
      text partitions "dev 51 villes, test 52"
      text manifest_sha256 "gel décidé dans track"
    }
    eval_runs {
      text run_id PK
      text candidat "profil + prompt + modèle"
      text resultat "métriques, garde"
    }`,
};
