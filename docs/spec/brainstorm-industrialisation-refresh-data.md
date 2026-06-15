# Brainstorm — Industrialisation de l'orchestration des refresh de données

> **Statut : BRAINSTORM / CADRAGE ARCHITECTURE.** Document d'options — aucune décision
> figée, aucun code. Le principal arbitre. Rédigé pour challenger *et* outiller la
> vision « immo = frontend d'exploitation ; collecte + orchestration = workspace
> "data" dédié dans sentropic, piloté par chat ».
>
> Périmètre : (1) refresh du scope actuel et (2) capacité de **tout reprendre**
> (re-scrape complet + re-graphify complet) de façon pilotable, idempotente et
> répétable.

---

## 0. TL;DR (pour décision rapide)

- **Le pipeline de données est déjà 80 % industrialisable sans rien réécrire.** Le
  recueil (`recueil.ts`) et l'exploitation (`exploit-scrape.ts`) sont **idempotents,
  content-addressed (CAS sha256), HEAD-skip**. La spec `SPEC_PERSISTENCE_S3_FIRST §3`
  décrit déjà un **scheduler = boucle de réconciliation** `travail = désiré − présent`.
  Le manque n'est pas le moteur : c'est **(a)** un déclencheur/superviseur, **(b)** le
  maillon graphify qui dépend d'un compte Claude humain, et **(c)** un bug d'image qui
  casse la projection PG.
- **La seule étape qui *exige* un agent LLM est graphify** (voie « replay par prompt »).
  Scrape, parse, exploit, projection PG sont **déterministes** → cron/job classique. La
  douleur « compte Claude saturable » se concentre donc sur **un seul maillon**, pas sur
  tout le pipeline. C'est le verrou à traiter en priorité.
- **3 bugs/dettes bloquants AVANT toute industrialisation** (cf. §1.4) :
  1. `dist/scripts/project-graph-from-s3.js` **n'est pas dans l'image** (esbuild ne
     bundle que `src/index.ts`) → le job k8s `31-graph-projection-job.yaml` échoue
     `MODULE_NOT_FOUND` à coup sûr. **La projection PG est cassée en prod aujourd'hui.**
  2. Aucun CronJob/Job de **scrape** dans `deploy/k8s/**` : le scrape ne tourne qu'à la
     main via `make worker-live`.
  3. Aucune traçabilité d'exécution graphify (qui a graphifié quoi, quand, avec quelle
     version d'ontologie) hors commits git.
- **Recommandation cap (détail §6) : "Strangler Fig" en 3 vagues.**
  - **Vague A — Réparer + cron-iser le déterministe (immo, ~1 sem)** : fix bundle
    projection, ajouter Job scrape + CronJob refresh + Job projection chaînés, sortir un
    **manifeste d'état** (`runs/.../manifest.jsonl` déjà là → l'agréger). *Aucun agent
    requis.* Le refresh quotidien des nouveaux PV tourne tout seul.
  - **Vague B — Externaliser graphify dans un workspace "data" sentropic, piloté chat**
    : un agent background (RemoteTrigger / `@sentropic/flow`) consomme une **file de
    travail graphify** alimentée par le manifeste de Vague A ; idempotence par
    `(citySlug, rawManifestHash, ontologyVersion)`. Anti-saturation : quotas, backoff,
    multi-provider via `@sentropic/llm-mesh`.
  - **Vague C — immo = frontend pur** : immo ne garde que l'API d'exploitation + l'UI ;
    toute la collecte/orchestration vit dans le workspace data ; frontière = **contrat
    de données sur S3** (le bucket `graph/` + `ontology/` est le seul couplage).
- **Challenge de la vision** : ne PAS bouger la **collecte déterministe** (scrape/parse/
  projection) hors d'immo tout de suite. Elle est déjà du code, déjà testée, déjà
  idempotente — la déménager n'apporte rien et ajoute un contrat réseau. **Seul graphify
  (le maillon agentique) mérite le workspace data en premier.** « Le plus simple
  d'abord » = externaliser *l'orchestration des agents*, pas le code déterministe.

---

## 1. État actuel (factuel, sourcé)

### 1.1 Le pipeline de données end-to-end

