# Scènes Focus du dossier « retours de Steve » : sources canoniques

- **Objet** : sources canoniques des cinq scènes de la page Focus du dossier [DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md](DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md), lues par `focus/build-map.mjs` (ancienne annexe B, sortie du rapport le 2026-10-05).
- **Placement** : chaque scène est rendue dans le chapitre qu'elle illustre, à l'endroit du repère `<!-- scene:<id> -->` du dossier : `criteres-steve` (§2.6), `affichage-abc` (§8.1), `modele-donnees` (§9.2), `flux-import-oracle` (§9.6), `architecture-ui` (§9.7). L'ordre ci-dessous est celui du dossier.
- **Formes** : `criteres-steve` est une matrice (tableau Markdown, un critère par ligne) ; `modele-donnees` un diagramme entité-relation (`erDiagram` : colonnes = stockage réel, badge = propriétaire du schéma ou du code, statut par objet) ; `flux-import-oracle` une architecture en couloirs verticaux (`flowchart LR`, un `subgraph` par couloir, jeu de référence en bande transversale en bas) ; `affichage-abc` deux zones (application en haut, évaluation hors ligne en bas) ; `architecture-ui` des composants en cartes A' 460 × 200, chaque `subgraph` étant un conteneur natif `parentId`.
- Elles ne changent rien au fond du dossier : elles rendent lisibles les chapitres qui les portent.

## `criteres-steve` — Les trois critères de Steve en regard de l'existant

| Critère | Steve demande | Radar aujourd'hui | Couverture | Bruit passe 1 |
|---|---|---|---|---:|
| 1 · Résidentiel | Habitation seulement, et un règlement d'urbanisme | Filtre Résidentiel par marqueurs regex ; nature de l'acte non reconnue | partiel | 3 |
| 2 · Assouplissement | La modification ouvre, elle ne resserre pas | Aucun champ de sens, aucun filtre | absent | 4 |
| 3 · Densification | Plus d'unités qu'avant | Champ d'effet toujours `inconnu` ; B′ ne prouve pas la densité | absent | 6 |
| Exclusion · autorisation individuelle | Une règle générale, pas un PPCMOI ni une dérogation accordés à un demandeur | PIIA et dérogation exclus ; PPCMOI et usage conditionnel non exclus | partiel | 8 |
| Exclusion · point d'ordre du jour | Une décision du conseil, pas un point inscrit à l'ordre du jour | Aucune distinction entre ordre du jour et décision | absent | 3 |
| Vue de travail · passe 1 | 22 sur 73 réunissent les trois critères | 34 des 40 Pertinent affichés | — | 24 |

## `affichage-abc` — A, B et C : ce que voit l'application, ce que mesure l'évaluation

```mermaid
flowchart LR
  subgraph A1["Utilisateurs"]
    USR["Steve et l'équipe"]
    ADM["Farid · recette UAT"]
  end
  subgraph A2["Écrans"]
    MAPB["Carte et rail · profil B"]
    MAPC["Carte et rail · profil C"]
    UATC["Comparaison B / C · UAT"]
  end
  subgraph A3["Backend · API Hono"]
    APIB["graph-signals · profil B"]
    APIC["Calcul C · shadow"]
  end
  subgraph A4["Base · PostgreSQL"]
    GRA["graph_nodes · inventaire"]
    ANN["annotations · verdicts Steve"]
    ORR["reference_set_versions"]
  end
  subgraph EV["Évaluation hors ligne · job Node"]
    PA["Profil A gelé"]
    DIFF["Diff B → C nommé"]
    ORA["Jeu de référence C"]
    MES["Mesure B et C"]
    GATE["Seuil de bascule D13"]
    DEC["Décision de Farid"]
  end
  USR -->|"voit B par défaut"| MAPB
  USR -.->|"voit C après bascule"| MAPC
  ADM -->|"recette"| UATC
  MAPB -->|"liste B"| APIB
  MAPC -->|"liste C"| APIC
  UATC -->|"B et C côte à côte"| APIC
  APIB -->|"lit"| GRA
  APIC -->|"même snapshot"| GRA
  GRA -->|"snapshot figé"| PA
  PA -->|"référence"| DIFF
  APIB -->|"sélection B"| DIFF
  APIC -->|"sélection C"| DIFF
  ANN -->|"labels étayés"| ORA
  ORA -->|"version gelée"| ORR
  DIFF -->|"écarts nommés"| MES
  ORA -->|"noté sur"| MES
  MES -->|"au seuil D13"| GATE
  GATE -->|"proposition"| DEC
  DEC -->|"bascule B → C"| MAPC
```

## `modele-donnees` — Stockage réel et propriétaires : Postgres, S3, geo, dépôt

