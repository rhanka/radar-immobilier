# Track report — tableau

Baseline commit: `f67814901657d5f2607b7cc2794e63dde280d28e`

## Synthèse

| Bucket | Nombre |
|---|---:|
| AWAITED | 6 |
| DROPPED | 1 |
| DONE | 68 |
| TO-DO | 33 |
| DECISIONS | 0 |

## AWAITED (6)

| # | Item | Réalisation | Acceptance | WSJF |
|---:|---|---|---|---:|
| 1 | WP B — Vertical profond geo (zone->lot), villes prioritaires opportunites<6mois x lots GeoJSON | done | unknown | 1.8 |
| 2 | CS-L1 — Scoring visuel lots 4+∩TOD (carte Opportunités, couche lots coloriée data-driven) | done | unknown |  |
| 3 | CS-L2 — Fiche lot complète (Évaluation): cadastre + rôle MAMH + zone + grille PDF + Google Maps + notes | to-do | unknown |  |
| 4 | CS-L3 — Marquage d'équipe + notes par lot + filtres par marque avec compteurs (Opportunités/Évaluation) | to-do | unknown |  |
| 5 | CS-L4 — Export CSV lettres de sollicitation + export de sélection (Opportunités) | to-do | unknown |  |
| 6 | CS-L5 — Filtres combinés potentiel(exclusif) × usage actuel(additif) × superficie min (Opportunités/Évaluation) | to-do | unknown |  |

## DROPPED (1)

| # | Item | Réalisation | Acceptance | WSJF |
|---:|---|---|---|---:|
| 1 | Graphify legacy redo OBSOLÈTE — rerun deterministic outputs with Sonnet 4.6 quota | cancelled | unknown |  |

## DONE (68)