```
                  ┌─────────── immo (radar-immobilier) ───────────┐
SCRAPE (RECUEIL)  │  make worker-live → ProcesVerbauxGenericAdapter │
  par ville       │  adapter.list() fenêtre 183 j → fetch() PDF/HTML│
  HEAD-skip CAS   │  recueil.ts → PUT raw/<city>/pv/cas/<sha>.<ext> │
                  │  + manifeste runs/<source>/<runId>/manifest.jsonl
                  ▼                                                 │
PARSE+EXPLOIT     │  exploit-scrape.ts (LIVE_SCRAPE_EXPLOIT=1)      │
  déterministe    │  pdftotext → detectZonageChange()              │
  HEAD-skip       │  PUT parsed/<city>/pv/<sha>/<ver>/{text,extract}│
                  │  runExploitation() → ontology/<city>/project-state.json
                  ▼                                                 │
GRAPHIFY          │  ⚠ AGENT CLAUDE BACKGROUND (h2a manuel)         │
  agentique       │  lit raw/parsed → écrit graph/<city>/latest.json│
  NON idempotent  │  ontology_version, etape/etape_date (v2.1)      │
  par machine     └────────────────────┬───────────────────────────┘
                                        ▼
PROJECTION PG     ┌─ Job k8s 31-graph-projection-job.yaml ─┐
  idempotent      │  ⚠ CASSÉ : dist/scripts/...js absent   │
  upsert ON CONFL │  node project-graph-from-s3.js          │
                  │  lit graph/<city>/latest.json → upsertGraph PG │
                  └────────────────────┬───────────────────┘
                                        ▼
EXPLOITATION      API immo /api/signals, /api/ontology/:city → UI Svelte
```

**Fichiers de référence** (chemins absolus) :
- Scrape : `api/src/scripts/worker-live.ts`, `api/src/services/sources/{recueil,exploit-scrape,live-scrape,run-manifest}.ts`
- Config villes : `packages/radar-sources/src/sources/proces-verbaux-generic.ts` (`ALL_PV_CITIES`, ~549 entrées)
- Projection : `api/src/scripts/project-graph-from-s3.ts` + `deploy/k8s/31-graph-projection-job.yaml`
- Graphify (contrat) : `radar/ontology/graphify-output-contract.md`, `radar/ontology/regraphify-directive.md`, `docs/spec/etape-anticipation-delegation.md`
- Storage/config : `api/src/config.ts` (résolution `S3_*` → `SCRAPE_S3_*` → `GRAPH_S3_*`), `api/src/storage/s3-object-store.ts`

### 1.2 Les buckets S3 (le « contrat de données » de fait)

| Logique | Var env (cascade) | Bucket prod SCW | Préfixes |
| --- | --- | --- | --- |
| Raw / API | `S3_*` | `radar-immobilier-raw` | `ontology/`, divers |
| Scrape | `SCRAPE_S3_*` → `S3_*` | `radar-immobilier-docs` | `raw/<city>/pv/cas/<sha>`, `parsed/…`, `runs/<source>/<runId>/manifest.jsonl` |
| Graph | `GRAPH_S3_*` → `SCRAPE_S3_*` | `radar-immobilier-docs-pocs` | `graph/<city>/latest.json` |

> **Insight clé** : la frontière collecte ↔ exploitation **existe déjà** et c'est
> **S3**. `graph/<city>/latest.json` + `ontology/<city>/project-state.json` sont
> l'interface. Tout le débat « workspace data vs immo frontend » se ramène à : *qui a le
> droit d'écrire `graph/`/`raw/` (le workspace data) et qui ne fait que lire (immo)*.

### 1.3 L'orchestration des agents AUJOURD'HUI (manuelle, h2a textuel)

- **Conductor = humain dans une session Claude** + `rules/conductor.md` + `.agents/lanes`
  (`lane|agent|dir`) + `make conductor-report` (done %, head, sloc, heartbeat).
- Délégation = **brief texte auto-contenu** (`rules/subagents.md`) copié-collé à un
  agent (`claude:immo_subagents`, `claude:immo2_subagents`) via `h2a_offer`. Cf.
  `docs/spec/etape-anticipation-delegation.md` (re-graphify M–Z, champ `etape`).
