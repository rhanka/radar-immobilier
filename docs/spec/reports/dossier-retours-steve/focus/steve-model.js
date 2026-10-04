// Minimal data model built from Steve's needs (§6.3, scene 2, option a of D2): five new
// tables, named plainly. Signals are reached by (city_slug, id texte), the graph key
// decided for #812, without a foreign key; oracle C is a frozen, versioned set of lines.
export const STEVE_MODEL = {
  layers: ['Fichiers et codes de Steve', 'Lignes et oracle gelé', 'Objets visés dans le graphe'],
  placement: {
    retours_fichiers: { col: 0, row: 0 }, motifs: { col: 0, row: 1 },
    retours_lignes: { col: 1, row: 0 }, oracle_versions: { col: 1, row: 1 },
    retours_cibles: { col: 2, row: 0 }, graph_nodes: { col: 2, row: 1 },
  },
  existing: ['graph_nodes'],
  labels: { contient: 'contient', motif: 'motif', remplace: 'remplace', vise: '1 à N cibles', ville_et_id_texte: 'ville + id texte, sans FK', fige: 'fige (liste gelée)' },
  colGap: 170,
  er: `erDiagram
    retours_fichiers ||--o{ retours_lignes : contient
    retours_lignes }o--o| motifs : motif
    retours_lignes |o--o| retours_lignes : remplace
    retours_lignes ||--o{ retours_cibles : vise
    retours_cibles }o..o| graph_nodes : ville_et_id_texte
    oracle_versions }o..o{ retours_lignes : fige
    retours_fichiers {
      uuid id PK
      text fichier_sha256 UK "même fichier = 0 écriture"
      text nom "radar-triage-signaux.xlsx"
      text revision "21 sept. 2026"
      text auteur "Steve Chaperon, externe"
      uuid importe_par FK "compte de l'importateur"
    }
    retours_lignes {
      uuid id PK
      uuid fichier_id FK
      text feuille "Triage, Écartés, Constats…"
      int ligne "ligne Excel"
      text ref "#7, C-79, R-21…"
      jsonb cellules "toutes les cellules, brutes"
      text classement "P, S, N ou vide"
      text motif_code FK
      text sens "assouplissement…"
      text passe "1, 2 ou 3"
      text statut "active, retirée, remplacée"
      uuid remplace_id FK "révision suivante"
    }
    motifs {
      text code PK "P-DENSITE, N-RESTRICTIF…"
      text classement "P, S, N ou V2"
      text critere "K1 à K9 ou exclusion"
      text regle "R-xx qui le justifie"
    }
    oracle_versions {
      uuid id PK
      text libelle UK "oracle-ciblage-steve-v1"
      text fichier_sha256 "export JSON gelé"
      jsonb unites "lignes retenues, dev / test"
      text valide_par "Fabien"
    }
    retours_cibles {
      uuid id PK
      uuid ligne_id FK
      text cible_type "signal, ville, règlement…"
      text city_slug "clé du graphe (#812)"
      text cible_id "id texte, ex. signal-…"
      text resolution "résolue, ambiguë, disparue"
      jsonb vu_par_steve "ville, date, verbatim"
    }
    graph_nodes {
      text city_slug PK "clé (city_slug, id), #812"
      text id PK "signal-… (texte)"
    }`,
};