| # | Item | Réalisation | Acceptance | WSJF |
|---:|---|---|---|---:|
| 1 | Header pas l'AppHeader canonique DS — écart structurel/visuel | done | unknown | 8.333333333333334 |
| 2 | Police DS non chargée app-wide — font-family Inter en dur, 0 @font-face | done | unknown | 8.333333333333334 |
| 3 | Filtre Signaux : les 3 filtres ne sont pas cochés par défaut | done | unknown | 8.333333333333334 |
| 4 | Filtre Signaux : état non persisté (URL / store / localStorage) | done | unknown | 8.333333333333334 |
| 5 | Filtre Signaux : taille de police des libellés trop grande | done | unknown | 8.333333333333334 |
| 6 | Panneau Signaux : déclarations font bespoke (hors tokens DS) | done | unknown | 8.333333333333334 |
| 7 | WP A.3 — Infrastructure data & agents (remote, backlog, graph DB, UI gestion + chat-ui) | done | unknown | 3.3333333333333335 |
| 8 | WP A.1 — Visualisation geographique-centrique (carte-first, bandeau de vues) | done | unknown | 3.25 |
| 9 | WP4-A — Investigation données réelles multi-villes | done | stale |  |
| 10 | WP4-B — Recueil substrat (RawDocument + S3) + 1ʳᵉ source | done | stale |  |
| 11 | WP4 — Pipeline exploitation (mentions -> réconciliation -> projection -> signaux) | done | stale |  |
| 12 | WP5-V1 — Ontologie graphify + modèle bitemporel Zod+PostGIS | done | stale |  |
| 13 | WP5 — Studio réconciliation (UI) + seed données réelles + valideurs D3 | done | stale |  |
| 14 | WP4 — Sources #2-5 (1 PR/source) | done | unknown |  |
| 15 | WP5 — Studio write-core (accept/reject -> patches graphify) | done | unknown |  |
| 16 | Provincial graph — partition par MRC quand N villes ingérées (différé) | done | unknown |  |
| 17 | WP4 source #2 — avis-publics Beauharnois adapter + seed ontologie enrichi | done | stale |  |
| 18 | WP4 source #3 — rôle d'évaluation MAMH SourceAdapter (collect->exploitation) | done | stale |  |
| 19 | WP4 source #4 — Adresses Québec adapter + mentions Adresse | done | stale |  |
| 20 | WP4 source #5 — règlements d'urbanisme adapter + Bylaw/Zone mentions | done | stale |  |
| 21 | Reconciliation graphify VISIBLE — chevauchement cross-source reel (avis<->reglement meme Bylaw) | done | stale |  |
| 22 | Ciblage — stage CiblagePlan (modele + UI editable, no I/O) pilotable | done | stale |  |
| 23 | Pipelines executables — declencher recueil(live)+exploitation depuis l'UI | done | stale |  |
| 24 | llmesh — extraction semantique graphify via @sentropic/llm-mesh (enrolment token) | done | stale |  |
| 25 | Backlog <-> track — brancher la vue Backlog sur le store track (au lieu de l'in-memory demo) | done | stale |  |
| 26 | Deploiement — k8s (PR #8) ou via sentropic | done | stale |  |
| 27 | Exploitation: l'etat projet est ECRASE par source au lieu d'accumuler (executor multi-sources) | done | stale |  |
| 28 | WP5 — Studio write-core (accept/reject -> patches graphify, token-gated) | done | stale |  |
| 29 | Backlog actualisation live (auto-refresh depuis le sidecar track) | done | stale |  |
| 30 | Write-core: candidat decide reste en file + set_status UI + token durable compose | done | stale |  |
| 31 | Réorientation « Grand filet » — radar changement de zonage, carte-first, multi-villes | done | unknown |  |
| 32 | A.1.1 Vue Signaux (maille Quebec/villes) — nb opportunites/ville sur 6 mois, clic ville -> liste changements de zonage | done | unknown |  |
| 33 | A.1.2 Vue Opportunites (maille ville/zones) — clic zone -> zoom | done | unknown |  |
| 34 | A.1.3 Vue Evaluation (maille zone/lots) — qualifier lots selon grilles de zonage | done | unknown |  |
| 35 | A.1.4 Vue Sources (maille Quebec, maturite recueil) — villes GeoJSON coloriees par maturite; clic -> liste donnees recueillies (site, PV scrappes/graphifies, avis, YouTube transcrits/graphifies, zonages/ilots/proprietaires PDF\|GeoJSON, statut) | done | unknown |  |
| 36 | A.2.1 Liste des villes + perimetre (rayon MTL extensible QC) via CiblagePlan | done | unknown |  |
| 37 | A.2.2 Scraper procès-verbaux GENERIQUE (avis de motion + changement de zonage + n. reglement a suivre) | done | unknown |  |
| 38 | A.2.3 YouTube seances: download + transcrit (Voxtral si besoin) + graphify | done | unknown |  |
| 39 | A.3.1 Graph DB / table graphe Postgres (nodes/edges) — persistance graphe ontologique (graphify graph.json) | done | unknown |  |
| 40 | A.3.3 UI de gestion (dont chat-ui) | done | unknown |  |
| 41 | Tracking progressif scraping par ville x source (automation 1shot/refresh, fenetre) | done | unknown |  |
| 42 | Source conseils-municipaux (PV) — automation=refresh | done | unknown |  |
| 43 | Source avis-publics — automation=refresh | done | unknown |  |
| 44 | Source youtube-seances — automation=refresh | done | unknown |  |
| 45 | chat.test.ts dépend des clés provider du .env (faux-négatif make test) | done | unknown |  |
| 46 | L1 — Geler l'anti-pattern + 2 bugs: rawObjectKey en CAS pur (retirer date-in-key) + sharder scrape-status (state/{city}/{kind}.json); aucune nouvelle fixture ville | done | unknown |  |
| 47 | L2 — Worker scrape -> S3: port Storage (PUT raw cas+meta) + manifestes de run (runs/.../manifest.jsonl); re-scraper les ~40 fixtures vers SCW | done | unknown |  |
| 48 | L3 — Persister parsed/ + graph/ sur S3 (docSha x parserVersion ; graphifyVersion x inputsetHash ; latest.json); le seed Postgres devient le projecteur (projection_meta) | done | unknown |  |
| 49 | graphify → DB graphe Postgres (persistance nodes/edges) | done | unknown |  |
| 50 | Mount S3 SCW read-only (substrat graphify) — rclone mount-scw.sh | done | unknown |  |
| 51 | Graphify evidence contract — signal description, citation and PDF link | done | stale |  |
| 52 | P3 Zones and lots display — priority detections with geometry fallback | done | unknown |  |
| 53 | P5 Admin validation view — approve reject suspend users | done | stale |  |
| 54 | Evidence-backed signal document cards | done | unknown |  |
| 55 | Baseline, specs, and track | done | unknown |  |
| 56 | Persist `publishedAt` at recueil time | done | unknown |  |
| 57 | Metadata repair from existing S3 | done | unknown |  |
| 58 | API evidence DTO and document route | done | unknown |  |
| 59 | UI signal card and PDF overlay | done | unknown |  |
| 60 | Graphify contract and non-regression gate notes | done | unknown |  |
| 61 | Merge readiness | done | unknown |  |
| 62 | Geo router compatibility layer — real /geo/* routes with hash compatibility | done | unknown |  |
| 63 | Geo URL state contract — mode selection focus filters viewport | done | unknown |  |
| 64 | Geo PDF overlay integration — signal evidence viewer with page bbox | done | stale |  |
| 65 | Filtre zones/lots : les listes Zones et Lots du panneau ville ne sont pas filtrées par le filtre actif (z/m/p) | done | unknown |  |
| 66 | Fiches de zones non affichées : l'accordéon Zones (ex. Saint-Frédéric, compteur=6) ne montre aucune fiche | done | unknown |  |
| 67 | Zones/lots matchant le filtre non colorisés sur la carte — highlight data-driven absent | done | unknown |  |
| 68 | PDF viewer Preuve ne rend pas — modal affiche erreur + fallback lien (route API PDF absente) | done | unknown |  |

## TO-DO (33)

| # | Item | Réalisation | Acceptance | WSJF |
|---:|---|---|---|---:|
| 1 | WP A.2 — Data: identification progressive 'easy first' + 4 agents remote | in-progress | unknown | 3.5 |
| 2 | A.2.4 Todo permanente + 4 agents background via remote (download/Obscura) + MAJ track | to-do | unknown |  |
| 3 | A.2.5 Captcha->Obscura pour identification proprietaire de lot (secondaire, rate-limite, role foncier public) | to-do | unknown |  |
| 4 | A.3.2 remote: orchestration des agents de scraping + suivi backlog (track) | to-do | unknown |  |
| 5 | Source zonage (PDF/GeoJSON) — automation=one_shot | to-do | unknown |  |
| 6 | Source role-evaluation (Donnees Quebec) — automation=one_shot | to-do | unknown |  |
| 7 | WP Persistance S3-first — SCW source de vérité, Postgres index reconstructible (1000 villes) | to-do | unknown |  |
| 8 | L4 — radar db rebuild (replay S3 -> Postgres) + test CI sur MinIO: preuve que Postgres n'est plus la source de vérité | to-do | unknown |  |
| 9 | L5 — Fixtures git reduites au golden set (par famille structurelle) + script fixture promote | to-do | unknown |  |
| 10 | L6 — Containeriser le worker -> SCW Serverless Jobs + Cron (40 -> 1000 villes sans OOM); bucket prod dedie + IAM scope | to-do | unknown |  |
| 11 | CS-L6 — Maquette: substrat données réel depuis le Netlify de Steve (4 villes, mode simulation) | to-do | unknown |  |
| 12 | CS-P1 — Différenciateurs P1: pastilles=Signaux auto, couches env, recherche, batch, labels, sync | to-do | unknown |  |
| 13 | CS-P2 — Compléments P2: annonces en vente, lookup code postal, éditeur zonage manuel, mobile, dashboard couverture | to-do | unknown |  |
| 14 | CS-P3 — Infra: backend sync temps réel multi-utilisateurs (+ AUTH) + export/import JSON (sorti de CS-P1) | to-do | unknown |  |
| 15 | CS-P2-S13 — Lookup code postal (Adresses Québec/IGO A7 + geocoder.ca fallback, cache) | to-do | unknown |  |
| 16 | Parsing graphify PV — exploitation sémantique (Sonnet 4.6) | in-progress | unknown |  |
| 17 | Script one-shot — bootstrap simulation (4 villes Steve + graphify) | to-do | unknown |  |
| 18 | Entités additionnelles ontologie graphify (dates, adresses, résolutions, personnes publiques) | to-do | unknown |  |
| 19 | Orchestration agentique remote — parsing graphify parallèle à l'échelle (3272 docs) | to-do | unknown |  |
| 20 | Evaluate deterministic extraction performance for ontology entities | to-do | unknown |  |
| 21 | DS redesign — map selection buckets and right-pane detail cards | in-progress | unknown |  |
| 22 | Graphify version parity — repo/container still pinned below global CLI | to-do | unknown |  |
| 23 | Graphify v2.3 — Sonnet 4.6 descriptions and exhaustive citations | in-progress | unknown |  |
| 24 | Geo selection — zones/lots incorporation for priority detections | in-progress | unknown |  |
| 25 | Data quality and admin validation views | in-progress | unknown |  |
| 26 | P1 DS alignment — AppShell header and rails on DS v3 | in-progress | unknown |  |
| 27 | P4 Data quality view — per-city PV YouTube ontology zones lots | in-progress | unknown |  |
| 28 | P2 Selection bucket UX — map selection and right-pane cards | in-progress | unknown |  |
| 29 | Recalage Track — drift post-2026-06-23 et consolidation Graphify/PDF/Geo/Auth | in-progress | unknown |  |
| 30 | Consolidation couche preuve — citation/PDF/rawRef de graphify au viewer | in-progress | unknown |  |
| 31 | Ownership geo de la preuve PDF liée aux signaux/zones/lots | in-progress | unknown |  |
| 32 | Auth durable Sentropic — éviter redemande permanente, session 15j, autorisation persistée | in-progress | unknown |  |
| 33 | Reliquats grounding citations — laurierville / saint-eustache / villes bloquées | in-progress | unknown |  |

## DECISIONS (0)

_Aucun item._