- **`@sentropic/h2a` 0.8.0 et `@sentropic/flow` 0.1.1 existent** mais l'intégration
  *réelle* est **différée** (V1 = stub découplé, cf. `SPEC_EVOL_H2A_CHAT.md`,
  `UAT_EV2_EV7_ESCALATIONS.md`). **RemoteTrigger n'existe nulle part dans le repo** —
  c'est un pattern-cible sentropic à concevoir, pas un acquis.

### 1.4 Les douleurs (priorisées par sévérité)

| # | Douleur | Sévérité | Cause racine |
| --- | --- | --- | --- |
| **D1** | **Projection PG cassée en prod** | 🔴 Bloquant | `api/Dockerfile` ne bundle que `src/index.ts` (esbuild) et le runtime ne copie que `api/dist` ; `dist/scripts/project-graph-from-s3.js` **n'existe jamais dans l'image** → job k8s `MODULE_NOT_FOUND`. |
| **D2** | **Scrape jamais automatisé** | 🔴 Bloquant | Aucun Job/CronJob scrape dans `deploy/k8s/**`. Tout passe par `make worker-live` sur un poste. → 0 refresh sans humain. |
| **D3** | **Graphify = compte Claude humain partagé** | 🟠 Fort | Le seul maillon agentique dépend d'un compte saturable (limites session ET hebdo). 549 villes × re-graphify = saturation garantie. |
| **D4** | **Orchestration 100 % manuelle (h2a texte)** | 🟠 Fort | Pas de file de travail, pas de déclencheur, pas de reprise auto. Chaque re-dispatch = re-brief entier (perte de contexte). |
| **D5** | **Reprise non industrialisée** | 🟠 Fort | Re-scrape/re-graphify total = action artisanale par tranches alpha (lots A–L / M–Z), gates jq copiés à la main. |
| **D6** | **Observabilité faible** | 🟡 Moyen | `make conductor-report` lit des cases à cocher dans des `.md`. Pas de vue « N villes fraîches / M en retard / K en échec ». |
| **D7** | **Pas de pilotage par chat** | 🟡 Moyen | Impossible de dire « rafraîchis Sherbrooke » ou « re-graphifie tout en v2.2 » depuis un chat. |
| **D8** | **Détection de nouveauté implicite** | 🟢 Faible | Le HEAD-skip CAS *évite* le re-traitement mais rien n'**agrège** « quelles villes ont de NOUVEAUX PV depuis hier » pour déclencher graphify de façon ciblée. |

> **Ordre de bataille imposé par les dépendances** : D1 et D2 d'abord (sinon rien ne
> tourne sans humain), puis D8 (manifeste de nouveauté) qui *alimente* D3/D4 (file
> graphify + agent bg), puis D6/D7 (observabilité + chat) en surcouche.

---

## 2. Architecture cible — workspace « data » + immo frontend

### 2.1 Schéma de partition (qui owne quoi)

