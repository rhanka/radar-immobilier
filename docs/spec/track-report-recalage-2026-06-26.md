# Track report — recalage post-drift 2026-06-26

Baseline commit: `7d1632d30bbaaa34789bf963542be6abe1000e85`
Generated: 2026-06-26T14:43:23-04:00

Ce rapport reconstitue la lecture attendue du Track après consolidation du drift post-mardi 2026-06-23.

## Updates ajoutés aujourd'hui

| Item | Bucket | Workspace | Sujet | État |
|---|---|---|---|---|
| `01KW2KS5K2D1Y7KGYF41ZAZGSW` | TO-DO | meta-track | Recalage Track — drift post-2026-06-23 et consolidation Graphify/PDF/Geo/Auth | in-progress |
| `01KW2KS5S8FC5150AEWQPP7X37` | TO-DO | wp5-ontology | Consolidation couche preuve — citation/PDF/rawRef de graphify au viewer | in-progress |
| `01KW2KS5ZDNY72Y2G3B6DRYZQ5` | TO-DO | frontB-geo | Ownership geo de la preuve PDF liée aux signaux/zones/lots | in-progress |
| `01KW2KS65RKCSBNBEWQVSN7PH7` | TO-DO | frontA-infra | Auth durable Sentropic — éviter redemande permanente, session 15j, autorisation persistée | in-progress |
| `01KW2KS6CAK6A761D81YMX8DY0` | TO-DO | wp5-ontology | Reliquats grounding citations — laurierville / saint-eustache / villes bloquées | in-progress |
## Lecture consolidée par domaine

### Graphify / citations

- `01KVB478A9NVXDWQPZPK8T8PZ9` reste **in-progress**: le scope 'exhaustive citations' n'est pas clôturé.
- Progrès ajoutés comme critères: contrat evidence/runner, runs grounding, backfill, reprise 2026-06-26.
- Nouveau reliquat: `01KW2KS6CAK6A761D81YMX8DY0` pour laurierville/saint-eustache/villes bloquées.

### Citation / PDF / preuve

- Le travail PDF/preuve livré par petites PRs est maintenant regroupé sous `01KW2KS5S8FC5150AEWQPP7X37`.
- Les anciens items DONE restent des livrables/feuilles: evidence contract, geo PDF overlay, bug viewer Preuve.

### Geo ownership

- Nouveau fil: `01KW2KS5ZDNY72Y2G3B6DRYZQ5` pour formaliser que Geo rend la preuve PDF/citation comme couche native signaux/zones/lots.

### Auth Sentropic durable

- Nouveau fil autonome: `01KW2KS65RKCSBNBEWQVSN7PH7`.
- Il couvre explicitement: redemande permanente login/autorisation, session/refresh 15 jours, stockage consentement/autorisation, séparation avec les fixes prompt=login de sécurité.

### Recalage Track

- Nouveau fil meta: `01KW2KS5K2D1Y7KGYF41ZAZGSW`.
- Document source: `docs/spec/audit-track-drift-2026-06-26.md`.

## Rapport Track brut

## AWAITED (6)
- **WP B — Vertical profond geo \(zone\-\>lot\), villes prioritaires opportunites\<6mois x lots GeoJSON** — done · unknown · wsjf:1.8
- **CS\-L1 — Scoring visuel lots 4\+∩TOD \(carte Opportunités, couche lots coloriée data\-driven\)** — done · unknown
- **CS\-L2 — Fiche lot complète \(Évaluation\): cadastre \+ rôle MAMH \+ zone \+ grille PDF \+ Google Maps \+ notes** — to-do · unknown
- **CS\-L3 — Marquage d'équipe \+ notes par lot \+ filtres par marque avec compteurs \(Opportunités/Évaluation\)** — to-do · unknown
- **CS\-L4 — Export CSV lettres de sollicitation \+ export de sélection \(Opportunités\)** — to-do · unknown
- **CS\-L5 — Filtres combinés potentiel\(exclusif\) × usage actuel\(additif\) × superficie min \(Opportunités/Évaluation\)** — to-do · unknown