```mermaid
erDiagram
    s3_raw ||..o{ job_refresh : lit_pv
    job_refresh ||..o{ s3_graph : ecrit
    job_refresh ||..o{ graph_nodes : projette
    s3_raw ||..o| documents : projection
    graph_nodes ||..o{ graph_edges : aretes
    registre_villes ||..o{ graph_nodes : city_slug
    graph_nodes ||..o{ geo_resolutions : node_id
    geo_resolutions }o..o| zone_versions : zone
    geo_resolutions }o..o| lot_versions : lot
    geo_ogc ||..o{ zone_versions : pull_ogc
    geo_ogc ||..o{ lot_versions : pull_ogc_lots
    app_immo }o..o{ graph_nodes : lit
    prospect_notes }o--o| signals : signal_id
    prospect_notes }o--|| account_users : auteur
    s3_retours ||..|| annotation_sources : octets
    annotation_sources ||--o{ annotation_revisions : import
    app_immo ||..o{ annotation_revisions : saisie
    annotation_revisions ||--o{ annotation_validations : decide
    annotation_revisions ||--o{ annotation_targets : vise
    annotation_targets }o..o| graph_nodes : signal
    annotation_targets }o..o| documents : document
    annotation_targets }o..o| zone_versions : zone_cible
    annotation_targets }o..o| lot_versions : lot_cible
    annotation_validations }o..o{ job_evaluation : export_hache
    job_evaluation ||..o{ s3_reference_sets : ecrit_eval
    job_evaluation ||..o{ manifestes : publie
    job_evaluation }o..o| decisions_track : preuve
    decisions_track ||..o| profil_domaine : promotion
    profil_domaine ||..o{ job_refresh : profil_prompt
    s3_raw {
      text cle PK "raw/proces-verbaux-<ville>/cas/<sha>.pdf"
      text index "raw/pv-index/cas/<sha>.<ext>"
      json sidecar "*.meta.json : url, dates, ville"
    }
    s3_graph {
      text cle PK "graph/<ville>/latest.json"
      text historique "graph/<ville>/history/…"
    }
    s3_runs {
      text runs PK "runs/<source>/<runId>/manifest.jsonl"
      text refresh "refresh/018/<ville>/runs/…"
      text etat "state/<ville>/<source>.json"
    }
    registre_villes {
      text city_slug PK "1 106 municipalités, JSON du code"
      text mrc "homonymes suffixés par la MRC"
    }
    job_refresh {
      text job PK "radar-refresh-pv (CronJob)"
      text image "ghcr.io/rhanka/radar-api"
      text moteur "@sentropic/graphify 0.18.0"
      text ecrit "latest.json puis graph_nodes"
    }
    app_immo {
      text service PK "API radar-api + UI"
      text lit "Postgres d'immo, proxy geo"
    }
    documents {
      uuid id PK
      text s3_key "clé raw/…/cas/<sha>"
      text sha256 "empreinte du PV"
      jsonb extracted
    }
    graph_nodes {
      text city_slug PK "clé (city_slug, id), #812"
      text id PK "signal-…, event-…, muni-…"
      text type "Signal, DesignationEvent…"
      text source_ref "clé S3 du document"
    }
    graph_edges {
      uuid id PK
      text src_id "+ ville du nœud (#812)"
      text dst_id "+ ville du nœud (#812)"
    }
    signals {
      uuid id PK "aucune écriture sur main"
    }
    zone_versions {
      uuid id PK
      text canonical_id "ogc:zones:<ville>:<code>"
      text city_slug
    }
    lot_versions {
      uuid id PK
      text canonical_id "ogc:lots:<ville>:<no_lot>"
      text no_lot
    }
    geo_resolutions {
      uuid id PK
      text node_id "Signal ou DesignationEvent"
      text target_id "canonical_id zone ou lot"
    }
    account_users {
      uuid id PK "+ compte de Steve (D5)"
      text sub "sujet IdP sentropic"
    }
    prospect_notes {
      uuid id PK
      text signal_cle "ville + id texte (B0)"
    }
    geo_ogc {
      text zonage PK "qc-zonage-<ville>"
      text lots "qc-lots-<ville>"
      text evenements "qc-zoning-events-<ville>"
    }
    profil_domaine {
      text fichier PK "radar/ontology/ontology-profile.yaml"
      text etiquettes "+ verdicts, motifs, critères, sens"
      text promotion "+ règle D13"
    }
    s3_retours {
      text cle PK "classeur de Steve, par sha256"
      text ecrit_par "port de @sentropic/annotations"
    }
    s3_reference_sets {
      text prefixe PK "préfixe privé, nom à fixer"
      text versions "éléments des versions figées"
      text runs "prédictions et résultats"
    }
    annotation_sources {
      uuid id PK
      text sha256 UK "fichier importé une fois"
    }
    annotation_revisions {
      text content_hash PK "immuable"
      text prev_content_hash "révision précédente"
      text auteur "identité IdP (compte de Steve)"
      jsonb corps "schéma d'étiquettes du profil"
    }
    annotation_validations {
      uuid id PK
      text revision_hash FK "liée au hash"
      text decision "accepter, contester, rejeter…"
    }
    annotation_targets {
      uuid id PK
      text cible_type "signal, ville, PV, zone, lot"
      text cle "clé fournie par immo"
    }
    job_evaluation {
      text job PK "évaluation hors ligne"
      text moteur "engram (eval)"
      text lit "instantané haché des validées"
    }
    manifestes {
      text fichier PK "manifestes et empreintes publics"
      text label_provenance "E silver, C human_single"
    }
    decisions_track {
      text fichier PK ".track/events.jsonl"
      text decisions "gel, promotion (attestées h2a)"
    }
```