```
┌──────────────────────── WORKSPACE "data" (sentropic) ────────────────────────┐
│ Owne : COLLECTE + ORCHESTRATION + GRAPHIFY                                     │
│                                                                               │
│  ┌─ Déterministe (cron/jobs, AUCUN LLM) ─┐   ┌─ Agentique (LLM, piloté chat) ─┐│
│  │ • scrape (recueil CAS)                │   │ • graphify (replay par prompt) ││
│  │ • parse + exploit                     │   │   via RemoteTrigger/@sentropic/ ││
│  │ • projection SCW→PG                    │   │   flow, agents bg, llm-mesh     ││
│  │ • manifeste d'état (désiré−présent)    │──▶│ • file de travail graphify      ││
│  └───────────────────────────────────────┘   └────────────────────────────────┘│
│                              │  écrit                                          │
└──────────────────────────────┼───────────────────────────────────────────────┘
                               ▼
              ╔══════ CONTRAT DE DONNÉES = S3 (frontière dure) ══════╗
              ║  raw/<city>/…   parsed/<city>/…   graph/<city>/latest ║
              ║  ontology/<city>/project-state.json                   ║
              ║  + (option) PG `graph_nodes`/`graph_edges` projeté     ║
              ╚═══════════════════════════════┬═══════════════════════╝
                                              │  lit (read-only)
┌──────────────────────────── immo (radar-immobilier) ─────────────────────────┐
│ Owne : EXPLOITATION uniquement                                                │
│  • API Hono /api/signals, /api/ontology/:city, /api/opportunities, scoring    │
│  • UI Svelte (Radar, Opportunités, Réconciliation studio)                     │
│  • geo (local) : lots cadastraux ArcGIS MRNF, inventaire zonage               │
│  • NE SCRAPE PLUS, NE GRAPHIFIE PLUS — lit le contrat S3/PG                    │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 La frontière des données — 3 options

| Option | Frontière | Pour | Contre | Reco |
| --- | --- | --- | --- | --- |
| **F1 — S3 seul** | data écrit `graph/`+`ontology/` ; immo lit S3 directement (déjà le cas pour `project-state.json`) | Zéro nouveau composant ; immo a déjà le code lecteur S3 | immo lit du JSON brut (pas de requêtes relationnelles riches) | **Transition** |
| **F2 — PG projeté (propriété data)** | data projette SCW→PG ; immo lit PG en **read-only** | Requêtes riches (scoring JSONB), déjà spécifié (`upsertGraph`) | Qui owne la migration PG ? Couplage schéma | **Cible** |
| **F3 — API "data" interne** | data expose une API ; immo l'appelle | Découplage net | Sur-ingénierie ; latence ; YAGNI en V1 | ❌ |

> **Recommandation frontière** : **F1 maintenant → F2 à terme**. Le contrat S3 (`graph/`
> + `ontology/`) est *déjà* la frontière. PG devient un **détail de projection possédé
> par data** (data lance le Job projection ; immo lit la table). Garder le schéma PG
> `graph_nodes/graph_edges` versionné dans **un seul** dépôt (immo, car c'est immo qui le
> lit) et l'appeler depuis data via l'image — OU déplacer la migration dans data. À
> trancher (cf. §2.4 « point ouvert »).

### 2.3 Place de geo (`@sentropic/geo`)

- **Constat** : il n'y a **pas** de dépendance externe `@sentropic/geo`. La géo est
  **locale à immo** (`api/src/services/geo/lots.ts` → ArcGIS MRNF ;
  `packages/radar-sources/src/geo/geo-source-inventory*.ts`). Elle sert
  l'**exploitation** (enrichir un signal d'un lot/zone à l'affichage).
- **Décision proposée** : la géo **reste dans immo** (frontend d'exploitation). Elle est
  consommée *au moment de la requête utilisateur*, pas pendant la collecte. Si plus tard
  un `@sentropic/geo` partagé émerge (geocoding/cadastre mutualisé sentropic), il
  devient une **dépendance d'immo**, pas du workspace data. *Sauf* si la collecte se met
  à **pré-calculer** les intersections lot↔signal en batch → alors ce calcul
  déterministe migre vers data (voie (b) cron). À surveiller, non bloquant.

### 2.4 Point ouvert à trancher (préco incluse)

- **Où vit le schéma PG + sa migration ?** Préco : **rester dans immo** tant que immo est
  le seul lecteur de PG ; data appelle `project-graph-from-s3` via l'**image immo**
  (réutiliser le binaire). On évite de dupliquer Drizzle. Re-trancher si data acquiert
  d'autres consommateurs de PG.

---

## 3. Pilotage via chat_ui / flow sentropic / remote

### 3.1 Le pattern cible (RemoteTrigger + conductor h2a + agents bg)

```
  Chat UI (sentropic) ──"refresh Sherbrooke"/"re-graphify tout v2.2"──▶
        │
        ▼
  Conductor (h2a, dans le workspace data) ─── traduit l'intention en :
        ├─ enqueue jobs déterministes (scrape/projection) → cron/Job runner
        └─ enqueue tâches graphify → file de travail → RemoteTrigger
                                                        │
        ┌───────────────────────────────────────────────┘
        ▼
  Agent(s) background (claude/codex/gemini via llm-mesh) :
        • prennent une tâche {citySlug, rawManifestHash, ontologyVersion}
        • lisent raw/parsed S3, produisent graph/<city>/latest.json
        • valident gates jq, écrivent un événement de journal
        • libèrent/atteste via h2a → conductor agrège l'avancement
        ▼
  Chat UI ◀── jalons/observabilité (N fraîches, M en file, K échouées)
