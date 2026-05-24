# SPEC_EVOL — SCAFFOLDING `radar-immobilier`

> **Statut** : EVOL (design validé issu du brainstorming 2026-05-23, vivant jusqu'à la fin du scaffolding)
> **Prédécesseur** : `SPEC_INTENT_SCAFFOLDING.md`
> **Successeur** : `SPEC_SCAFFOLDING.md` (sera produit à la clôture de BR-12)
> **Date initiale** : 2026-05-23
> **Auteur** : rhanka <fabien.antoine@m4x.org>

## Status updates

- **2026-05-23** : design validé après brainstorming (Sections 1–16).
- **2026-05-24** : BR-00 `chore/scaffolding-base` merged (PR #1, merge commit `f139ee8`). BR-01 actif pour formaliser cette spec dans une vraie branche docs et reformater le plan archivé de BR-00.

## 1. Objectif

Poser la structure complète du projet `radar-immobilier` (code, infra, specs, plan d'exécution, règles dev multi-agent) en réutilisant au maximum l'écosystème `@sentropic/*`, `graphifyy`, `obscura` et les conventions de `../sentropic/`. La sortie attendue est un repo opérationnel sur lequel un agent (Claude / Codex / Gemini CLI) ou un humain peut démarrer immédiatement une branche feature.

Le scaffolding est lui-même découpé en branches (BR-00 à BR-09) qui livrent progressivement, jusqu'à une démo Phase 1 servant de support à la **proposition commerciale et au chiffrage** client.

## 2. Vision produit (rappel court)

Cf. `docs/spec/input/VISION.md` et `docs/spec/input/PROCESS.md`. Le radar surveille les documents municipaux (avis publics, PV, vidéos YouTube, règlements, plans de zonage, CPTAQ, etc.) pour détecter les opportunités de densification résidentielle. Pipeline :

```
Signal réglementaire → Ancrage foncier → Contraintes → Marché → Contexte stratégique → Scoring
```

**Ville pilote** : Salaberry-de-Valleyfield.

## 3. Périmètre de la démo Phase 1

### 3.1 Vertical slice end-to-end (réel)
- **Source unique** : avis publics municipaux de Salaberry-de-Valleyfield.
- **Pipeline complet** : scrape (Playwright + Obscura) → ingest → extraction LLM (`@sentropic/llm-mesh`) → liaison docs (`graphifyy`) → scoring (PROCESS §3) → fiche d'opportunité (PROCESS §4) persistée en Postgres → exposition API → chat UI Svelte streamée.

### 3.2 Spikes d'investigation (toutes les autres sources)
- Une investigation courte (~1 page) par source listée dans VISION §4 et PROCESS Annexe B.
- Sortie : `docs/spec/SPEC_EVOL_SOURCE_FEASIBILITY.md` consolidant pour chaque source : URL, format, accès, complexité technique, niveau d'automatisation, recommandation, **estimation effort en jours-homme**.

### 3.3 Livrable chiffrage
- `docs/spec/SPEC_EVOL_PRICING_PHASE1.md` consolide les spikes + démo polie + roadmap Phase 1 complète + estimation totale.

## 4. Architecture cible

```
┌─────────────────────────┐         ┌────────────────────────────────────┐
│  SPA Svelte (gh.pages)  │ ──SSE──▶│   API TS Node Hono (K8s tenant)    │
│  - DS Sentropic (3 pkg) │         │   - chat-core orchestration        │
│  - chat-ui (panel,...)  │         │   - llm-mesh (multi providers)     │
│  - imeccable (skills DS)│         │   - graphifyy (graph docs)         │
└─────────────────────────┘         │   - radar-domain/sources/scoring   │
                                    └───────┬─────────────┬──────────────┘
                                            │             │
                                            ▼             ▼
                              ┌──────────────────┐  ┌─────────────────────┐
                              │ Postgres 16      │  │ Obscura sidecar     │
                              │ + Drizzle migr.  │  │ (Rust headless,     │
                              │ (+ PostGIS phase2│  │  CDP, anti-detect)  │
                              └──────────────────┘  └─────────────────────┘
```

## 5. Structure du repo (au root, sans préfixe)

```
./
  api/                            # server Hono TS Node 24
    src/
      app.ts, index.ts
      routes/                     # endpoints HTTP/SSE
      services/                   # orchestration (pipeline radar)
      db/                         # client Postgres + Drizzle
      domain/                     # adaptateurs vers packages/radar-domain
      sources/                    # adaptateurs source-spécifiques (slice)
    drizzle/                      # migrations SQL
    tests/                        # vitest unitaires + intégration
    Dockerfile, tsconfig.json, package.json

  ui/                             # SPA Svelte 5 + Vite + Tailwind
    src/
      app.html, app.css
      routes/                     # SvelteKit static mode OU SPA Svelte pur (à trancher BR-03)
      lib/                        # composants applicatifs radar
      components/
    static/, vite.config.ts, svelte.config.js
    package.json, Dockerfile.dev

  packages/
    radar-domain/                 # types métier neutres
      src/{Signal,Lot,Opportunity,Score,Constraint,SourceDocument}.ts
    radar-sources/                # interface SourceAdapter + implémentations
      src/sources/
        avis-publics-valleyfield/ # impl complète (vertical slice)
        _spikes/                  # spikes des autres sources (chiffrage)
      src/SourceAdapter.ts        # interface commune
    radar-scoring/                # règles de scoring PROCESS §3
      src/{weights,scorer,evidence}.ts
    radar-graph/                  # wrapper graphifyy spécifique radar
      src/index.ts
    radar-ui/                     # composants Svelte radar-spécifiques
      src/components/FicheOpportunite.svelte
      src/components/ScoreBadge.svelte
      src/components/SignalCard.svelte

  e2e/                            # Playwright (tests end-to-end)
    tests/, playwright.config.ts, Dockerfile, package.json

  rules/                          # MASTER.md + sous-règles (multi-agent, neutre)
    MASTER.md
    workflow.md, conductor.md, subagents.md, testing.md, security.md
    sources.md                    # règles spécifiques scraping/sources
    scoring.md                    # règles spécifiques scoring

  .claude/skills/                 # skills Claude Code
    branch-init/, branch-close/, scope-check/, lot-gate/,
    source-spike/, ingest-test/   # skills radar custom

  .gemini/                        # config Gemini CLI (si nécessaire)
  .codex/                         # config Codex CLI (si nécessaire)

  plan/                           # NN-BRANCH_<slug>.md (template strict)
    BRANCH_TEMPLATE.md
    00-BRANCH_chore-scaffolding-base.md
    01-BRANCH_feat-spec-evol-scaffolding-design.md
    ...
    done/                         # archives des branches mergées

  docs/
    spec/
      input/                      # VISION, PROMPT, PROCESS (déjà là)
      SPEC_INTENT_*.md            # demandes initiales
      SPEC_EVOL_*.md              # docs vivants pendant dev
      SPEC_*.md                   # finalisés

  .github/workflows/              # CI/CD (typecheck, test, build, deploy-gh-pages, deploy-k8s)

  PLAN.md                         # roadmap orchestrée
  Makefile                        # cibles make-only
  docker-compose.yml              # base : api + postgres + obscura
  docker-compose.dev.yml          # surcharge dev (ui-dev, hot reload)
  docker-compose.test.yml         # surcharge test (DB éphémère)
  docker-compose.e2e.yml          # surcharge e2e
  CLAUDE.md                       # pointer vers rules/MASTER.md (Claude Code)
  AGENTS.md                       # pointer vers rules/MASTER.md (Codex + générique)
  GEMINI.md                       # pointer vers rules/MASTER.md (Gemini CLI)
  package.json                    # workspace npm
  package-lock.json
  README.md
  LICENSE
```

## 6. Stack technique

### 6.1 API
| Composant | Choix | Version cible |
|-----------|-------|---------------|
| Runtime | Node | 24 (alignement sentropic) |
| Framework HTTP | **Hono** | ^4.x |
| ORM | Drizzle | ^0.x (dernière) |
| DB driver | `pg` (node-postgres) | ^8.x |
| LLM | `@sentropic/llm-mesh` | ^0.1.0 |
| Chat orchestration | `@sentropic/chat-core` | ^0.1.0 |
| Contracts | `@sentropic/contracts`, `@sentropic/events` | ^0.1.0 |
| Graph | `graphifyy` | ^0.9.1 |
| Headless browser client | `playwright` | ^1.x |
| Headless browser engine | `obscura` (binaire Rust en sidecar) | dernière |
| Object storage | `@aws-sdk/client-s3` (compat S3) | ^3.x |
| Validation jsonb | `zod` | ^3.x |
| Auth | `@simplewebauthn/server` + magic-link maison (pattern sentropic) | dernières |
| Logger | `pino` | ^9.x |
| Tests | `vitest` | ^1.x |
| Observabilité | OpenTelemetry SDK | dernière (compat sentropic) |

### 6.2 UI
| Composant | Choix | Version cible |
|-----------|-------|---------------|
| Framework | Svelte | 5 |
| Build | Vite | ^5.x |
| Styles | Tailwind | ^3.x |
| Design system | `@sentropic/design-system-svelte` + `-themes` + `-tokens` | ^0.7.0 |
| Chat UI | `@sentropic/chat-ui` | ^0.1.0 |
| Icons | `@lucide/svelte` | ^0.562.0 (peerDep chat-ui) |
| Markdown stream | `svelte-streamdown` | ^3.0.1 (peerDep chat-ui) |
| Carte | `maplibre-gl` | ^4.x |
| Auth client | `@simplewebauthn/browser` | dernière |
| Tests | `vitest`, Playwright | dernières |

### 6.3 Skills agents (multi-agent)
| Skill pack | Rôle |
|------------|------|
| `superpowers` (plugin Claude Code) | Méta-skills (brainstorming, writing-plans, TDD, verification) |
| `impeccable` (npm v2.1.9) | Design skills, anti-pattern detection pour agents de code |
| `graphifyy` (npm v0.9.1) | Skill multi-agent (Claude/Codex/Gemini/Kimi/Copilot/Aider) — knowledge graph |

### 6.4 Conventions multi-agent
- **`rules/MASTER.md`** : source unique, **neutre** (terminologie "l'agent", jamais "Claude").
- **`CLAUDE.md`** : `@rules/MASTER.md` + spécificités Claude Code (skills `.claude/skills/`).
- **`AGENTS.md`** : `@rules/MASTER.md` + ordre de lecture canonique (convention partagée Codex et autres).
- **`GEMINI.md`** : `@rules/MASTER.md` + spécificités Gemini CLI.
- Tout nouveau pattern doit être testé sur au moins 2 agents avant d'entrer dans les rules.

## 7. Stockage des données — approche pragmatique

### 7.1 Principe

On sépare **3 couches de stockage** pour éviter les migrations lourdes inutiles tant que la réalité des données n'est pas comprise :

1. **Objet brut → Scaleway Object Storage (S3)**
   Tous les documents bruts collectés (HTML, PDF, transcripts vidéo, JSON d'API, captures) sont stockés tels quels dans un bucket S3 dédié. Postgres ne stocke **jamais** le contenu brut.

2. **Métadonnées & entités structurées → Postgres**
   Tables strictes pour ce qui est **stable et requêté** : sources surveillées, ingestions, références aux objets S3, signaux scorés, opportunités, scores.

3. **Champs encore mal définis → colonnes `jsonb` Postgres**
   Tant que la cardinalité et la structure d'un champ n'est pas figée par la confrontation au réel (zonage extrait, géométrie, attributs propriétaire, etc.), on stocke en `jsonb` validé par un Zod schema versionné. Migration vers colonnes typées **uniquement** quand un pattern stable émerge.

### 7.2 Bucket S3 (Scaleway Object Storage)

- Projet : `PoCs` (ID `09ac728a-e3b9-4a5b-9749-664b0f147c70`).
- Bucket : `radar-immobilier-raw` (région `fr-par`).
- Préfixage : `raw/<source>/<YYYY>/<MM>/<DD>/<sha256>.<ext>`.
- Access : IAM application credentials (scope bucket-only) injectées dans l'API K8s via Secret.
- Création via `scw object bucket create` en BR-04.

### 7.3 Schéma Postgres minimal initial (BR-02)

```sql
-- Sources surveillées
sources (
  id, kind, city, url, config jsonb, enabled, created_at
)

-- Exécutions de collecte
ingestions (
  id, source_id, started_at, finished_at, status, stats jsonb, error jsonb
)

-- Référence vers objet S3 + extraits LLM stockés en jsonb tant que pas figé
documents (
  id, ingestion_id, s3_key, content_type, fetched_at, sha256,
  source_url, extracted jsonb, extracted_at
)

-- Signaux détectés (peu de colonnes, beaucoup en jsonb au début)
signals (
  id, document_id, kind, detected_at, summary,
  payload jsonb,         -- extraits structurés (zonage, densité, dates, refs règlement)
  confidence numeric
)

-- Opportunités scorées (fiche PROCESS §4)
opportunities (
  id, signal_id, title, status,
  fiche jsonb,           -- contenu complet selon modèle PROCESS §4
  created_at, updated_at
)

-- Détail scoring auditable
scores (
  id, opportunity_id, criterion, weight, value,
  evidence jsonb,        -- {source_doc, page, excerpt, ...}
  computed_at
)

-- Liens entre entités (graphifyy)
links (
  id, from_kind, from_id, to_kind, to_id, rel, payload jsonb
)
```

### 7.4 Schémas Zod versionnés

`packages/radar-domain/src/schemas/` héberge les Zod schemas pour valider tout `jsonb` à l'écriture comme à la lecture :
- `signal-payload.v1.ts`, `opportunity-fiche.v1.ts`, `extracted-doc.v1.ts`, etc.
- Évolutions = nouvelle version (`v2.ts`) + adapter, pas de migration SQL tant que possible.

### 7.5 PostGIS

Activé dès BR-04 (Phase 1 inclut la **carte interactive** — cf. §15). Géométries (lots, zones) stockées en `geometry(...)` ; les attributs métier autour restent en `jsonb` au démarrage.

### 7.6 Investigation amont (BR-06)

Une branche dédiée explore la **réalité des données réglementaires vs locales** avant de figer un modèle plus strict — cf. §10.

## 8. Pipeline radar (modélisation)

Modélisation **simple à BR-07** (services orchestrés dans `api/src/services/`) :

```
WatcherJob.run() (cron-like)
  └── for source in subscribed_sources:
        ├── SourceAdapter.fetch() ──▶ S3 (raw object) + ingestions + documents
        ├── Extractor.extract(doc, mesh) ──▶ documents.extracted (jsonb)
        ├── SignalDetector.detect(extract) ──▶ signals (payload jsonb)
        ├── Linker.link(signal, doc) ──▶ links (graphifyy)
        ├── LotAnchor.anchor(signal) ──▶ lots intersectés (PostGIS)
        ├── Scorer.score(opportunity) ──▶ scores + evidence jsonb
        └── OpportunityWriter.persist() ──▶ opportunities.fiche (jsonb)
```

À refactorer vers `@sentropic/flow` (workflow runtime) si publié à temps — sinon implémentation maison portée plus tard.

## 9. Déploiement

### 9.1 Frontend
- Build statique Svelte → push sur branche `gh-pages` via `.github/workflows/deploy-gh-pages.yml`.
- `VITE_API_BASE_URL` pointe vers l'API K8s (env `prod` ou `demo`).

### 9.2 Backend (K8s tenant)
- Dossier `../poc-k8s/tenants/radar-immobilier/` créé selon le contrat sentropic (`Namespace` + `ResourceQuota` + `LimitRange` + `NetworkPolicy` + `ServiceAccount`).
- Workloads :
  - `Deployment api` (Hono server)
  - `StatefulSet postgres` (PostGIS activé, PVC ~5 Gi pour la démo)
  - `Deployment obscura` (sidecar headless browser ; isolé pour pouvoir scaler)
  - `Deployment maildev` (réception emails pour magic-link / dev — réplique du pattern sentropic)
  - `Ingress` + cert-manager pour HTTPS
- **Domaine cible (transitoire avant transfert)** : `immo.sent-tech.ca` (réutilisation du wildcard `*.sent-tech.ca` actif sur le cluster POC).
- CORS autorisé pour l'URL GitHub Pages (la SPA) et `immo.sent-tech.ca`.

### 9.3 Stockage objet (Scaleway Object Storage)
- Bucket : `radar-immobilier-raw`, projet `PoCs` (`09ac728a-e3b9-4a5b-9749-664b0f147c70`), région `fr-par`.
- Création via `scw object bucket create name=radar-immobilier-raw region=fr-par project-id=09ac728a-...` (cible BR-04).
- IAM application credentials dédiées, scope bucket-only, secret K8s `radar-s3-credentials`.

### 9.4 Local
- `make dev ENV=dev` → docker-compose lance api + postgres (PostGIS) + obscura + maildev + ui-dev.
- En local, soit MinIO (S3 compatible) en docker-compose, soit accès direct au bucket Scaleway via credentials dev. **Choix** : MinIO en local (isolation), bucket Scaleway en `demo`/`prod`.
- `make test ENV=test` → tests unitaires.
- `make test-e2e ENV=e2e` → Playwright e2e.

## 10. Découpage en branches

```
BR-00  chore/scaffolding-base
       - Makefile, docker-compose*.yml (api + postgres-postgis + obscura +
         maildev + minio + ui-dev)
       - rules/MASTER.md + sous-règles (neutre multi-agent)
       - CLAUDE.md, AGENTS.md, GEMINI.md (pointers)
       - .claude/skills/ (au moins branch-init, branch-close, scope-check)
       - workspace package.json + lockfile
       - .github/workflows baseline (typecheck, lint, test)
       - README.md, LICENSE
       - PLAN.md, plan/BRANCH_TEMPLATE.md

BR-01  feat/spec-evol-scaffolding-design
       - Ce document (SPEC_EVOL_SCAFFOLDING.md) finalisé
       - SPEC_INTENT_SCAFFOLDING.md déjà posé

BR-02  feat/api-skeleton-hono-postgres-s3
       - Hono + adapter Node
       - Drizzle config + 1ère migration : schéma MINIMAL §7.3
         (sources, ingestions, documents, signals, opportunities,
         scores, links) avec jsonb partout où non figé
       - Client S3 (AWS SDK ou MinIO client) avec abstraction `ObjectStore`
       - Schémas Zod versionnés v1 dans packages/radar-domain/src/schemas/
       - Healthcheck, OpenAPI, tests unitaires

BR-03  feat/ui-skeleton-svelte-ds
       - Svelte 5 + Vite + Tailwind
       - Wire @sentropic/design-system-{svelte,themes,tokens}
       - Wire @sentropic/chat-ui (ChatPanel shell)
       - .github/workflows/deploy-gh-pages.yml

BR-04  feat/k8s-tenant-radar-and-infra
       - ../poc-k8s/tenants/radar-immobilier/{00-namespace,api,
         postgres-postgis,obscura,maildev,ingress}.yaml
       - Création bucket S3 Scaleway `radar-immobilier-raw`
         (`scw object bucket create ...`)
       - Secrets : DB creds, S3 creds, LLM API keys
       - DNS / Ingress sur immo.sent-tech.ca
       - make deploy-k8s ENV=poc

BR-05  feat/source-investigation-spikes
       - Spike pour chaque source VISION/PROCESS (≥16)
       - packages/radar-sources/src/sources/_spikes/<source>/README.md
       - docs/spec/SPEC_EVOL_SOURCE_FEASIBILITY.md (tableau consolidé +
         estimation effort)

BR-06  feat/data-model-investigation                 ◀── NOUVELLE
       - Confrontation avec données réelles : 5-10 documents municipaux
         de Valleyfield + 2-3 d'autres villes pour comparer
       - Distinguer ce qui est UNIVERSEL (règlement, zonage, dérogation,
         PPCMOI, CPTAQ) de ce qui est SPÉCIFIQUE LOCAL (numérotation,
         format avis, conventions linguistiques)
       - Sortie : docs/spec/SPEC_EVOL_DATA_MODEL.md
         - Champs candidats à passer de jsonb vers colonnes typées
         - Champs qui restent en jsonb (gardés flexibles)
         - Versionnement Zod (v2 si nécessaire) + adapter v1→v2
         - Plan de migrations futures

BR-07  feat/vertical-slice-avis-publics
       - SourceAdapter avis-publics Valleyfield (playwright + obscura)
       - Raw write S3 + metadata Postgres
       - Extractor LLM (llm-mesh) avec prompts dérivés de PROMPT.md
       - Scorer (radar-scoring) selon PROCESS §3
       - Endpoint API + tests e2e

BR-08  feat/graphify-radar-integration
       - radar-graph wrapper graphifyy
       - Indexation des documents (S3 + extracts) + signaux + lots
       - Table links peuplée

BR-09  feat/auth-passkey-magic-link                  ◀── NOUVELLE
       - Port du pattern sentropic auth :
         api/src/routes/auth/{login,credentials,magic-link}.ts
         api/src/routes/api/me.ts
         ui/src/lib/services/webauthn-client.ts
         ui/src/routes/auth/{login,register}
       - Maildev intégré pour récupérer magic-link en dev/test
       - Tables : users, credentials (webauthn), magic_link_tokens

BR-10  feat/carte-interactive                        ◀── NOUVELLE (Phase 1)
       - MapLibre GL JS dans la SPA
       - Couches : signaux (heatmap), lots ciblés, contraintes (CPTAQ /
         inondations) via PostGIS server-side
       - Tiles : fond OSM (ou Carto / IGN selon licence) + couches
         vectorielles vector tiles servies par l'API (pg_tileserv-like
         ou implémentation custom légère pour la démo)
       - Lien fiche d'opportunité ↔ carte (clic sur lot)

BR-11  feat/chat-demo-storyboard
       - UI consomme chat-ui ; tools radar :
         lookup_lot, search_signal, score_lot, list_opportunities,
         get_fiche, show_on_map
       - Dataset démo Valleyfield (signaux + opportunités scorées)
       - Script de démo (scénario client de bout en bout)

BR-12  feat/uat-and-pricing-pack
       - docs/spec/SPEC_EVOL_PRICING_PHASE1.md (consolidation spikes +
         roadmap Phase 1 complète + estimation totale)
       - Démo polie, screenshots, capture vidéo
       - docs/spec/SPEC_SCAFFOLDING.md (clôture du scaffolding)
```

**Ordre d'exécution suggéré** :
```
BR-00 → BR-01 → (BR-02 ∥ BR-03 ∥ BR-05) → BR-04 → BR-06 → BR-07
     → (BR-08 ∥ BR-09 ∥ BR-10) → BR-11 → BR-12
```

Parallélisations :
- BR-02 / BR-03 / BR-05 indépendants (code api / code ui / docs+spikes).
- BR-08 / BR-09 / BR-10 indépendants une fois BR-07 fini (graphify / auth / carte).
- BR-06 (investigation data) **doit précéder** BR-07 (slice) pour que le modèle Postgres ne soit pas figé trop tôt.

## 11. Critères de succès

Le scaffolding est **terminé** quand :

1. `make dev ENV=dev` lance toute la stack locale en < 60 s.
2. `make test` passe (suite vide ou minimale acceptée si BR-00 seul).
3. `make typecheck && make lint && make build` verts sur CI GitHub Actions.
4. La SPA déployée sur `gh-pages` est accessible et appelle l'API.
5. L'API déployée sur K8s POC répond `200` sur `/health`.
6. Le tenant K8s respecte le contrat sentropic (quotas, NetworkPolicy default-deny).
7. Un agent (Claude/Codex/Gemini) peut suivre `AGENTS.md` et exécuter un cycle `branch-init → travail → test → lot-gate → branch-close` sans intervention humaine de plomberie.
8. La démo Phase 1 (BR-07 + BR-09 auth + BR-10 carte + BR-11 chat) montre un cas d'opportunité Valleyfield bout en bout avec carte et auth passkey.
9. `SPEC_EVOL_SOURCE_FEASIBILITY.md` couvre **toutes** les sources de VISION/PROCESS Annexe B avec estimation.
10. `SPEC_EVOL_DATA_MODEL.md` (BR-06) consolide la compréhension réglementaire vs locale et justifie le schéma final.
11. `SPEC_EVOL_PRICING_PHASE1.md` propose un chiffrage défendable.
12. Bucket S3 `radar-immobilier-raw` créé et accessible depuis l'API K8s.

## 12. Risques identifiés & mitigations

| Risque | Impact | Mitigation |
|--------|--------|------------|
| `@sentropic/flow` non publié à BR-06 | Pipeline modélisé en services Hono "à la main" ; refactor vers `flow` plus tard. | Acceptable. |
| `@sentropic/chat-core` ou `chat-ui` API change avant intégration | Refactor mineur attendu (versions `^0.1.0`) | Pin sur version exacte au scaffolding, follow-up release sentropic. |
| Obscura nécessite binaire spécifique architecture (ARM vs x86) | Image docker dédiée par archi, ou build multi-arch | À tester en BR-04. |
| Volume Postgres K8s POC saturé (pool 40 GB partagé) | Quota strict sur le tenant (1-2 Gi suffisent démo) | Quota explicite dans `00-namespace.yaml`. |
| Sources municipales rate-limitent / bloquent Obscura | Backoff + anti-detect intégré ; éviter parallélisme agressif | Respecter robots.txt, fenêtres horaires raisonnables. |
| Multi-agent rules dérivent vers Claude-only | Auditer périodiquement les fichiers `rules/` pour terminologie | Skill `scope-check` étendu. |
| S3 credentials Scaleway exposés (par ex. dans logs / commits) | Secret K8s + rotation possible | Scope IAM bucket-only ; pas de credentials en clair dans le repo ; audit des commits avant push. |
| Schéma jsonb dérive en chaos (champs ad-hoc partout) | Discipline Zod : tout `jsonb` validé in/out via un schema versionné dans `radar-domain/schemas/` | Skill `scope-check` vérifie la présence du schema Zod. |
| Domaine `immo.sent-tech.ca` non disponible / wildcard cert manquant | Ingress radar peut atterrir sur sous-domaine alternatif | Vérifier en début BR-04 ; cert-manager déjà en place sur cluster POC. |
| Carte interactive : tuiles externes (OSM/IGN) sujettes à rate-limit | Cache local + provider tiles auto-hébergé si volume | Démo : OSM standard suffisant. |

## 13. Conventions strictes héritées de sentropic

- **Make-only / Docker-first** : aucune commande native sur l'hôte. Toute commande passe par `make`.
- **`ENV=<slug>` dernière position** dans les commandes make ; `ENV=test-*` ou `ENV=e2e-*` pour les campagnes de tests, **jamais `ENV=dev`** pour les tests automatisés.
- **Worktrees** : développement en `tmp/<slug>` isolé, jamais sur la racine du repo.
- **Atomic commits** : ~150 lignes max entre commits ; `git add` sélectif (jamais `-A` ni `.`).
- **`make commit MSG="type: description"`** (single line) — jamais `git commit` direct.
- **No squash merge** : politique stricte, merge commit uniquement, branches préservées post-merge.
- **No legacy fallback** : on supprime le code remplacé, pas de double chemin.
- **Langue** : code/commits/PR/specs en anglais ; échanges utilisateur en français.

## 14. Inputs externes (à conserver tels quels)

- `docs/spec/input/VISION.md` — vision client originale.
- `docs/spec/input/PROMPT.md` — prompt analyste expert (utilisable comme base pour les prompts LLM du radar).
- `docs/spec/input/PROCESS.md` — processus opérationnel détaillé (pipeline 6 étapes, scoring, annexes sources).

Ne jamais modifier ces fichiers : tout enrichissement passe par `SPEC_INTENT_*` puis `SPEC_EVOL_*`.

## 15. Périmètre Phase 1 (démo)

**Inclus dans la démo Phase 1** (toutes les branches BR-00 à BR-12) :
- Vertical slice end-to-end sur **avis publics Salaberry-de-Valleyfield** (BR-07).
- **Carte interactive** (MapLibre, PostGIS) — BR-10.
- **Authentification passkey + magic-link** (réplique du pattern sentropic) — BR-09.
- Maildev pour réception magic-link en démo/dev.
- Investigation systématique de **toutes les autres sources** (spikes BR-05) pour chiffrage.
- Pack chiffrage et démo polie (BR-12).
- Hosting transitoire sur `immo.sent-tech.ca`.

**Hors-périmètre Phase 1 (Phase 2+)** :
- Multi-villes (extension Salaberry → Québec entier).
- Multi-utilisateurs / multi-tenants applicatifs.
- Sources payantes intégrées en prod (JLR, Centris/MLS) — étudiées en spike, non intégrées.
- Vidéos YouTube avec transcription complète — étudiées en spike, prototype possible si coût raisonnable.
- Mémoire long-terme des dossiers (rétroanalyse 2 ans VISION §4.5) — étudiée, démo se contente d'historique court.
- Transfert hors `*.sent-tech.ca` vers le domaine définitif du client.
- Internationalisation (l'UI est en français pour la démo).
- Workflow `@sentropic/flow` côté pipeline (impl simple BR-07, refactor ultérieur si publié).

## 16. Roadmap d'exécution

1. **BR-00 (`chore/scaffolding-base`)** — MERGED 2026-05-24 (PR #1). Makefile, docker-compose, rules, pointers multi-agent, workspace npm, CI baseline, PLAN.md, template branche.
2. **BR-01 (`feat/spec-evol-scaffolding-design`)** — IN PROGRESS. Formalise les specs scaffolding dans une vraie branche docs, reformate le BR-00 archivé au format checkbox-only.
3. **BR-02 → BR-12** — voir §10 pour le découpage détaillé et §11 `PLAN.md` pour le scheduling.