## `flux-import-oracle` — Architecture de l'import à l'affichage, jeu de référence transversal

```mermaid
flowchart LR
  subgraph L1["Utilisateurs"]
    EQP["Équipe · Farid, Mathieu"]
    STV["Steve · client"]
    OPS["Opérateur · owner"]
  end
  subgraph L2["Écrans UI"]
    MAP["Carte Signaux"]
    PAN["Panneau signal"]
    RAI["Rail · compteurs"]
    REV["File de revue des ancres"]
  end
  subgraph L3["Fonctions backend"]
    COL["Collecte des documents"]
    DET["Détection de signal"]
    IMP["Import du classeur"]
    RAT["Rattachement"]
    GSA["API graph-signals"]
    ANA["API annotations"]
  end
  subgraph L4["Données"]
    subgraph S3["S3 · stockage objet"]
      DOCS["Documents sources"]
      SNAP["Snapshots du graphe"]
      XLSB["Octets du classeur"]
    end
    subgraph PG["PostgreSQL"]
      GRA["graph_nodes · signaux"]
      ANN["annotations · verdicts"]
      PNO["prospect_notes v1"]
    end
  end
  subgraph OR["Jeu de référence · évaluation hors ligne"]
    OE["Jeu de référence E v3"]
    BEN["Benchmark #782"]
    SCO["Scoreur Node"]
    OC["Jeu de référence C gelé"]
    ADJ["Adjudication par critère"]
  end
  EQP -->|"consulte"| MAP
  STV -->|"classeur + analyse"| OPS
  OPS -->|"cible Make · dry-run"| IMP
  OPS -->|"revue"| REV
  MAP -->|"sélection"| PAN
  MAP -->|"vivier B"| GSA
  PAN -->|"lecture groupée"| ANA
  RAI -->|"compteurs"| ANA
  REV -->|"décision humaine"| RAT
  COL -->|"PV et règlements"| DOCS
  DET -->|"lit"| DOCS
  DET -->|"latest.json"| SNAP
  DET -->|"signaux"| GRA
  IMP -->|"octets · sha256"| XLSB
  IMP -->|"lignes et évaluations"| ANN
  RAT -->|"ids présents"| GRA
  RAT -->|"ancres"| ANN
  GSA -->|"lecture"| GRA
  ANA -->|"lecture conforme"| ANN
  ANA -->|"réponses v1"| PNO
  ANN -->|"export évaluations et ancres"| ADJ
  ADJ -->|"version gelée"| OC
  OC -->|"précision, rappel"| SCO
  GRA -->|"sélection B, C en shadow"| SCO
  OC -->|"volet ciblage"| BEN
  OE -->|"volet extraction"| BEN
```

## `architecture-ui` — Architecture UI et état de la migration

```mermaid
flowchart LR
  subgraph U1["ui · Vite + Svelte 5"]
    SMV["SignauxMapView"]
    GCB["GeoCityMapBase"]
    SSP["SignauxSelPanel"]
    RAIL["SignauxRail"]
    COL["collab/*"]
    AV["Avis de Steve"]
    GV["GeoView"]
  end
  subgraph U2["api · Hono"]
    GS["graph-signals"]
    PNA["prospects/notes"]
    ANN["annotations"]
  end
  subgraph U3["sentropic"]
    DS["design-system-svelte"]
    GEO["geo-ui-svelte"]
    CMS["comments 0.2.0"]
  end
  SMV -->|"carte locale"| GCB
  SMV -->|"panneau"| SSP
  SMV -->|"rail"| RAIL
  SSP -->|"notes v1"| COL
  SSP -.->|"U1 · lecture seule"| AV
  COL -->|"ancre à réparer"| PNA
  AV -->|"lecture groupée"| ANN
  SSP -->|"vivier B"| GS
  ANN -.->|"cibles et lecture"| CMS
  AV -->|"Badge, Card, Alert"| DS
  GV -->|"pilote #/geo"| GEO
  GCB -.->|"migration future"| GEO
```