```

- **RemoteTrigger** (à concevoir) = endpoint/déclencheur qui permet à un **chat distant**
  (ou un cron) de **mettre en file** une tâche d'agent background sans session h2a
  manuelle. C'est le remplacement direct du copier-coller `h2a_offer` actuel.
- **`@sentropic/flow`** = runtime d'orchestration des étapes (scrape→parse→graphify→
  projection) modélisées en flow plutôt qu'en bash. Déjà identifié comme cible dans
  `SPEC_EVOL_PROCESS_E2E §5/§7`. Spike d'abord (surface pré-1.0).

### 3.2 Idempotence — la pierre angulaire (ce qui rend le pilotage chat sûr)

Tout déclenchement chat doit être **rejouable sans dégât**. La clé d'idempotence par
étape :

| Étape | Clé déterministe | Skip si présent |
| --- | --- | --- |
| scrape | `raw/<city>/pv/cas/<sha>.<ext>` (sha = hash bytes) | HEAD-skip (déjà implémenté) |
| parse | `parsed/<city>/pv/<docSha>/<parserVersion>/…` | HEAD-skip (déjà implémenté) |
| **graphify** | **`graph/<city>/latest.json` + sidecar `graph/<city>/.state.json` = `{rawManifestHash, ontologyVersion, graphifyPromptVersion}`** | **À AJOUTER** : skip si `(rawManifestHash, ontologyVersion, promptVersion)` inchangé |
| projection | upsert `ON CONFLICT` (déjà idempotent) | rejouable |

> **Le seul vrai manque d'idempotence est graphify.** Aujourd'hui rien ne dit « ce graphe
> est à jour pour ce raw + cette ontologie ». Proposer un **sidecar d'état graphify**
> (`graph/<city>/.state.json`) résout *simultanément* : la détection de nouveauté (D8),
> la reprise sélective (D5), et l'anti-saturation (on ne re-graphifie que le delta réel).

### 3.3 Reprise totale vs sélective (le même moteur)

Reprendre = **recalculer `désiré − présent`** (réconciliation, `SPEC_PERSISTENCE_S3_FIRST §3`) :

- **Sélective** (refresh quotidien) : `désiré` = villes avec nouveau `rawManifestHash`
  depuis le dernier run. Petite file.
- **Totale** (bump ontologie v2.x, ou refonte prompt graphify) : `désiré` = **toutes**
  les villes dont `ontologyVersion(state) < ontologyVersion(cible)`. Grande file, **même
  code**, juste un prédicat différent.
- **Avantage** : pas deux chemins. « Reprends tout » et « rafraîchis le neuf » sont le
  même `make`/flow avec un filtre. La tranche alphabétique (A–L / M–Z) devient un
  **paramètre de partition**, pas une procédure manuelle.

### 3.4 Observabilité / jalons

- **Source de vérité** : un **manifeste d'état agrégé** dérivé de S3 (lister `graph/*/
  .state.json` + `runs/*/manifest.jsonl`). Pas besoin de DB pour commencer.
- **Vue chat / dashboard** : `fresh / stale / queued / running / failed` par ville +
  `coverage etape ≥ 60 %` (gate déjà défini dans `etape-anticipation-delegation.md §5`).
- **Remplace** `make conductor-report` (qui lit des cases `.md`) par un
  `make data-status` qui lit l'état réel des artefacts.

---

## 4. Industrialisation des refresh

### 4.1 Cadence (alignée sur `SPEC_EVOL_AUTOMATION_BENCHMARK` : 3 régimes)

| Régime | Quoi | Cadence proposée | Mécanisme |
| --- | --- | --- | --- |
| **Initial / bootstrap** | 1ʳᵉ collecte d'une ville | à la demande (onboarding) | Job scrape ciblé + graphify |
| **Récurrent** | détecter nouveaux PV | **quotidien** (cron) | CronJob scrape → manifeste nouveauté → file graphify delta |
| **Approfondissement** | bump ontologie / re-prompt | à la demande (chat) | reprise totale (filtre `ontologyVersion`) |

> Le scrape déterministe peut tourner **quotidiennement sur les 549 villes** sans LLM
> (coût ≈ bande passante + pdftotext). Seul **graphify du delta** consomme du LLM. Bien
> séparer les deux cadences = clé de l'anti-saturation.

### 4.2 Détection de nouveauté (D8 → moteur)

1. Le scrape écrit déjà `runs/<source>/<runId>/manifest.jsonl` avec `status:new|seen`.
2. **À ajouter** : un agrégateur qui, après chaque run, calcule par ville un
   `rawManifestHash` (hash trié des `casKey` `new`+`seen` de la fenêtre).
3. Comparer à `graph/<city>/.state.json.rawManifestHash` → **liste des villes à
   (re)graphifier**. C'est l'entrée de la file graphify.

### 4.3 Gates qualité automatiques

Réutiliser tels quels les **4 gates jq** de `etape-anticipation-delegation.md §4` :
`etape` non-null, enum valide, `ontology_version` correcte, `etape_date` valide. Les
**exécuter automatiquement** après chaque graphify (dans le flow), bloquer la projection
si rouge. Ajouter un gate « graphe non vide / ≥ 1 Source ». Aujourd'hui ces gates sont
copiés-collés à la main par l'agent — les **mécaniser** dans le runner.

### 4.4 Anti-saturation du compte (le cœur de D3)

| Levier | Détail |
| --- | --- |
| **Ne graphifier que le delta** | sidecar d'état → on ne touche que les villes dont raw/ontologie a changé (souvent 0–5/jour en récurrent). |
| **Multi-provider** | `@sentropic/llm-mesh` : router graphify sur claude/codex/gemini selon quota restant. Ne PAS favoriser un fournisseur ; choisir au quota/coût/qualité mesurée (cf. benchmark §8 PROCESS_E2E). |
| **Budget + backoff** | quota journalier de tâches graphify ; file persistante → si quota atteint, la file attend demain (pas de perte). |
| **Compte de service dédié** | sortir graphify du compte Claude **humain interactif** : un compte/clé **machine** pour le workspace data (sépare « je code » de « la prod graphifie »). |
| **Batch séquentiel** | conserver la règle OOM (un graphify à la fois, cf. mémoire `oom-parallel-test-stacks`). |

---

## 5. Plan de migration incrémental (« le plus simple d'abord »)

> Principe directeur : **Strangler Fig**. On n'arrête jamais l'existant ; on
> industrialise étape par étape, en commençant par ce qui ne demande **aucun agent** et
> débloque le plus (D1/D2), puis on externalise **seulement** le maillon agentique.

### Vague A — Réparer + cron-iser le déterministe (dans immo, ~1 semaine)

*Objectif : le refresh quotidien des nouveaux PV + projection PG tourne sans humain.*

1. **Fix D1 (projection)** — 3 options, préco incluse :
   - **A1 (préco)** : ajouter `src/scripts/project-graph-from-s3.ts` aux `entryPoints`
     esbuild (2ᵉ outfile `api/dist/scripts/project-graph-from-s3.js`) + copier dans le
     runtime. Minimal, aligné sur l'architecture bundle existante.
   - A2 : changer le job pour `npx tsx src/scripts/…ts` — mais `tsx` OOM dans le budget
     mémoire tenant (raison d'être du bundle, cf. en-tête `Dockerfile`). ❌
   - A3 : faire de la projection une **route admin** dans le bundle API (`POST
     /admin/project-graph`) gated par token — élégant mais couple projection à l'API.
2. **Fix D2 (scrape auto)** — ajouter `deploy/k8s/3x-scrape-job.yaml` (Job paramétrable
   `CITIES`/`LIMIT`) + `deploy/k8s/3x-refresh-cronjob.yaml` (quotidien) chaînant
   scrape → projection. *Sans graphify pour l'instant* (graphify reste manuel en Vague A).
3. **Manifeste de nouveauté (D8)** — petit script d'agrégation `runs/* → liste villes
   neuves`, écrit `graph/<city>/.state.json`. Pose la fondation de la file graphify.
4. **`make data-status`** — vue d'état réelle (remplace `conductor-report` pour la data).

*Sortie de Vague A : immo rafraîchit et projette tout seul ; graphify encore manuel mais
**outillé** (liste exacte du delta à graphifier).*

### Vague B — Externaliser graphify dans le workspace data (piloté chat)

*Objectif : supprimer le copier-coller h2a manuel ; graphify devient une file consommée
par des agents bg pilotables depuis le chat.*

1. **Créer le workspace "data" dans sentropic** : il importe l'**image immo** (pour
   réutiliser scrape/projection/manifeste) + ajoute le **runner graphify agentique**.
2. **File de travail graphify** : alimentée par le manifeste de nouveauté (Vague A.3),
   clé `(citySlug, rawManifestHash, ontologyVersion, promptVersion)`.
3. **RemoteTrigger + conductor h2a** : un chat peut `enqueue`/`re-enqueue`/`drain`. Le
   conductor h2a (automatisé, plus humain) distribue aux agents bg.
4. **Anti-saturation** (§4.4) : compte machine dédié, llm-mesh multi-provider, quotas,
   backoff, gates jq mécanisés bloquant la projection.
5. **Idempotence graphify** : sidecar `.state.json` écrit en fin de tâche.

*Sortie de Vague B : « re-graphifie tout en v2.2 » se dit dans un chat ; la file draine
toute seule, anti-sature, reprend après crash, projette quand vert.*

### Vague C — immo = frontend pur

*Objectif : immo ne possède plus aucune collecte/orchestration.*

1. Déplacer définitivement le **déclenchement** scrape/projection vers data (immo garde
   le *code* tant qu'il sert de binaire, mais ne **lance** plus rien).
2. immo en **lecture seule** sur le contrat S3/PG (F1→F2).
3. Retirer d'immo : `worker-live` du chemin opérationnel, les jobs k8s de collecte
   (migrés dans data), `.agents/lanes`/`conductor-report` liés à la data.
4. immo ne garde que : API d'exploitation, UI, geo, scoring, schéma PG (lecteur).

> **Réversibilité** : à toute étape, on peut s'arrêter. Vague A seule **vaut déjà le
> coup** (refresh auto). Vague B sans C = data orchestre, immo reste « gros » mais ça
> marche. C est cosmétique/hygiène, pas urgent.

---

## 6. Options globales + recommandation

### 6.1 Trois architectures-cibles candidates

| | **Opt-1 : Strangler (RECO)** | **Opt-2 : Big-bang data workspace** | **Opt-3 : Tout dans immo + cron** |
| --- | --- | --- | --- |
| Idée | Fix déterministe dans immo (A), externalise graphify (B), immo→frontend (C) | Créer data tout de suite, y déménager *toute* la collecte | Ne rien séparer ; tout en CronJobs+agents bg dans immo |
| Effort initial | **Faible** (A ne touche presque rien) | Élevé (réécrire contrats, déménager code testé) | Faible-moyen |
| Risque | **Faible** (réversible par vague) | Élevé (régression, double maintenance) | Moyen (immo devient un monolithe collecte+expo) |
| Réalise la vision | **Oui, progressivement** | Oui mais coûteux/risqué | **Non** (pas de séparation) |
| « Le plus simple d'abord » | ✅ | ❌ | ✅ court terme, ❌ long terme |

### 6.2 Recommandation

**Opt-1 (Strangler Fig en 3 vagues).** Justification :

1. **La collecte déterministe n'a pas besoin de déménager pour être industrialisée.**
   Elle est déjà idempotente/CAS/testée. La cron-iser *dans immo* (Vague A) débloque le
   refresh **cette semaine**, sans contrat réseau ni nouveau dépôt.
2. **Seul graphify justifie le workspace data** : c'est le maillon agentique, saturable,
   non idempotent, non observé. L'isoler dans data (Vague B) **concentre** la complexité
   nouvelle (RemoteTrigger, h2a auto, llm-mesh, quotas) là où elle paie.
3. **La frontière existe déjà (S3)** : on ne la crée pas, on la *contractualise*. Le coût
   marginal de « immo = frontend » (Vague C) est faible une fois B fait.
4. **Réversible et démontrable à chaque étape** — cohérent avec la contrainte « démo /
   pricing » du projet (chaque vague est montrable).

### 6.3 Challenge explicite de la vision du principal

- ✅ **« immo = frontend, data = collecte+orchestration » : validé**, mais **pas pour
  tout le pipeline**. Déménager scrape/parse/projection (du code déterministe déjà bon)
  n'apporte rien et ajoute un contrat. **Ne déménager que l'orchestration agentique
  (graphify).**
- ✅ **« piloter par chat / RemoteTrigger / flow » : validé comme cible**, mais
  **RemoteTrigger n'existe pas encore** — c'est un design à faire (spike), pas un acquis.
  Et **le chat ne doit piloter que la file** (déclencher/superviser), pas exécuter
  graphify lui-même (sinon on recrée la dépendance compte interactif).
- ⚠️ **« le plus simple d'abord » : alerte ordre**. Le « plus simple » qui débloque le
  plus n'est PAS de créer le workspace data — c'est de **fixer D1/D2 dans immo** (Vague
  A). Créer data avant d'avoir réparé la projection, c'est bâtir sur du cassé.
- ⚠️ **Frontière PG** : ne pas dupliquer le schéma Drizzle. Tant qu'immo est seul lecteur
  PG, data appelle le binaire de projection *de l'image immo*. Sinon double source de
  vérité du schéma.

### 6.4 Premiers pas concrets (si Opt-1 retenue)

1. **Fix bundle projection** (A1) — débloque la projection PG en prod. *Plus haute
   valeur / plus petit effort.*
2. **Job + CronJob scrape→projection** (D2) — refresh quotidien autonome.
3. **Manifeste de nouveauté + sidecar `.state.json`** (D8) — fondation file graphify.
4. **Spike RemoteTrigger / `@sentropic/flow`** — valider la surface avant d'investir
   Vague B.

---

## 7. Risques & dépendances

| Risque | Impact | Mitigation |
| --- | --- | --- |
| Spike `@sentropic/flow`/h2a déçoit (surface pré-1.0) | Vague B glisse | Vague A indépendante ; fallback runner maison (cf. `SPEC_EVOL_SCAFFOLDING` qui prévoit déjà l'impl maison) |
| Bump ontologie pendant reprise totale | 549 graphify d'un coup → saturation | quotas + file persistante + backoff (§4.4) ; étaler sur N jours |
| Schéma PG dupliqué immo/data | double source de vérité | binaire de projection unique (image immo) |
| Scrapers fragiles (SPA/403, cf. mémoire S-Z) | nouveauté non captée | hors scope refresh ; tracké séparément (Playwright+OCR) ; le refresh n'aggrave pas |
| geo glisse dans la collecte par accident | brouille la frontière | règle : geo = exploitation (immo) sauf pré-calcul batch explicite |

---

## 8. Références

- `SPEC_PERSISTENCE_S3_FIRST.md` §3 (réconciliation `désiré−présent`) ; Phase 2 (SCW
  Serverless Jobs + Cron quotidien, partition par hash slug, 40→1000 villes)
- `SPEC_EVOL_PROCESS_E2E.md` §5/§7 (flow/h2a cibles ; cron vs agent ; voies a/b/c)
- `SPEC_EVOL_H2A_CHAT.md`, `UAT_EV2_EV7_ESCALATIONS.md` (h2a/flow différés, V1 stub)
- `SPEC_EVOL_AUTOMATION_BENCHMARK.md` (3 cadences ; benchmark par étape)
- `etape-anticipation-delegation.md` §4–§6 (gates jq ; brief délégation ; plan validation)
- `api/Dockerfile` (bundle esbuild `src/index.ts` seul → cause de D1)
- `deploy/k8s/31-graph-projection-job.yaml` (job projection cassé)
- `api/src/services/sources/{recueil,exploit-scrape}.ts`, `api/src/scripts/project-graph-from-s3.ts`
- `rules/conductor.md`, `rules/subagents.md`, `.agents/lanes` (orchestration manuelle actuelle)
- Mémoires : `oom-parallel-test-stacks`, `sz-nouvelles-scraper-tail`, `agents-need-worktree-isolation`
