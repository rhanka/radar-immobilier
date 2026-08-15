# SPEC CONSOLIDÉE — Radar Immobilier (2026-07)

Statut : document interne de synthèse (état réel + architecture + dettes + feuille de route).
Date : 2026-07-03.
Auteur : volet Opus d'un double consensus (analyse parallèle Codex).
Base de vérité : `docs/spec/reports/study-2026-07/report.md` (rapport phare, 2026-07-02) + mesures
S3/API geo live, code de branche `origin/main` (HEAD `f544980`, PR #328), rapports WP `docs/spec/reports/**`,
specs `docs/spec/**`, et l'état `track` (0.25.0).

> **Objet.** Unifier les ~80 specs et ~30 rapports épars en une vue unique de ce que le produit
> **est aujourd'hui**, de son **architecture réelle**, de ses **dettes** et de sa **feuille de route**.
> On **consolide, on ne recopie pas** : chaque section cite ses sources et signale les
> **contradictions / éléments périmés** (registres en Annexe A et B).
>
> **Convention de qualification** (héritée du rapport phare) : **[LIVE]** = mesuré sur données/code
> à une date donnée · **[mesuré]** = mesuré à date antérieure, historique · **[projeté]** =
> extrapolation crédible non réalisée · **[en attente]** = dépend d'une donnée/livraison externe
> identifiée. Aucune métrique n'est présentée comme acquise si elle ne l'est pas.
>
> **Portée client-facing.** Ce document est **interne** : il emploie le vocabulaire d'ingénierie
> (« honnête », « pire statut », « vérifié live »). Ce vocabulaire est **interdit en UI client**
> (voir §4.5 — copy neutre **Servi / Partiel / Non couvert**).

---

## 1. Vision & périmètre

### 1.1 Mission

Radar automatisé des **changements de zonage** et des **opportunités de densification résidentielle**
dans les municipalités du Québec : détection, à partir des documents municipaux (procès-verbaux,
avis publics, règlements d'urbanisme), des signaux réglementaires — **rezonage, PPCMOI, dérogations
mineures, PIIA, usage conditionnel, CPTAQ** — puis qualification géospatiale des lots concernés
(zone → grille de normes → lot cadastral). Ville pilote historique :
**Salaberry-de-Valleyfield**. Livrable Phase 1 : une **démo aboutie** servant de base à une
proposition et à une tarification client (source : `AGENTS.md`, `docs/spec/input/VISION.md`).

### 1.2 Les deux axes de lecture indissociables

Toute métrique se lit sur **deux axes**, jamais additionnés (source : `report.md` §Résumé,
`wp1-data-state.md §0`, `wp6-focus-rollup.md`) :

- **Axe COUVERTURE — 30 vs 1104.** *Focus 30* = 30 villes prioritaires (`priorityRank` 1→30,
  banlieues CMM / Rive-Sud / West Island), banc de démonstration E2E « signaux ». *Province ≈1104*
  = cible provinciale = **1106** entrées du registre − **2** exclues (Montréal, Laval). Un même
  indicateur a **deux valeurs** (ex. v2.3 = **25/30** ET **978/1104**).
- **Axe PROFONDEUR DE PREUVE — 33 E2E vs 5000+.** *33* = cohorte « opportunités témoins »
  suivies bout-en-bout (signal → document → zone → grille → lot), périmètre WPB-E2E des
  33 opportunités prioritaires `z∩m∩p`. *5000+* = échelle cible de couples **ville × signal**
  (aucun recensement par-signal n'existe encore ; repère mesuré : **7202** nœuds Signal+DesignationEvent
  province). C'est la **vérifiabilité de chaque couche** (citation, code de zone exact, lot rattaché,
  norme verbatim) qui conditionne l'usage réel.

> ⚠️ Le « **33** » nomme la **cohorte cible**, pas un compte d'anomalies : l'audit réel
> (`wp3-33-anomalies.md`) porte sur **10 villes / 27 signaux / 28 anomalies**. Voir §3.8.

### 1.3 Tableau d'état — Focus 30 vs Province ≈1104

Chiffres **[LIVE 2026-07-02]** sauf mention (source : `report.md` §Résumé + Annexe ;
définitions détaillées en Annexe C).

| Couche (finalité) | Focus 30 | Province ≈1104 | Statut |
|---|---:|---:|---|
| **PV scrapés** — recueil brut (~3272 documents) | **27 / 30** | **~1007 / 1104** | [LIVE] — préalable ; 3 focus sans brut (brossard, kirkland, lile-dorval) |
| **Signaux extraits** (graphe v2.3) | **25 / 30** | **978 / 1104** | [LIVE] — graphe = *méthode d'extraction*, pas finalité |
| **Signaux à citation vérifiable** | **56 / 70** (cible 100 %) | ~55 % pondéré | [LIVE] — 14 signaux à purger/re-grounder (§3.2) |
| **Zonage servi** (geo) | **29 / 30** (seul lile-dorval manque) | **568 / 1106** | [LIVE] |
| **Grilles de normes** (verbatim) | pilote Salaberry : **97,9 % des 15 510 lots** | alignement 4 villes réf. en cours | [LIVE — pilote] |
| **Lots servis** (cadastre MRNF) | **30 / 30** | **~1102 / 1106 villes** | [LIVE] |
| Données nominatives (propriétaires) | — | — | [en attente] — cadré, non lancé (Loi 25, §3.6) |
| Aires TOD (PMAD/CMM) | 4 villes réf. en priorité | — | [en attente] — filtre UI câblé |
| Signaux **désignant une zone** | **14 / 30** | — | [LIVE] — vrai goulot de consistance |
| Consistance signal↔zone (rappel) | **~60 %** proxy (28/47) | **71/120 = 59,2 %** (55 villes) | [LIVE 29 juin] — plafond app ~57 % (§3.7) |

> ⚠️ **Incohérence de dénominateur** : le rapport utilise **1106** pour les couches geo
> (zonage 568/1106, lots 1102/1106) mais **1104** pour les couches immo (signaux 978/1104). À
> harmoniser (Annexe B, C-1). « **1102 lots** » est en réalité **~1102 villes servies en lots**,
> pas 1102 lots.

### 1.4 Ce qui a été livré sur la fenêtre (PR #310 → #328)

Séquence réelle (source : `git log origin/main`), regroupée par thème :

- **Design system / header** (#310, #311) : migration `AppHeader`/`AppChrome` DS, Inter self-hostée,
  nav centrée, filtres Signaux persistés (URL + localStorage), police déterministe.
- **Vue Sources** (#318, #320, #323) : `/api/source/coverage` set-based, choroplèthe pire-statut,
  tri-état Partiel réel, copy neutre client, mesure zonage/lots sur listing geo **live**.
- **Carte / parité** (#321, #324, #315) : zones live OGC + colorisation parité concurrent, filtres
  données combinés, fiche lot/zone enrichie, parité carte de référence Évaluation C1-C10 et Signaux.
- **Flags & données** (#314) : `multifamilial4plus`/`priorite` réels + zone jointe sur items OGC lots.
- **MCP claude.ai** (#312, #313, #316, #317) : POC transport remote → bundle self-contained →
  4 outils de données brutes (zones/lots GeoJSON, grille & PV PDF) → smoke MCP via ingress + guide
  connecteur.
- **Rapport in-app + étude** (#319) : vue `#/rapport` DS + rapport phare actualisé (données par
  couche, 2 bancs E2E).
- **FinOps & fiabilité infra** (#322, #325, #326, #327, #328) : correction du **crashloop radar-api**
  (« étude B » : `/livez` public découplé des dépendances + heap cap + pg timeout + image `:latest`
  + startupProbe/limites 768Mi), scale maildev+obscura à 0.

---

## 2. Architecture

### 2.1 Vue d'ensemble et principe de séparation

Monorepo **npm workspaces**. Le principe structurant, écrit littéralement dans le code
(`api/src/routes/geo-collections.ts:5` : *« immo = frontend, geo = data »*) :

- **immo** (ce dépôt) = **frontend + domaine + orchestration** : SPA, API de domaine, graphe projeté,
  scoring, mapper de résolution, infra de scraping dur (Obscura).
- **geo** = **service externe** OGC API Features `https://api.geo.sent-tech.ca` (overridable
  `GEO_OGC_BASE_URL`), consommé en **passthrough**. geo owne l'acquisition géospatiale générique.

Chaîne de traitement (source : `report.md` §3.A) :

```
Sources municipales / géo → Acquisition & scraping (Obscura) → OCR / graphify (Sonnet 4.6)
  → Graphe normalisé + citations (v2.3) → Projection PostgreSQL/PostGIS → API domaine (Hono)
  → Application UI (SPA) → Intégrations assistées (connecteur MCP)
```

### 2.2 Services & runtime (mesuré dans `deploy/k8s/**`, `api/`, `ui/`)

| Service | Techno | Port | Image | Notes |
|---|---|---|---|---|
| **radar-api** | Hono + `@hono/node-server` | 3000 | `radar-api:latest` | 768Mi/500m, `--max-old-space-size=512`, `strategy: Recreate`, replicas 1 |
| **radar-ui** | nginx servant un build **Vite + Svelte 5** (SPA) | 8080 | tag figé `main-…` (écrasé par le CD) | proxifie `/api/*` → radar-api |
| **radar-immo-mcp** | Hono, MCP Streamable HTTP | 8848 | **même image `radar-api`** (`node packages/immo-mcp/dist/server-http.js`) | 256Mi ; hors kustomization |
| radar-postgres (PostGIS) | Postgres | 5432 | — | projection géospatiale |
| radar-minio | MinIO S3 | 9000 | — | dev/cluster ; prod = SCW S3 |
| radar-obscura | Rust headless (CDP anti-bot) | 9222 | `radar-obscura:latest` | **replicas 0** (FinOps) |
| radar-maildev | maildev | 1025/1080 | — | **replicas 0** (FinOps) |

> ⚠️ **Correctif de cadrage.** L'UI n'est **pas SvelteKit** : c'est une **SPA Vite + Svelte 5**
> (routeur maison hash `#/vue` + routeur path `/geo/...`, aucun `svelte.config.js`). Le pod MCP
> **n'a pas d'image dédiée** : il tourne sur l'image `radar-api` (le `api/Dockerfile` bundle
> `packages/immo-mcp/dist/`).

Packages du monorepo : `packages/immo-mcp`, `packages/radar-domain`, `packages/radar-scoring`,
`packages/radar-sources`. Écosystème sentropic réutilisé (`AGENTS.md`) : `@sentropic/design-system-svelte`
(+ themes/tokens), `@sentropic/geo-core`/`geo-ui-svelte`, `maplibre-gl`, `@sentropic/chat-ui`,
`@sentropic/llm-mesh`, `@sentropic/mcp-auth`/`oauth-verify`, `graphifyy`, `obscura`, `@sentropic/harness`.

### 2.3 API de domaine (Hono — `api/src/app.ts`, ~25 sous-routeurs)

Le guard OIDC (`protect`) est monté en `app.use("*")` **avant** les routes métier, no-op si
`auth.enabled=false` (dev/tests ouverts). Routes clés :

- **Santé** : `GET /livez` — liveness **process-only, publique**, aucune sonde de dépendance (cible
  des `startupProbe`/`livenessProbe`) ; `GET /health` — readiness (sonde DB + object store, 503 si
  dégradé).
- **Auth** : `GET /api/v1/auth/{login,enroll,oauth/callback,logout,me}` — RP OIDC
  (`authorization_code` + **PKCE** vs `auth.sent-tech.ca`, vérif JWKS, cookie session HttpOnly maison).
- **Geo (cœur carto, passthrough OGC)** : `GET /api/geo/collections/:id/items` — priorité **store local
  Postgres** (`zone_versions`/`lot_versions`) puis **fallback proxy** vers geo ; anti-SSRF (seuls
  `qc-zonage-*` / `qc-lots-*`) ; enrichit les lots server-side (zone jointe, `multifamilial4plus`,
  `superficieM2`). Aussi `GET /api/geo/{cities,:city/lots,:city/zones,features/:citySlug}`.
- **Sources** : `GET /api/source/coverage` (+ `/:citySlug/grilles`) — couverture tri-état
  **bulk set-based** (`GROUP BY citySlug`), pas 1104 appels per-city, pas de scan S3 live.
- **Signaux / graphe / opportunités** : `/api/signals/by-city`, `/api/signals/:city/detail`,
  `/api/graph-signals/*`, `/api/graph/*`, `/api/opportunites`, `/api/ciblage/*`.
- **Prospects (marques/notes)** : `POST /api/v1/prospects/{marks,notes,marks/batch}` (écriture — voir
  §4.4 la branche non réconciliée), `GET .../{lots,zones,contacts}`.
- **Documents** : `GET /api/documents/raw` — sert les PV publics archivés (S3 CAS).
- Divers : `/api/scrape-status`, `/api/data-quality/:city`, `/api/ontology/*`, `/api/jobs`,
  `/api/backlog`, `/api/h2a/*`, `/api/chat/*`.

Prefixes **publics même quand auth activé** (`PUBLIC_PREFIXES`) : `/livez`, `/health`, les 5
`/api/v1/auth/*`, **`/api/geo/collections`** et **`/api/documents/raw`** (ces 2 pour que le pod MCP,
sans session, atteigne les données publiques).

### 2.4 Connecteur MCP (`packages/immo-mcp`, `@radar/immo-mcp` v0.0.1)

Deux transports partageant un même `registerTools` :
- **stdio** (`src/server.ts`, bin `immo-mcp`) — auth stubbée depuis l'env (dev/v0).
- **remote Streamable HTTP** (`src/server-http.ts`) — **OAuth 2.1 Resource Server** (RFC 9728 PRM +
  RFC 6750) via `@sentropic/mcp-auth` + `@sentropic/oauth-verify`, exposé à `https://immo.sent-tech.ca/mcp`.

**10 outils, tous read-only** (`ALL_TOOL_NAMES`) :
- **6 outils domaine v0** (`ctx.data`, actuellement **MOCK**) : `search_lots`, `get_lot_card`,
  `search_signals`, `get_opportunity_dossier`, `list_documents`, `read_document_excerpt`.
- **4 outils raw-data** (`ctx.raw`, **câblés à la vraie API radar** quand `RADAR_API_BASE_URL` set) :
  **`get_zones_geojson`**, **`get_lots_geojson`** (FeatureCollection GeoJSON bornées : limit 500 /
  max 2000, bbox obligatoire >500, indicateurs 4+/TOD par lot), **`get_grille_pdf`**, **`get_pv_pdf`**
  (URL du PDF archivé, jamais inliné).

Chaque handler est `guarded()` : `assertScope` depuis le **contexte d'auth validé** (jamais depuis
les arguments LLM) + audit stderr (hash d'input + correlationId, pas de payload brut). Scopes
consentis : `immo:read`, `immo:search`, `immo:documents:read` (gated : `notes:write`,
`decisions:propose`, `admin`).

**Auth remote** : issuer = **`https://auth.sent-tech.ca`** (ConfigMap `IMMO_MCP_OAUTH_ISSUER`),
audience/resource = `https://immo.sent-tech.ca/mcp`, JWKS remote `${issuer}/.well-known/jwks.json`.
Le pod **ne détient aucun secret** — il ne fait que **vérifier** les bearer tokens. Le **PKCE est
côté client OAuth** (claude.ai / le RP `radar-api`), **pas** dans le pod MCP (pur Resource Server).

> ⚠️ **Correctif de cadrage.** Il y a **10 outils** (pas 4) ; les « 4 outils » du brief sont les
> **4 outils de données brutes**, câblés live, qui s'ajoutent aux 6 outils domaine v0 encore en MOCK.

### 2.5 Kubernetes & CD (`deploy/k8s/**`, `.github/workflows/`)

`kustomization.yaml` inclut : `00-namespace`, `10-rbac`, `20-postgres-postgis`, `25-minio`,
`30-api`, `34-refresh-cronjob`, `35-obscura`, `40-maildev`, `50-ui`, `60-ingress`, `70-networkpolicy`,
`80-auth`. **Le MCP (`40-immo-mcp-http-deploy.yaml`, `41-immo-mcp-ingress.yaml`) est délibérément
HORS kustomization** — appliqué seulement par le workflow manuel.

- **Sondes** radar-api : `startupProbe`+`livenessProbe`→`/livez` (public, process-only, 30×5s),
  `readinessProbe`→`/health`. Découplage volontaire (une panne DB/S3 sort du LB sans tuer le pod).
- **CronJobs** : `radar-refresh-scrape` (`17 3 * * *`, **suspend:true**) + `radar-refresh-projection`
  (`30 4 * * *`, **suspend:true**) ; `radar-populate-geo-daily` (`17 4 * * *`, **actif**, 768Mi).
- **Jobs one-shot** (appliqués à la main) : `31` graph-projection (backfill+migrate+project),
  `32/32b` projection-only/reproject-etape, `33` scrape (`worker-live.js`), `35a` populate-geo,
  `35-run-geo-mapper`, `36` db-migrate.
- **Ingress** : host `immo.sent-tech.ca`, `/` → radar-ui:8080 ; `/mcp` → radar-immo-mcp:8848 (hors
  kustomization). NetworkPolicy default-deny.
- **CD** : `build-push-images.yml` — sur push `main`, build+push api & ui vers
  `rg.fr-par.scw.cloud/radar-immobilier`, puis `kubectl set image deploy/radar-api|radar-ui :<sha>`
  + `rollout status` (SA `radar-ci-deployer`, secret `KUBE_CONFIG_DATA`, **pas de GitOps**).
  `k8s-apply-mcp.yaml` — **manuel** (`workflow_dispatch`) : seul chemin qui déploie le MCP
  (apply 30/40/41/70 + rollout restart + smoke PRM).

> ⚠️ **Correctif de cadrage.** Le workflow `ci-k8s.yml` cité dans le brief **n'existe pas** sous ce
> nom ; le CD réel est **`build-push-images.yml`** + **`k8s-apply-mcp.yaml`**.

### 2.6 Persistance S3-first (`SPEC_PERSISTENCE_S3_FIRST.md`, validé)

Principe : **SCW S3 = source de vérité immuable ; Postgres = index/cache reconstructible ; git =
code + config, jamais de donnée scrapée**. Layout CAS sha256 :
`raw/parsed/graph/runs/state/registry/fixtures`, `latest.json` = pointeurs, manifestes de run = axe
transaction-time (bitemporel). `radar db rebuild` from-S3 testé en CI. Loi 25 : `raw/` privé jamais
servi, filtrage PII au parsing, aucun nom de personne physique en nœud graphify. **Cible de scaling**
1000+ villes : SCW Serverless Jobs + Cron (voir §6, dette « scale sans OOM »).

---

## 3. Couches de données par état

> **Cadre de lecture (source B, `data-division-immo-geo.md` + les cadrages 14-27 juin).** Deux
> strates de specs coexistent. **Strate A** — design relationnel/ontologique « papier » (6-7 juin :
> `SPEC_ONTOLOGY_DATA_MODEL`, `SPEC_DESIGN_DATA_MODEL`, `SPEC_EVOL_DATA_MODEL`,
> `SPEC_INTENT_DATA_MODEL_ZONING_LOTS`) : modèle riche event-sourced/bitemporel, profil graphify à
> 10 nœuds, validateur radar — **explicitement des esquisses non implémentées**. **Strate B** — ce
> qui a **réellement tourné** (graphify v2.3, geo OGC, mapper #74 mesuré, split immo/geo). **Cette
> section décrit la Strate B** (l'état) ; la Strate A est traitée en **vision cible relationnelle**
> (§7 + Annexe A), pas comme état.

### 3.1 PV / documents bruts (immo)

Substrat brut (PV, avis publics, règlements) scrapé **par configuration** (registre central des
municipalités + scraper générique), archivé S3 en **adressage par contenu** (docSha, `.meta.json`
sidecar). Scraping dur porté par le sidecar **Obscura** (CDP anti-bot ; geo n'a aucune brique
anti-bot). YouTube des séances transcrit (Voxtral) — avis anticipé ~15 j avant le PV.

- **[LIVE]** ~**3272 documents** bruts ; **~1007 / 1104** villes ont un substrat ; focus **27 / 30**
  (brossard, kirkland, lile-dorval sans brut).
- **Limite** : ~**97 villes** cibles n'ont **aucun** brut (portails protégés, sites sans PDF, périmètres
  non résolus) — classées dans un manifeste des villes « dures ». Préalable au reste (le graphify est
  impossible sans brut).

### 3.2 Signaux & ontologie versionnée (immo, graphify)

Signaux réglementaires extraits des PV via **graphify** (CLI `graphifyy` v0.10.0, run Sonnet 4.6). Le
graphe est la **méthode de parsing**, pas la finalité : la finalité est un signal daté, typé, **cité**
et localisable. Versions **réellement déployées** (`ontology_version`) :

| Version | Ajout | Mécanisme | Source |
|---|---|---|---|
| **v2.0** | base `Signal` + `DesignationEvent` (522 villes) | nœuds + arêtes | `etape-anticipation-delegation.md` |
| **v2.1** | axe **ANTICIPATION** : `etape` (enum ordonné `avis_motion > projet_reglement > consultation_publique > second_projet > adoption > entree_vigueur` + instruments) + `etape_date`, `outcome` | **propriété** (rétro-compat) | idem |
| **v2.2** | props `zone_ref`, `no_lot`, `reglement_number` (valeur brute, clé omise si absente) | **propriété** | `extraction-zone-lot-delegation.md` |
| **v2.3** | contrat **EVIDENCE** : `description` obligatoire + `refs[]` (`excerpt` verbatim, `page`, `bbox`, `docSha`, `sourceUrl`) ; axes de dates distincts ; **arêtes canoniques** `TARGETS_ZONE`/`TARGETS_LOT`/`REZONES`/`RAISES_SIGNAL` | refs + gates | `SPEC_INTENT_GRAPHIFY_V23_EVIDENCE.md` |

Le passage **v2.2 → v2.3** est un **durcissement de la preuve** (pas un changement de format) : il
publie *moins* de signaux mais chaque signal publié est **traçable jusqu'au document**. Le gate v2.3
refuse toute citation non vérifiable, protège **33 détections `z|m|p`** par manifeste à clé métier
(pas par comptage), et ne requiert pas de rescrape complet.

> ⚠️ **Contradiction majeure v2.2 ↔ v2.3 (Annexe B, B-1).** `extraction-zone-lot-delegation.md` est
> **intégralement estampillé « legacy OBSOLÈTE »** : l'approche « props plates = mécanisme canonique
> du mapper » a été **renversée** par v2.3, qui **rétablit les arêtes** comme structure canonique et
> démote `zone_ref`/`no_lot`/`reglement_number` au rang de *« derived convenience properties, must
> not replace the graph relation »*. **Décision consolidée** : la relation canonique est l'**arête**
> (v2.3) ; les props restent des commodités dérivées. Le mapper #74 réel vit encore dans une zone
> grise (il lit des champs structurés) — à faire converger vers les arêtes.

**État mesuré :**
- **[LIVE]** **978 / 1104** villes en v2.3 (après publication saint-césaire) ; fourchette assumée
  **~976–978** (mesure fraîche hash-join = 976/977) ; focus **25 / 30** (saint-constant, saint-philippe
  encore v2.2). L'ancien audit S3 « 145/1104 » (18 juin) est **obsolète**.
- Reliquat **128 villes** = ~**31 graphes v2.2** résiduels (à re-grounder) + ~**97 villes sans brut**
  (préalable scraping).
- **Rigueur mesurée** : run déterministe sur les 30 v2.2 résiduelles → **1/30 publié** (saint-césaire),
  29 bloquées (22 sans référence groundée, 6 sans description, 1 structurellement invalide). Le worker
  déterministe **ne lit pas le raw** ; grounder les 22 exige une **re-extraction LLM depuis le PDF**
  (pipeline non câblé dans `tools/graphify-v23/runner.sh`). *Moins de volume, meilleure confiance*
  (source : `2.3-finition-progress.md`, non commité au 2026-07-03).

### 3.3 Grounding (citations page/bbox) & cleansing (immo)

**Contrat** (`SPEC_INTENT_GRAPHIFY_V23_EVIDENCE.md`) : chaque `Signal`/`DesignationEvent` porte une
`description` groundée + `refs[]` avec citation **verbatim** (30-400 car.), `page` requis pour PDF,
`bbox` requis *si le chemin d'extraction peut le fournir* (jamais fabriqué).

**Diagnostic du gap** (`grounding-pilot-mont-tremblant.md`) : les baselines portaient `docSha` (→
passaient le gate) mais `sourceUrl`/`citation`/`page` = **null** et les refs d'arête étaient
**synthétiques** (`source_file: generated://…`, `synthetic:true`) → côté produit, **bouton PDF
invisible, zéro citation**. Le **cleansing** = purger ces refs `generated://`/`synthetic` et injecter
les vraies citations.

**Pipeline réutilisable** `tools/grounding/` : `nodes-by-sha` → `pdftotext -layout` → `extract-citations.sh`
(Sonnet 4.6, `found:false` si introuvable, zéro invention) → `build-grounded-graph.py` (injecte
`refs[]`, purge synthetic, bump `ontology_version→2.3`) → `gate.sh` → publish atomique SCW.

**État réel :**
- Pilote **Mont-Tremblant** : **COMPLET** (13/13 nœuds cités, projection PG passe de **0→13** sur
  `source_url`/`citation`/`page`/PDF).
- **Rimouski** : coordonné (4/5 PV cités) mais **pas re-traité** (évite une course de publication) ;
  nécessite le backfill des `.meta.json`.
- **Reste** : villes **non groundées**. `docSha` seul suffit au gate mais pas au produit.
- **Focus 30** : **56 / 70** signaux à citation vérifiable (cible **100 %**, 14 à traiter).

> ⚠️ **Incohérence d'unité (Annexe B, C-3).** Le rapport dit « **70 signaux, 56 groundés** » (~80 %,
> unité « signaux curés ») ; `wp1-atome-par-ville.md` mesure « **188 / 250 Signal+DesignationEvent** »
> (75 %, unité nœuds) ; province pondérée **3862 / 7021 ≈ 55 %**. Deux définitions ; à trancher.
> L'audit a montré des citations **partiellement fabriquées** en v2.2 (une ville : 12/12 identifiants
> de document introuvables) — d'où la cible 100 % non négociable.

### 3.4 Zones géographiques — par méthode d'acquisition (geo)

Polygones de zonage acquis par le partenaire geo, servis via OGC et projetés en PostgreSQL/PostGIS.
**Principe : un scraper par TYPE de plateforme, pas par ville** (marché QC = 3 éditeurs Esri /
PG Solutions-Azimut / K2-JMap ; `cadrage-zones-lots-acquisition.md`).

| Méthode | Plateforme | Périmètre estimé | Statut |
|---|---|---|---|
| **Cadastre allégé** (lots) | ArcGIS REST MRNF (couche province unique) | **1104/1104**, 4,64 M lots, clé `NO_LOT` | **résolu** (`cadastre-allege.ts`) |
| **ArcGIS REST** (T1) | Esri FeatureServer/MapServer (dominant) | ~150-250 villes | **livré** (`arcgis-zonage.ts`) |
| **CKAN Données Québec** (T2) | open data packagé | ~10-15 villes | **livré** (`ckan-zonage.ts`) |
| **JMap** (T3) | K2 (grandes villes) | ~10-30 | non fait |
| **GOnet / Azimut** (T4) | PG Solutions (souvent derrière login) | minoritaire | à éviter (auth+obscura) |
| **PDF + recalage géoréf.** (T5) | plans scannés | ~27 à ~600-800 (voir ⚠️) | R&D + POC Saint-Amable |

> ⚠️ Le « **GeoNet** » du brief correspond vraisemblablement à **GOnet/Azimut (T4)** + la couche de
> service OGC `api.geo.sent-tech.ca` — pas une méthode distincte. **Incohérence de périmètre PDF**
> (Annexe B, B-6) : `cadrage-zones-lots-acquisition` parle de ~600-800 villes PDF-only ;
> `cadrage-extraction-zones-pdf` cible ~27 (sous-ensemble résiduel prioritaire). À réconcilier.

**Recalage PDF** (`cadrage-extraction-zones-pdf.md`) : détection auto de 4 sous-types (GeoPDF géoréf,
PDF vectoriel, raster géoréf, scan pur). Levier **cadastre-ancrage** : caler les PDF non-géoréf sur les
lots MRNF et matérialiser les contours par `ST_Union` des lots par zone (jointure lot→zone gratuite).
POC Saint-Amable réussi (géoréf auto + 16 codes + polygone). Taux : code géoréf **>85 %** auto sur
T1/T2/T3 ; contour exact 95 %+ (T2), ~15 % semi-manuel (T4).

**État mesuré :**
- **[LIVE]** **568 / 1106** villes servies en zonage ; focus **29 / 30** (seul lile-dorval manque).
- **Bascule geo datée** (progression, pas contradiction) : zonage focus **2-3/30 (28 juin) → 29/30
  (2 juil)** ; province **~234/1104 → 568/1106**. La colonne zones de `wp1-atome-par-ville-full.tsv`
  (qui donnait 3/1104) était **buggée** (sweep S3 sous-comptant) — utiliser l'API `/collections`.
- Exemple validé **Salaberry** : **645 zones**, **96,3 %** de correspondance au règlement, **0 trou spatial**.
- **[LIVE]** ~**506 collections `qc-zonage-*`** dont ~**200 fragments** (variantes ArcGIS, affectations,
  PIIA) que le mapper **ne requête jamais** (il construit `qc-zonage-${citySlug}` en dur). La
  **canonisation à une collection par ville** (task **#92**) est le chantier de stabilité du comptage.

> **Point d'architecture — geo « live » vs projection PG.** Le rapprochement signal→zone lit la
> **projection PostgreSQL** (`zone_versions`/`lot_versions`), peuplée par le **pull** — encore limité
> à ~**7 villes**. Le rappel est donc **plafonné par l'état du PG, pas par geo** (la carte Évaluation,
> elle, lit geo en **direct** via passthrough OGC et bénéficie déjà du 29/30). Levier : **puller les
> 29/30 en PG** (jobs `populate-geo` prêts). Voir §6, dette « mapper PG pull ».
>
> **Cible d'architecture — zero-copy (Annexe B, B-4).** `cadrage-zerocopy-geo.md` (2026-06-20) déclare
> le pull OGC→PostGIS **« mal designé »** (duplication de millions de polygones, staleness, upsert O(n))
> et recommande le **zero-copy** : geo publie un lakehouse **GeoParquet/Iceberg** + **PMTiles** (rendu)
> + **index léger** + **manifeste versionné** ; immo consomme via **DuckDB embarqué**, joint sur la
> **clé normalisée** (jamais la géométrie), `setFeatureState(feature_id)`. Les colonnes
> `*_versions.geom` sont **dépréciées** (flag `GEO_BACKEND=pg|duckdb`). `feature_id` **possédé par geo**
> remplace le `canonical_id` inventé par immo. **Le pull PG actuel est transitoire.**

### 3.5 Grilles de zonage (normes) (geo + parser immo)

Couche qui transforme une zone en **règles constructibles** (usages permis, hauteur, marges, densité).
Levier de la qualification « 4+ logements **fondée grille** » (vs heuristique). Extraction des normes
**verbatim** (valeur exacte, cellule, page), rattachement zone→normes puis lot→zone→normes.

- **[LIVE — pilote]** **Salaberry** : **97,9 % des 15 510 lots** portent leurs normes ; mapping
  lot→zone→normes complet.
- **Alignement en cours** sur les 4 villes de référence (Delson, Sainte-Catherine, Saint-Constant,
  Candiac) ; **exposition des normes dans l'API geo en cours** (déclencheur du « 4+ fondé grille »).
- **Hors pilote : 0** couche grille structurée (province/focus).
- **Reco IA prudente** (`report.md §1.4`, `BLOCKERS.md`) : conserver **Mistral OCR 4** (bon sur PDF
  complexes) ; **ne pas utiliser la completion Mistral** pour reconstruire une grille réglementaire
  tant que l'écart d'erreur n'est pas **mesuré et borné** (une valeur critique fausse = inacceptable) ;
  préférer l'extraction **structurée avec preuve** (cellule/page/citation).

### 3.6 Lots (cadastre) & données nominatives (geo)

Parcelles cadastrales (numéro `NO_LOT` + géométrie) issues du **cadastre public MRNF (CC-BY)**, bornées
par commune/bbox.

- **[LIVE]** **~1102 / 1106 villes** servies en lots ; focus **30 / 30**. (« 1102 lots » du brief =
  **1102 villes**.)
- **Salaberry** : **100 %** des lots assignés à une zone (jointure par code, sinon **jointure spatiale
  par centroïde** — avec indicateur de méthode, jamais présentée comme exacte).
- **Données nominatives (propriétaires) : [en attente].** La donnée servie est **géométrique/cadastrale
  uniquement, sans propriétaire**. **Décision 2026-06-27 (la plus récente, fait foi,
  `decision-proprietaires-lots-geo-loi25.md`)** : la donnée propriétaire **passe côté geo** en **accès
  contrôlé** (auth obligatoire, déclaration Loi 25, séparée des couches publiques, journalisée, masquée
  par défaut en API publique/démo). L'item immo `frontA-data A.2.5` (captcha→Obscura propriétaire) est
  **abandonné**. Tests anti-PII UI/API en place (1 rouge à recaler, §4.3).

### 3.7 Mapper #74 — consistance signal↔zone (immo)

Rapprochement signal→zone : extraction du code cité (regex sur `label`+`description`, les champs
structurés étant quasi vides), normalisation (`code_norm`), jointure `zones.code_norm = normalize(x)
AND city_slug`, Levenshtein ≤ 2 si score ≥ 0.70, score de confiance (0.85/0.65/0.40), seuil publication
0.50, tables `geo_resolutions`/`geo_unresolved` (`cadrage-geo-integration-mapper.md`).

**Ordre des candidats de champ** (le cœur de #74 — `ui/src/lib/maps/zones-client.ts`, l'ordre compte,
premier non-vide gagne) :

> `zone_code` (priorité 1) > `ZONE`/`Zone`/`Zonage`/`NO_ZONAGE`/`zone_` > **`ETIQUETTE` composite**
> (parse dédié : 2ᵉ token) > `code`/`Code` générique (après `OBJECTID`) > **ids séquentiels
> `NumZone`/`NUM_ZONE` en dernier**.

Caveats : `Zone` **avant** `Code_zone` (sinon hampstead `RA-2` écrasé par `RA`) ; `NUM_ZONE` de
saint-hyacinthe est un **ID numérique** (`10001`), le vrai code = 2ᵉ token d'`ETIQUETTE` → parse dédié.

**Rappel mesuré** (`wp3-mapper-recall-2026-06-28.md`, tâche #74 — trois mesures, sans extrapolation,
sur les 55 villes d'intersection signal-désignant-zone ∩ collection zonage servie) :

| Mesure | Rappel | Date |
|---|---:|---|
| Live (tel quel) | **52 / 110 = 47,3 %** | 28 juin |
| Après fix immo (lecture des champs non-candidats) | **63 / 110 = 57,3 %** (+9,1 pts ; rimouski 0→5/5, saint-hyacinthe 0→4/4) | 28 juin |
| Re-mesure finale (immo + geo ; dénom. 110→120) | **71 / 120 = 59,2 %** (31 complet, 36 ≥1 match, 19 à zéro) | 29 juin |

Vue « modelled » (inclut les nœuds `Zone` graphify plus fins) = 117/189 = **61,9 %**. Proxy focus-30 =
**28/47 ≈ 60 %**.

**Diagnostic (anti-survente) :**
- Hypothèse **« zéro de tête » RÉFUTÉE** (0/58) : le padding est identique des deux côtés.
- Répartition des 58 non-appariés : **gap-data 37 (63,8 %)**, **champ-non-lu 11 (19 %, fixable immo)**,
  **écart-schéma 10 (17,2 %)**, format-zéro-tête **0**.
- **~81 % des non-matchs ne sont PAS corrigeables côté application** : extraction graphify trop
  grossière (famille `H1` vs sous-zone `H1-30` — renvoie à **#68**) ou couche geo divergente
  (affectation servie au lieu de la grille). **Plafond immo ≈ 57-59 %** ; aller au-delà exige les
  vraies grilles (geo) et l'affinage de la granularité d'extraction (graphify).

### 3.8 Réconciliation E2E & les 33 opportunités témoins

Audit `wp3-33-anomalies.md` (10 villes / **27 signaux**, 9 en v2.3 + hemmingford v2.2) — la cohorte
« 33 » est le **périmètre cible**, l'audit réel trouve **28 anomalies** :
- `zone_ref` structuré **5/27** · citation absente **8/27** (→ 19/27 groundés) · sans page **8/27** ·
  avec bbox **0/27** ; nœuds Zone **15**, avec géométrie **0/15**.
- 28 anomalies : **DATA pur 15 (54 %)** · ALGO pur 6 (21 %) · mixte 7 (25 %) ; DATA impliqué 22/28
  (79 %), ALGO 13/28 (46 %).
- Niveaux de preuve (`wp6-focus-rollup.md`) : **niveau 1** (signal×PDF) **19/27 = 70,4 %** ;
  **niveau 2** (signal×zone) **5/27 = 18,5 %** ; **niveau 3** (signal×zone×grille×lot) = **non recensé,
  bloqué** (grilles structurées = 0 hors pilote).

Lecture : la normalisation/jointure **côté application est saine** ; le levier de progression restant
est **hors application** (données geo + granularité d'extraction) — ce qui guide la priorisation (§7).

### 3.9 TOD (aires de transit)

Aires TOD (transit-oriented development) du PMAD/CMM — critère majeur de qualification (densification
près des transports). **[en attente]** : incrément **demandé au fournisseur geo** (4 villes de référence
en priorité). Côté produit, filtre TOD + colorisation **déjà câblés**, s'activeront à réception.

> ⚠️ Le maillon **TOD** n'apparaît dans **aucune** des specs data/geo consolidées — il est spécifié
> uniquement côté produit/rapport. À formaliser (acquisition + schéma).

---

## 4. Vues produit

Référentiel autoritaire : **4 vues, zéro nouvel écran**, toutes câblées sur l'API réelle
(`SPEC_EVOL_INTEGRATION_CARTE_USER_REVIEW.md`). Socle carto partagé **`GeoCityMapBase`** extrait, mémoire de
viewport (`viewport-memory.ts`) entre navigations.

> ⚠️ **Correctif de cadrage (nav réelle).** La barre de nav DS (`TopNav`) n'expose que **3 items** :
> **Signaux · Évaluation · Sources**. **Opportunités** (`OpportunityFunnel`) et **Rapport**
> (`RapportView`, `#/rapport`) existent mais sont **hors nav** (accès contextuel / deep-link). Le brief
> les liste comme vues principales ; ce sont des vues secondaires. **Grilles** est un **onglet
> d'Évaluation** (pas une vue).

### 4.1 Signaux (carte-first) — **fonctionnel**

`SignauxMapView` (défaut). Choroplèthe Québec (SVG à la maille province), nb de changements de zonage/
ville sur 6 mois ; clic ville → vol cartographique + rail listant les `DesignationEvent`. **3 filtres
de type** (`z|m|p`) **persistés URL + localStorage** ; recherche de villes ; citations affichables ;
viewer PDF (pdf.js) sur **archive S3** (repli métadonnées quand la source est complexe). Les
« pastilles » manuelles du concurrent deviennent nos **signaux auto-générés** depuis les PV.

### 4.2 Évaluation — **alignée sur l'application de référence (livraison 2 juillet)**

`EvaluationMapView` (carte lots cadastraux + zones jointes, couche geo **live** passthrough OGC ;
onglet **Grilles**). **Filtres combinés** (4+ logements, TOD, priorité, usages, superficie min) ;
**colorisation hiérarchique** (vert 4+, bleu TOD, ambre priorité, hors-filtre estompé) ; **fiche lot
enrichie** (adresse, superficie, façade estimée par méthode géométrique documentée, zone, **normes
verbatim** si dispo, liens cartes externes). **Dérivation « 4+ logements » = 97,5 % d'exactitude sur
3171 lots** vs application de référence. Limites : TOD **[en attente]** (filtre câblé) ; carte **SVG**
plafonnée `limit:200` (MapLibre à généraliser) ; marques/prospects **en lecture seule**.

### 4.3 Sources (qualité de données) — **fonctionnel, fiabilisé**

`SourceMapView` (+ onglet **Console**). Autoritaire : **`SPEC_EVOL_SOURCE_VIEW.md`** (D1-D7) —
`SPEC_STUDY_SOURCE_VIEW.md` en est le **prédécesseur périmé** (Annexe B, B-8). Modèle de couverture
**par ville × couche**, pipeline e2e en **7 couches** : L1 recueil brut → L2 graphifié (v2.3) →
L3 grounding → L4 zonage servi → L5 lots servis → L6 rappel #74 → L7 consistance e2e. **V1 =
L1+L2+L4+L5** (L3/L6/L7 → V2, jointures coûteuses).

- **Choroplèthe « pire statut »** : couleur d'une ville = **l'étape la plus en retard** de sa chaîne.
  **Pas de score 0-100 en couleur** (un vert global mentirait quand #74=59,2 % et ~97 villes sans
  graphe). **Vert uniquement si vérifié live** ; couleur distincte `absent` vs `déclaré non substantié`.
- **Tri-état par cellule** interne : `vérifié live` / `déclaré non substantié` / `absent` (le code
  data-quality expose `fresh|partial|stale|unknown` — trois vocabulaires à aligner, Annexe B, B-9).
- Alimenté par `/api/source/coverage` (bulk set-based), `/api/scrape-status`, `/api/signals/by-city`.
  Headline province + highlight focus-30. **Insight actionnable** (D7) : surfacer le prochain gain
  marginal (villes scrapées+graphifiées mais sans zonage/lots servis).
- **Tests** : suite UI **680** (669 pass, 1 fail, 10 todo, 10 skip) ; sous-ensemble lots/fiche/prospect/
  scoring **86/86 vert**. Le seul rouge = test **anti-PII `EvaluationMapView`**, périmé par l'injection
  d'un score dérivé public (`potentialScore`, pas une PII) — **à recaler**.

### 4.4 Opportunités & Rapport in-app

- **Opportunités** (`OpportunityFunnel`, hors nav) : **entonnoir de dossiers de démonstration**
  (fixture statique `valleyfieldDossiers`), **pas** la carte lots/scoring branchée sur l'API. La carte
  lots scorée+filtrée réelle existe côté **Évaluation**. La **carte Opportunités réelle reste à faire**.
  Cible : funnel 6 phases + scoring **par axe** (jamais un /100).
- **Rapport in-app** (`RapportView`, `#/rapport`) : vue DS qui rend le rapport d'étude (import `?raw`).
  Au niveau plateforme, c'est une **capacité copilote** (rapports/mémos préparés, **validés par un
  humain avant sortie externe** — responsabilité OACIQ/Loi 25), **pas un 5ᵉ écran**.

**Parité « carte de référence » concurrent** = l'**outil de Steve** (prospection foncière manuelle,
Leaflet + Firestore, 4 villes hardcodées). Décision (2026-06-11, `SPEC_CONTROLE_PARITE_VILLES_USER_REVIEW.md`)
: importer son corpus en **table de contrôle golden isolée** (`ControlLot`/`ControlMark`, clé
`(citySlug, NO_LOT)`), **jamais** dans le store opérationnel, puis **mesurer la parité**. 4 villes golden
(**delson** 3213 lots, **sainte-catherine** 5615 + 5253 marques d'équipe, **saint-constant** 11261,
**candiac** 7190 sans zonage/TOD = cas-test honnête). **Séparation stricte load-bearing** :
`detectZonageChange` ne lit jamais la table de contrôle (sens unique : la parité **mesure** le pipeline,
ne le nourrit jamais). **17/17 features du concurrent mappées** sur les 4 vues, anti-features corrigées
(JSON monolithe→API paginée ; Firestore sans auth→backend+auth ; hardcode→data-driven ; état d'URL
`?ville&view&zoom&filtres&lot&signal`).

**Cartographie tranchée** (`SPEC_EVOL_INTEGRATION_CARTE_USER_REVIEW.md §8`) : **MapLibre GL** pour lots/zones
(WebGL, style data-driven, ~11k polygones/ville) ; **SVG conservé** à la maille Québec
(Signaux/Sources). Leaflet écarté ; PMTiles différé (arrive avec le zero-copy geo).

### 4.5 Règle client-facing — copy neutre (load-bearing)

La copy produit doit être **neutre** : **Servi / Partiel / Non couvert**. Est **INTERDIT** en
client-facing tout jargon interne : « honnête », « pire statut honnête », « anti-survente »,
« déclaré non substantié », « vérifié live », « absent ». Mapping de présentation : `vérifié live` →
**Servi** ; `déclaré non substantié`/`stale`/`partial` → **Partiel** ; `absent`/`unknown` → **Non
couvert**. Le **principe** d'honnêteté (jamais de statut favorable non substantié) reste intact ; seul
le **libellé** change (source : D2/D6 `SPEC_EVOL_SOURCE_VIEW.md` + mémoire projet).

---

## 5. Plateforme

### 5.1 Auth OIDC sentropic

RP OIDC vers l'IdP **`auth.sent-tech.ca`** (`authorization_code` + **PKCE**, scopes `openid profile
email` ; `deploy/k8s/80-auth.yaml` + `api/src/services/auth/oidc.ts`). Session radar = **JWS HS256
stateless**, cookie HttpOnly `radar_session`. Réversibilité : la couche d'identité est **branchable/
retirable** sans toucher au domaine ; le produit fonctionne avec ou sans.

- **[LIVE]** **Session durable 15 j + sliding re-mint + `prompt=login` conditionnel** — **atterri**
  (commit `02c52eb`, cookie sliding TTL 15 j / plafond 30 j).
- ⚠️ **Drift spec↔code (Annexe B, B-10).** `wp5-plateforme.md §B` décrit encore la **cible** (TTL 8 h
  → 15 j) comme non faite (item `01KW2KS65RKCSBNBEWQVSN7PH7`) : le rapport WP est **périmé sur ce
  point**, le 15 j est livré. Reste : **persistance du consentement IdP** (dépendance repo `sentropic`).

### 5.2 Connecteur MCP claude.ai — **en production**

Serveur MCP remote (§2.4) enrôlable depuis claude.ai. **Flux connecteur** (`claude-ai-connector-setup.md`)
: *Add custom connector* → URL `https://immo.sent-tech.ca/mcp` → **client public (secret vide) = PKCE** →
401 challenge → PRM `/mcp/.well-known/oauth-protected-resource` → RFC 8414 AS metadata → RFC 7591
Dynamic Client Registration (claude.ai s'auto-enregistre) → `authorization_code` + PKCE → token
`aud=https://immo.sent-tech.ca/mcp` → consentement scopes.

- ⚠️ **Contradiction datée (Annexe B, B-2).** `immo-mcp-drumbeat-2026-06-28.md` + `wp5-plateforme.md §A`
  (28 juin) le disent **« jamais réalisé, 0 fichier, BLOQUÉ »** ; le rapport phare (2 juil) le dit
  **« en production, OAuth 2.1/PKCE, validé e2e »**. Il a été **construit et déployé entre le 28 juin
  et le 2 juillet**.
- ⚠️ **Drift issuer (Annexe B, B-3).** `immo-mcp-remote-deploy.md` §4.1 documente encore un issuer
  **`idp.sent-tech.ca`** placeholder (« presumément différent d'`auth.sent-tech.ca` ») ; le **code/
  ConfigMap live** est passé à **`auth.sent-tech.ca`** (commit `63c7552`, « confirmé par sentropic »).
  Le doc de déploiement est **périmé** ; la valeur autoritaire est `auth.sent-tech.ca`. Gap résiduel :
  le `client_id` public à minter côté IdP (handover externe).

### 5.3 Tracking (`track` 0.25.0)

Backlog structuré en **6 workpackages** perennes (WP1 DATA · WP2 EXTRACTION · WP3 RÉCONCILIATION E2E ·
WP4 PRODUIT · WP5 PLATEFORME · WP6 GOUVERNANCE) + 29 sous-items + items historiques. MCP `track` en
**lecture seule** ; écritures via **CLI depuis la racine** ; `.track` append-only single-writer.

- ⚠️ **Reparent Track bloqué (Annexe B, B-11).** Le reparent physique des 111 items **échoue**
  (invariant de containment Track 0.19.2) ; le rattachement WP est porté en **projection ratifiée**
  (`wp6-item-wp-map.json`) — requiert un verbe CLI `item reassign-workspace`. Le `track report` affiche
  **0/29** faits (acceptance non fraîche) alors que l'état réel mesuré est **62 % done** (§6.5).

### 5.4 Modèle opérationnel — **hors V1**

`SPEC_EVOL_OPERATING_MODEL.md` (multi-tenant SaaS B2B, multi-tiers, escalade humaine sur le chemin
critique) est une **hypothèse business explicitement HORS V1** (V1 = mono-opérateur). Ne pas construire.

---

## 6. Dettes techniques & décisions ouvertes

| # | Dette / décision | État | Levier / item |
|---|---|---|---|
| **D1** | **Grounding cleansing** — 100 % de signaux à citation vérifiable (focus 56/70, 14 à re-grounder/purger ; province ~55 %) | pilote Mont-Tremblant complet, reste à généraliser | pipeline `tools/grounding/` ; items `MX8DY0`/`PP7X37`/`8T8PZ9` ; préco #1 |
| **D2** | **Mapper PG pull** — le rapprochement lit le PG (~7 villes pullées), plafonné par le PG pas par geo (déjà 29/30 en live) | jobs `populate-geo` prêts | puller les 29/30 focus en PG |
| **D3** | **Scale sans OOM** (≈ le « P5-P9 optim mémoire » du brief) | crashloop radar-api **corrigé** (étude B : `/livez` découplé, heap cap 512, pg timeout, image `:latest`, 768Mi) ; scale 1106 non fait | charte WP5 « 1106 villes sans OOM » via S3-first + SCW Serverless Jobs |
| **D4** | **Coûts (R6)** — coût siège/démo vs coût complet industrialisé 1104 | **structure + placeholders posés, chiffres en attente** | h2a → agent-stats (tokens immo), poc-k8s (infra), geo (coût geo/geo-quebec) |
| **D5** | **geo — TOD** (PMAD/CMM) | [en attente], filtre UI câblé | incrément demandé au fournisseur geo (4 villes réf.) |
| **D6** | **geo — normes/grilles** exposées API (déclencheur « 4+ fondé grille ») | pilote Salaberry 97,9 % ; alignement 4 villes en cours | reglements-urbanisme-parser + exposition API geo |
| **D7** | **geo — mapping rues/adresse/zone** — couche « encore faible, principal levier de précision restant » | non fait | adresses Québec (geo) + jointure temporelle (immo) |
| **D8** | **Canonisation zonage** (#92) — ~506 collections (~200 fragments) → 1/ville | non fait | prérequis à tout comptage stable |
| **D9** | **Données nominatives** (Loi 25) | [en attente], décision 27 juin → geo accès contrôlé (non implémenté) | fichier client + gouvernance dédiée |
| **D10** | **CronJobs refresh suspendus** (FinOps) — `radar-refresh-scrape` + `radar-refresh-projection` | `suspend:true` ; `ttlSecondsAfterFinished` ajouté | réactivation = `suspend:false` après fix cause racine (secret/schéma) |
| **D11** | **Persistance du consentement IdP** (auth durable) | 15 j sliding livré ; consentement non persisté | dépendance repo `sentropic` |
| **D12** | **Zero-copy geo** — pull PG transitoire, géométries dépréciées | design posé (`cadrage-zerocopy-geo`) | migration `GEO_BACKEND=pg→duckdb`, GeoParquet+PMTiles |
| **D13** | **Convergence mapper vers arêtes v2.3** — l'implémentation lit encore des props plates (zone grise v2.2/v2.3) | à trancher | arêtes canoniques `TARGETS_ZONE` (v2.3) |
| **D14** | **Header DS G2** — `AppHeader` en place mais conflit `navAlign="center"` ↔ ancrage dropdown Admin ; toggles thème/langue maison KO | G2 bloquant | `ds-appheader-conformite-2026-06-28.md`, scénario A |
| **D15** | **Écriture marques/notes lot (CS-L3)** — branche « prospect marks-write » **abandonnée** au merge (réécriture incompatible `prospect-marks-client.ts`) | à réconcilier hors merge mécanique | `merge-progress.md` (branche `d10f138`), harness test/verify |

**Grande décision ouverte transverse** : bâtir sur la **Strate B** (état réel) et reléguer la **Strate A**
(modèle relationnel/bitemporel 10 nœuds, `SPEC_ONTOLOGY`/`SPEC_DESIGN`) au rang de **vision cible datée
et non implémentée** — en **retirant** les recommandations « legacy OBSOLÈTE » (props plates canoniques,
extraction v2.2 à 70-85 % infirmée par la mesure #74).

### 6.5 État par WP (mesuré, `wp6-rollup.md`/`wp6-socle-status.md`, 28 juin — 111 items, ~62 % done)

| WP | %done | Saillant restant |
|---|---:|---|
| WP1 DATA | **83 %** | trou zonage (résorbé depuis, 29/30) ; easy-first + agents remote |
| WP2 EXTRACTION | **63 %** | parsing sémantique, grounding exhaustif, reliquats v2.2 |
| WP3 RÉCONCILIATION | **12 %** | **le moins avancé** — cohérence 33 opportunités, scoring lots data-driven, ownership preuve PDF geo |
| WP4 PRODUIT | **62 %** | DS AppShell/rails, selection buckets, carte Opportunités réelle, CS-L3/L4/L5/L6 |
| WP5 PLATEFORME | **57 %** | MCP (livré depuis), scale serverless, consentement IdP |
| WP6 GOUVERNANCE | **75 %** | recalage Track |

---

## 7. Feuille de route (priorisée)

Ordre héritant du rapport phare (§Conclusion) + arbitrages de consolidation :

1. **Prioriser le focus 30 (couverture → profondeur).** Zonage/lots geo à **29/30 & 30/30** en live :
   les **puller en PG**, puis remonter la **consistance signal↔zone** (le vrai goulot ; plafond immo
   ~57 %, le reste est chez geo/graphify). *[D2, WP3]*
2. **Passe de cleansing grounding → 100 %** de signaux à citation vérifiable sur le focus (56/70
   aujourd'hui) ; généraliser le pipeline Mont-Tremblant. *[D1, WP2]*
3. **Généraliser les grilles de normes** : aligner les 4 villes de référence sur le pilote Salaberry
   (97,9 %) et **exposer les normes dans l'API geo** → « 4+ fondé grille ». *[D6, WP3]*
4. **Stabiliser les jobs récurrents** (corriger puis réactiver les refresh) et **canoniser les
   collections zonage** (une/ville, #92). *[D8, D10, WP1]*
5. **Intégrer les acquisitions en attente** : aires **TOD** (geo) et **données nominatives** (fichier
   client + gouvernance Loi 25). *[D5, D9]*
6. **Finaliser les vues lots/opportunités** (carte **Opportunités réelle**, écriture des marques CS-L3)
   et **publier un tableau de bord de couverture** distinguant effectif/projeté. *[D15, WP4]*
7. **Chantiers d'architecture de fond** (moyen terme) : **zero-copy geo** (DuckDB/PMTiles, D12),
   **scale serverless 1106 sans OOM** (D3), **convergence mapper→arêtes v2.3** (D13). *[WP5]*
8. **Consolider le volet coûts (R6)** dès réception des chiffres agent-stats/poc-k8s/geo, puis
   re-présenter le rapport d'étude (bloqué tant que « 1 — Faisabilité data » n'est pas consolidée +
   `slides.html` resynchronisé). *[D4]*

Le potentiel 1104 est **atteignable par itérations**, en séparant clairement **effectif** et
**projeté**. La valeur du socle tient autant à ce qu'il produit qu'à sa **discipline de vérité** :
gates déterministes, citations obligatoires, mesures reproductibles, limites documentées.

---

## Annexe A — Registre des sources consolidées

**Autoritaire (état réel — Strate B) :**
- `docs/spec/reports/study-2026-07/report.md` — rapport phare, base de tous les chiffres (2 juil).
- `SPEC_INTENT_GRAPHIFY_V23_EVIDENCE.md` — contrat v2.3 (evidence + arêtes canoniques).
- `grounding-pilot-mont-tremblant.md` — pipeline + état grounding.
- `cadrage-zones-lots-acquisition.md`, `cadrage-extraction-zones-pdf.md` — méthodes d'acquisition geo.
- `cadrage-geo-integration-mapper.md` + `wp3-mapper-recall-2026-06-28.md` — mapper #74 (design + mesure).
- `data-division-immo-geo.md` + `decision-proprietaires-lots-geo-loi25.md` (27 juin) — split immo/geo + Loi 25.
- `SPEC_EVOL_SOURCE_VIEW.md` (D1-D7), `SPEC_EVOL_INTEGRATION_CARTE_USER_REVIEW.md`,
  `SPEC_CONTROLE_PARITE_VILLES_USER_REVIEW.md` — vues produit + parité.
- `SPEC_PERSISTENCE_S3_FIRST.md` — persistance. `mcp/*` — connecteur MCP.
- `SPEC_INTENT_GEO_NAVIGATION_SELECTION.md`, `SPEC_INTENT_REDESIGN_SELECTION_BUCKETS.md` — navigation/UX.
- Rapports WP : `wp1-data-state.md`, `wp3-33-anomalies.md`, `wp4-produit-coverage.md`, `wp5-plateforme.md`,
  `wp6-focus-rollup.md`/`wp6-rollup.md`/`wp6-socle-status.md`, `2.3-completude-1105*.md`.
- Non commités (worktree principal, cités mais hors origin/main) : `2.3-finition-progress.md`,
  `merge-progress.md`.

**Cible / vision (Strate A — non implémentée, à dater et marquer) :**
- `SPEC_ONTOLOGY_DATA_MODEL.md`, `SPEC_DESIGN_DATA_MODEL.md`, `SPEC_EVOL_DATA_MODEL.md`,
  `SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md` — modèle relationnel/bitemporel, profil 10 nœuds.
- `cadrage-zerocopy-geo.md` — architecture geo cible (zero-copy DuckDB/PMTiles).
- `SPEC_EVOL_OPERATING_MODEL.md` — multi-tenant B2B (hors V1).

**Périmé (à ne pas suivre) :**
- `extraction-zone-lot-delegation.md` — v2.2 props plates canoniques (renversé par v2.3, « legacy OBSOLÈTE »).
- `SPEC_STUDY_SOURCE_VIEW.md` — prédécesseur de l'EVOL Sources (5ᵉ vue / job batch / score-couleur, tous renversés).
- `SPEC_EVOL_T3_T4_CONSOLES.md` — consoles démo-era superséde par le modèle 4-vues.
- Briefs démo in-memory `SPEC_EVOL_RADAR_T1.md`, `SPEC_EVOL_OPPORTUNITES_T2.md` — concepts survivants,
  scaffolding démo superséde (score /100 **banni**).
- Audit S3 « 145/1104 v2.3 » (18 juin) ; colonne zones de `wp1-atome-par-ville-full.tsv` (sweep buggé).

## Annexe B — Registre des contradictions & incohérences relevées

| Réf | Contradiction | Arbitrage consolidé |
|---|---|---|
| **B-1** | v2.2 props plates canoniques ↔ v2.3 arêtes canoniques (`extraction-zone-lot-delegation` « legacy OBSOLÈTE ») | Arête canonique (v2.3) ; props = commodités dérivées (D13) |
| **B-2** | MCP « jamais réalisé/BLOQUÉ » (28 juin) ↔ « en production » (2 juil) | Construit entre les deux ; état = en production (10 outils) |
| **B-3** | Issuer MCP `idp.sent-tech.ca` (doc déploiement) ↔ `auth.sent-tech.ca` (code/ConfigMap, commit 63c7552) | `auth.sent-tech.ca` fait foi ; doc déploiement périmé |
| **B-4** | Pull OGC→PostGIS ↔ zero-copy DuckDB/PMTiles (`cadrage-zerocopy-geo`) | Pull PG transitoire ; zero-copy = cible (flag `GEO_BACKEND`, D12) |
| **B-5** | immo owne cadastre/rôle/adresses (Strate A) ↔ geo owne, adapters immo supprimés PR #239 (`data-division`) | geo owne l'acquisition ; immo consomme |
| **B-6** | Périmètre PDF-only ~600-800 (`cadrage-zones-lots`) ↔ ~27 (`cadrage-extraction-zones-pdf`) | 27 = sous-ensemble résiduel prioritaire ; à réconcilier |
| **B-7** | Propriétaire « hors modèle » (Strate A) ↔ geo accès contrôlé (décision 27 juin) | Décision 27 juin fait foi (geo, Loi 25, D9) |
| **B-8** | STUDY Sources (5ᵉ vue/batch/score-couleur) ↔ EVOL Sources (EVOL/set-based/pire-statut) | EVOL fait foi ; STUDY périmé |
| **B-9** | Tri-état : code `fresh\|partial\|stale\|unknown` ↔ spec `vérifié live/déclaré non substantié/absent` ↔ client `Servi/Partiel/Non couvert` | Mapping à formaliser (§4.5) |
| **B-10** | Auth session 8 h non faite (`wp5-plateforme`) ↔ 15 j sliding livré (commit 02c52eb) | 15 j livré ; rapport WP périmé sur ce point |
| **B-11** | Reparent Track échoue (containment 0.19.2) ; `track report` 0/29 ↔ 62 % done réel | Projection ratifiée `wp6-item-wp-map.json` ; verbe CLI manquant |

**Incohérences de chiffres à harmoniser** (détail Annexe C) :
- **C-1** dénominateur **1104** (immo) vs **1106** (geo) dans le rapport.
- **C-2** v2.3 **976 vs 977 vs 978** (fourchette assumée ~88 %).
- **C-3** grounding focus **56/70** (unité « signaux ») vs **188/250** (unité Signal+DE).
- **C-4** « **33** » = cohorte cible, audit réel = **27 signaux / 28 anomalies**.
- **C-5** produit **2/5/10** (28 juin) → **3/5/9** (2 juil) — progression datée.
- **C-6** tests : **669+1+10+10=690 ≠ 680** annoncé (probable double-compte todo/skip).
- **C-7** Salaberry zonage **645 zones** (report) vs **640 servi** (wp3-mapper).
- **C-8** « **1102 lots** » = en fait **~1102 villes** servies en lots.

## Annexe C — Table des chiffres mesurés (définitions, sources, dates)

| Indicateur | Valeur | Définition (num/dénom) | Source | Date/statut |
|---|---:|---|---|---|
| Référentiel QC | **1106** | `municipalities.qc.json` (test `toHaveLength(1106)`) | `wp1-data-state.md` | fixe |
| Cible éligible | **1104** | 1106 − 2 exclues (Montréal, Laval) | `wp1-data-state.md §0` | fixe |
| Focus | **30** | `priorityRank` 1→30 | idem | fixe |
| PV bruts | **~3272** docs ; **27/30** ; **~1007/1104** | documents scrapés archivés S3 ; villes avec substrat | `report.md §1.1` | [LIVE] 2 juil |
| Signaux v2.3 | **25/30** ; **978/1104** (~976-978) | villes avec graphe `ontology_version==2.3` | `report.md §1.2` | [LIVE] 2 juil |
| Grounding focus | **56/70** (cible 100 %) | signaux à citation vérifiable | `report.md §1.2` | [LIVE] 2 juil |
| Zonage servi | **29/30** ; **568/1106** | collections `qc-zonage-<slug>` joignables | `report.md §1.3` | [LIVE] 2 juil |
| Salaberry zonage | **645 zones ; 96,3 % ; 0 trou** | vs règlement officiel | `report.md` annexe | [LIVE] pilote |
| Grilles Salaberry | **97,9 % des 15 510 lots** | lots portant hauteur/marges/densité | `report.md §1.4` | [LIVE] pilote |
| Lots servis | **30/30** ; **~1102/1106 villes** | collections `qc-lots-<slug>` | `report.md §1.5` | [LIVE] 2 juil |
| Dérivation 4+ | **97,5 % sur 3171 lots** | exactitude vs application de référence | `report.md §2.D` | [LIVE] 2 juil |
| Signaux désignant zone | **14/30** | villes focus dont ≥1 signal cite une zone | `report.md §1.7` | [LIVE] 2 juil |
| Mapper recall | **47,3 % → 57,3 % → 59,2 %** (52/110, 63/110, 71/120) | live → fix immo → immo+geo, 55 villes | `wp3-mapper-recall` | [LIVE] 28-29 juin |
| Causes non-match | gap-data **63,8 %** · champ-non-lu **19 %** · écart-schéma **17,2 %** · zéro-tête **0 %** | 58 codes non appariés | idem | [LIVE] 28 juin |
| Plafond mapper immo | **~57-59 %** | ~81 % des non-matchs hors application | idem | [LIVE] |
| Audit 33 | **10 villes / 27 signaux / 28 anomalies** | DATA 54 % · ALGO 21 % · mixte 25 % | `wp3-33-anomalies.md` | [LIVE] |
| Niveaux preuve | L1 **70,4 %** · L2 **18,5 %** · L3 non recensé | signal×PDF / ×zone / ×zone×grille×lot | `wp6-focus-rollup.md` | [LIVE] |
| Tests UI | **680** (669 pass, 1 fail, 10 todo, 10 skip) ; lots **86/86** | vitest ; 1 rouge anti-PII | `wp4-produit-coverage §3` | [LIVE] 28 juin |
| Features produit | **3 livré / 5 partiel / 9 absent** (17) | vs référentiel partenaire | `report.md §2.C` | [LIVE] 2 juil |
| WP done | **~62 %** (68-70/111) | items Track signés | `wp6-rollup.md` | [mesuré] 28 juin |

---

*Fin de la spec consolidée. Contradictions et incohérences non tranchées listées en Annexes B et C ;
elles constituent la file d'arbitrage à instruire avant la prochaine présentation client (R8).*

## Annexe D — Réconciliation codex 5.5 (double consensus) : garde-fous de consolidation

Le volet Codex 5.5 (analyse indépendante) confirme la structure (Strate B autoritaire vs Strate A cible vs périmés) et ajoute **7 risques de consolidation** — à garder en tête par tout lecteur/éditeur de cette spec. La plupart sont déjà tranchés en Annexes B/C ; référencés ici comme garde-fous explicites.

1. **Dénominateurs à ne pas mélanger** : 1106 (total geo) · 1104 (cible éligible immo, hors MTL/Laval) · 1105 (ancien label) · focus 30. Un même indicateur a plusieurs bases — jamais additionner (cf. Annexe C).
2. **Couverture geo LIVE ≠ projection PG du mapper/vue Source.** geo sert 568/1106 zonage & ~1102/1106 lots *en direct* ; le mapper #74 et la vue Source lisent le **PG projeté** (pull en retard, ~7 villes). Ne pas présenter la couverture live comme si la consistance E2E l'avait.
3. **Ne pas survendre v2.3** : 978/1104 = couverture de **format graphe**, PAS 100 % de citations groundées. Le grounding (56/70 focus) reste une dette (passe de cleansing).
4. **MCP** : « en production » est vrai (déployé via `k8s-apply-mcp` + confirmé live), MAIS `40/41` ne sont **pas dans `kustomization.yaml`** (appliqués hors kustomize) — la source de vérité du déploiement n'est pas `origin/main` kustomize. À réconcilier.
5. **Zero-copy / PMTiles = architecture CIBLE**, pas courante (le courant est pull PG + passthrough OGC).
6. **Évaluation n'a PAS la pleine parité Signaux** : rendu **SVG**, `limit: 200`, non migré MapLibre ; la parité data-driven (fond gris, colorisation, filtres, tous les lots) vit dans **Signaux**. (Note : Évaluation est en cours de **masquage nav** — beta Ctrl+Shift+X, cf. C13.)
7. **Défaut spec corrigé** : le rapport `docs/spec/reports/radar-api-memory-study-2026-07-02.md` (étude crashloop, référencé par le code/les manifests) était **absent de `origin/main`** — **inclus dans ce commit**.

**Risque n°1 relevé par Codex** : sur l'étude crashloop, ne pas geler la lecture à #322 (pansement) — #325-#327 l'ont **supersédé** (probes découplées `/livez` + heap cap 512 + pg timeout + image `:latest`), radar-api stable 1/1 0 restart. Et P1-P3 **stabilisent le boot** ; ils ne prouvent PAS que le régime mémoire (cache fixtures, imports graphify, pruning image, worker séparé = P5-P9) est réglé.
