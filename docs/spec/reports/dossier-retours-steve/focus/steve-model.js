// Minimal data model built from Steve's needs (§6.3, scene 2, option a of D2). Annotations
// are living application data: Steve keeps annotating in the application with his own
// account, the team or the PO validates or contests, every decision is kept (validations)
// and every change is a new version (remplace_id). His spreadsheet is imported once and
// kept as is. Signals are reached by (city_slug, id texte), the graph key decided for
// #812, without a foreign key. Oracle C is a frozen, versioned set of validated annotations.
export const STEVE_MODEL = {
  layers: ['Source et codes', 'Annotations et validations', 'Cibles, comptes, oracle'],
  placement: {
    retours_fichiers: { col: 0, row: 0 }, motifs: { col: 0, row: 1 },
    annotations: { col: 1, row: 0 }, validations: { col: 1, row: 1 },
    annotation_cibles: { col: 2, row: 0 }, graph_nodes: { col: 2, row: 1 }, account_users: { col: 2, row: 2 }, oracle_versions: { col: 1, row: 2 },
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
    oracle_versions }o..o{ annotations : fige
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
    oracle_versions {
      uuid id PK
      text libelle UK "oracle-ciblage-steve-v1"
      jsonb unites "annotations validées, dev / test"
      text fichier_sha256 "export JSON gelé"
    }`,
};