## DROPPED (1)
- **Graphify v2.2 redo — rerun deterministic outputs with Sonnet 4.6 quota** — cancelled · unknown

## DONE (68)
- **Header pas l'AppHeader canonique DS — écart structurel/visuel** — done · unknown · wsjf:8.333333333333334
- **Police DS non chargée app\-wide — font\-family Inter en dur, 0 @font\-face** — done · unknown · wsjf:8.333333333333334
- **Filtre Signaux : les 3 filtres ne sont pas cochés par défaut** — done · unknown · wsjf:8.333333333333334
- **Filtre Signaux : état non persisté \(URL / store / localStorage\)** — done · unknown · wsjf:8.333333333333334
- **Filtre Signaux : taille de police des libellés trop grande** — done · unknown · wsjf:8.333333333333334
- **Panneau Signaux : déclarations font bespoke \(hors tokens DS\)** — done · unknown · wsjf:8.333333333333334
- **WP A.3 — Infrastructure data & agents \(remote, backlog, graph DB, UI gestion \+ chat\-ui\)** — done · unknown · wsjf:3.3333333333333335
- **WP A.1 — Visualisation geographique\-centrique \(carte\-first, bandeau de vues\)** — done · unknown · wsjf:3.25
- **WP4\-A — Investigation données réelles multi\-villes** — done · stale
- **WP4\-B — Recueil substrat \(RawDocument \+ S3\) \+ 1ʳᵉ source** — done · stale
- **WP4 — Pipeline exploitation \(mentions \-\> réconciliation \-\> projection \-\> signaux\)** — done · stale
- **WP5\-V1 — Ontologie graphify \+ modèle bitemporel Zod\+PostGIS** — done · stale
- **WP5 — Studio réconciliation \(UI\) \+ seed données réelles \+ valideurs D3** — done · stale
- **WP4 — Sources \#2\-5 \(1 PR/source\)** — done · unknown
- **WP5 — Studio write\-core \(accept/reject \-\> patches graphify\)** — done · unknown
- **Provincial graph — partition par MRC quand N villes ingérées \(différé\)** — done · unknown
- **WP4 source \#2 — avis\-publics Beauharnois adapter \+ seed ontologie enrichi** — done · stale
- **WP4 source \#3 — rôle d'évaluation MAMH SourceAdapter \(collect\-\>exploitation\)** — done · stale
- **WP4 source \#4 — Adresses Québec adapter \+ mentions Adresse** — done · stale
- **WP4 source \#5 — règlements d'urbanisme adapter \+ Bylaw/Zone mentions** — done · stale
- **Reconciliation graphify VISIBLE — chevauchement cross\-source reel \(avis\<\-\>reglement meme Bylaw\)** — done · stale
- **Ciblage — stage CiblagePlan \(modele \+ UI editable, no I/O\) pilotable** — done · stale
- **Pipelines executables — declencher recueil\(live\)\+exploitation depuis l'UI** — done · stale
- **llmesh — extraction semantique graphify via @sentropic/llm\-mesh \(enrolment token\)** — done · stale
- **Backlog \<\-\> track — brancher la vue Backlog sur le store track \(au lieu de l'in\-memory demo\)** — done · stale
- **Deploiement — k8s \(PR \#8\) ou via sentropic** — done · stale
- **Exploitation: l'etat projet est ECRASE par source au lieu d'accumuler \(executor multi\-sources\)** — done · stale
- **WP5 — Studio write\-core \(accept/reject \-\> patches graphify, token\-gated\)** — done · stale
- **Backlog actualisation live \(auto\-refresh depuis le sidecar track\)** — done · stale
- **Write\-core: candidat decide reste en file \+ set\_status UI \+ token durable compose** — done · stale
- **Réorientation « Grand filet » — radar changement de zonage, carte\-first, multi\-villes** — done · unknown
- **A.1.1 Vue Signaux \(maille Quebec/villes\) — nb opportunites/ville sur 6 mois, clic ville \-\> liste changements de zonage** — done · unknown
- **A.1.2 Vue Opportunites \(maille ville/zones\) — clic zone \-\> zoom** — done · unknown
- **A.1.3 Vue Evaluation \(maille zone/lots\) — qualifier lots selon grilles de zonage** — done · unknown
- **A.1.4 Vue Sources \(maille Quebec, maturite recueil\) — villes GeoJSON coloriees par maturite; clic \-\> liste donnees recueillies \(site, PV scrappes/graphifies, avis, YouTube transcrits/graphifies, zonages/ilots/proprietaires PDF\|GeoJSON, statut\)** — done · unknown
- **A.2.1 Liste des villes \+ perimetre \(rayon MTL extensible QC\) via CiblagePlan** — done · unknown
- **A.2.2 Scraper procès\-verbaux GENERIQUE \(avis de motion \+ changement de zonage \+ n. reglement a suivre\)** — done · unknown
- **A.2.3 YouTube seances: download \+ transcrit \(Voxtral si besoin\) \+ graphify** — done · unknown
- **A.3.1 Graph DB / table graphe Postgres \(nodes/edges\) — persistance graphe ontologique \(graphify graph.json\)** — done · unknown
- **A.3.3 UI de gestion \(dont chat\-ui\)** — done · unknown
- **Tracking progressif scraping par ville x source \(automation 1shot/refresh, fenetre\)** — done · unknown
- **Source conseils\-municipaux \(PV\) — automation=refresh** — done · unknown
- **Source avis\-publics — automation=refresh** — done · unknown
- **Source youtube\-seances — automation=refresh** — done · unknown
- **chat.test.ts dépend des clés provider du .env \(faux\-négatif make test\)** — done · unknown
- **L1 — Geler l'anti\-pattern \+ 2 bugs: rawObjectKey en CAS pur \(retirer date\-in\-key\) \+ sharder scrape\-status \(state/\{city\}/\{kind\}.json\); aucune nouvelle fixture ville** — done · unknown
- **L2 — Worker scrape \-\> S3: port Storage \(PUT raw cas\+meta\) \+ manifestes de run \(runs/.../manifest.jsonl\); re\-scraper les \~40 fixtures vers SCW** — done · unknown
- **L3 — Persister parsed/ \+ graph/ sur S3 \(docSha x parserVersion ; graphifyVersion x inputsetHash ; latest.json\); le seed Postgres devient le projecteur \(projection\_meta\)** — done · unknown
- **graphify → DB graphe Postgres \(persistance nodes/edges\)** — done · unknown
- **Mount S3 SCW read\-only \(substrat graphify\) — rclone mount\-scw.sh** — done · unknown
- **Graphify evidence contract — signal description, citation and PDF link** — done · stale
- **P3 Zones and lots display — priority detections with geometry fallback** — done · unknown
- **P5 Admin validation view — approve reject suspend users** — done · stale
- **Evidence\-backed signal document cards** — done · unknown
- **Baseline, specs, and track** — done · unknown
- **Persist \`publishedAt\` at recueil time** — done · unknown
- **Metadata repair from existing S3** — done · unknown
- **API evidence DTO and document route** — done · unknown
- **UI signal card and PDF overlay** — done · unknown
- **Graphify contract and non\-regression gate notes** — done · unknown
- **Merge readiness** — done · unknown
- **Geo router compatibility layer — real /geo/\* routes with hash compatibility** — done · unknown
- **Geo URL state contract — mode selection focus filters viewport** — done · unknown
- **Geo PDF overlay integration — signal evidence viewer with page bbox** — done · stale
- **Filtre zones/lots : les listes Zones et Lots du panneau ville ne sont pas filtrées par le filtre actif \(z/m/p\)** — done · unknown
- **Fiches de zones non affichées : l'accordéon Zones \(ex. Saint\-Frédéric, compteur=6\) ne montre aucune fiche** — done · unknown
- **Zones/lots matchant le filtre non colorisés sur la carte — highlight data\-driven absent** — done · unknown
- **PDF viewer Preuve ne rend pas — modal affiche erreur \+ fallback lien \(route API PDF absente\)** — done · unknown

## TO-DO (33)
- **WP A.2 — Data: identification progressive 'easy first' \+ 4 agents remote** — in-progress · unknown · wsjf:3.5
- **A.2.4 Todo permanente \+ 4 agents background via remote \(download/Obscura\) \+ MAJ track** — to-do · unknown
- **A.2.5 Captcha\-\>Obscura pour identification proprietaire de lot \(secondaire, rate\-limite, role foncier public\)** — to-do · unknown
- **A.3.2 remote: orchestration des agents de scraping \+ suivi backlog \(track\)** — to-do · unknown
- **Source zonage \(PDF/GeoJSON\) — automation=one\_shot** — to-do · unknown
- **Source role\-evaluation \(Donnees Quebec\) — automation=one\_shot** — to-do · unknown
- **WP Persistance S3\-first — SCW source de vérité, Postgres index reconstructible \(1000 villes\)** — to-do · unknown
- **L4 — radar db rebuild \(replay S3 \-\> Postgres\) \+ test CI sur MinIO: preuve que Postgres n'est plus la source de vérité** — to-do · unknown
- **L5 — Fixtures git reduites au golden set \(par famille structurelle\) \+ script fixture promote** — to-do · unknown
- **L6 — Containeriser le worker \-\> SCW Serverless Jobs \+ Cron \(40 \-\> 1000 villes sans OOM\); bucket prod dedie \+ IAM scope** — to-do · unknown
- **CS\-L6 — Maquette: substrat données réel depuis le Netlify de Steve \(4 villes, mode simulation\)** — to-do · unknown
- **CS\-P1 — Différenciateurs P1: pastilles=Signaux auto, couches env, recherche, batch, labels, sync** — to-do · unknown
- **CS\-P2 — Compléments P2: annonces en vente, lookup code postal, éditeur zonage manuel, mobile, dashboard couverture** — to-do · unknown
- **CS\-P3 — Infra: backend sync temps réel multi\-utilisateurs \(\+ AUTH\) \+ export/import JSON \(sorti de CS\-P1\)** — to-do · unknown
- **CS\-P2\-S13 — Lookup code postal \(Adresses Québec/IGO A7 \+ geocoder.ca fallback, cache\)** — to-do · unknown
- **Parsing graphify PV — exploitation sémantique \(Sonnet 4.6\)** — in-progress · unknown
- **Script one\-shot — bootstrap simulation \(4 villes Steve \+ graphify\)** — to-do · unknown
- **Entités additionnelles ontologie graphify \(dates, adresses, résolutions, personnes publiques\)** — to-do · unknown
- **Orchestration agentique remote — parsing graphify parallèle à l'échelle \(3272 docs\)** — to-do · unknown
- **Evaluate deterministic extraction performance for ontology entities** — to-do · unknown
- **DS redesign — map selection buckets and right\-pane detail cards** — in-progress · unknown
- **Graphify version parity — repo/container still pinned below global CLI** — to-do · unknown
- **Graphify v2.3 — Sonnet 4.6 descriptions and exhaustive citations** — in-progress · unknown
- **Geo selection — zones/lots incorporation for priority detections** — in-progress · unknown
- **Data quality and admin validation views** — in-progress · unknown
- **P1 DS alignment — AppShell header and rails on DS v3** — in-progress · unknown
- **P4 Data quality view — per\-city PV YouTube ontology zones lots** — in-progress · unknown
- **P2 Selection bucket UX — map selection and right\-pane cards** — in-progress · unknown
- **Recalage Track — drift post\-2026\-06\-23 et consolidation Graphify/PDF/Geo/Auth** — in-progress · unknown
- **Consolidation couche preuve — citation/PDF/rawRef de graphify au viewer** — in-progress · unknown
- **Ownership geo de la preuve PDF liée aux signaux/zones/lots** — in-progress · unknown
- **Auth durable Sentropic — éviter redemande permanente, session 15j, autorisation persistée** — in-progress · unknown
- **Reliquats grounding citations — laurierville / saint\-eustache / villes bloquées** — in-progress · unknown

## DECISIONS (0)
