# Industrialisation des refresh de données — suivi des 3 vagues

> **Doc de SUIVI vivant** (tracking) du plan « Strangler Fig » issu du brainstorm
> `docs/spec/brainstorm-industrialisation-refresh-data.md` (PR #202). Il trace
> l'état des 3 vagues, le fait/à-faire, les décisions et les jalons. Mis à jour à
> chaque avancée — y compris les chantiers longs (Vagues B/C).
>
> **Cadre.** Loi 25 : zéro PII (buckets `raw/` privés, jamais servis tels quels,
> filtrage PII au parsing, aucun nœud « personne physique » graphify). On produit
> du **code + manifestes + doc** ; on ne **déploie/migre RIEN en prod** (le
> conducteur builde l'image, push, et lance les jobs k8s).

---

## Tableau de bord des vagues

| Vague | Périmètre | Statut | Done quand |
| --- | --- | --- | --- |
| **A** | Réparer + cron-iser le DÉTERMINISTE *dans immo* (fix projection D1, jobs scrape/projection, CronJob) | **EN COURS — code livré dans cette PR** | Image build les 2+ entrypoints ; le conducteur peut reprojeter ~1000 graphes v2.1 SCW→PG sans erreur ; le refresh quotidien tourne sans humain |
| **B** | Externaliser SEULEMENT graphify dans un workspace « data » sentropic, piloté chat (RemoteTrigger + conductor h2a + idempotence sidecar) | **DESIGN — spec dans cette PR** (impl ultérieure) | « re-graphifie tout en v2.2 » se dit dans un chat ; la file draine, anti-sature, reprend après crash, projette quand vert |
| **C** | immo = frontend PUR (frontière S3 `graph/<city>/latest.json`) | **DESIGN — spec dans cette PR** (impl ultérieure) | immo ne possède plus aucune collecte/orchestration ; lecture seule du contrat S3/PG |

---

## VAGUE A — détail (code livré dans `feat/industrialisation-vague-a`)

### A1 — Fix D1 : la projection PG était cassée (MODULE_NOT_FOUND) — FAIT

**Diagnostic.** `api/Dockerfile` ne bundlait QUE `api/src/index.ts` via esbuild
(`outfile: api/dist/index.js`). Le runtime ne copie que `api/dist`. Donc
`api/dist/scripts/project-graph-from-s3.js` n'existait **jamais** dans l'image →
le Job k8s `31-graph-projection-job.yaml` échouait en `MODULE_NOT_FOUND`.

**Fix (esbuild multi-entryPoints).** Passage de `outfile` (mono) à
`outdir: 'api/dist'` + `outbase: 'api/src'` + `entryNames: '[dir]/[name]'` avec
plusieurs `entryPoints`. Le mapping produit (vérifié par build local) :

| entryPoint source | sortie dans l'image | invoqué par |
| --- | --- | --- |
| `api/src/index.ts` | `api/dist/index.js` | CMD principal (Deployment api) — **inchangé** |
| `api/src/db/migrate.ts` | `api/dist/db/migrate.js` | initContainer `db-migrate` |
| `api/src/db/scripts/backfill-0004-tracking.ts` | `api/dist/db/scripts/backfill-0004-tracking.js` | initContainer `db-backfill-0004` |
| `api/src/scripts/project-graph-from-s3.ts` | `api/dist/scripts/project-graph-from-s3.js` | conteneur `project-graph` (**c'était le fichier manquant**) |
| `api/src/scripts/worker-live.ts` | `api/dist/scripts/worker-live.js` | Job/CronJob scrape |

Le bundle reste **séparé et léger** : plugin esbuild `ext` inchangé (seuls les
`@radar/*` sont inlinés, le reste reste external/node_modules). L'entrypoint
principal `api/dist/index.js` est strictement préservé (CMD du Dockerfile
inchangé).

**Copie drizzle.** Le runtime ne copiait pas `api/drizzle`. Or `migrate.js` lit
`migrationsFolder: "drizzle"` RELATIF au CWD. Ajout d'un
`COPY --from=build /workspace/api/drizzle ./api/drizzle` ; les Jobs migrate
tournent avec `workingDir: /workspace/api`.

**Bonus chemin.** Le Job 31 invoquait `dist/...` (sans préfixe `api/`) alors que
le WORKDIR runtime est `/workspace` et les dist sont sous `api/dist`. Corrigé
partout en `workingDir: /workspace/api` + `command: ["node", "dist/..."]`.

### A2 — Job de projection PROPRE — FAIT

`31-graph-projection-job.yaml` réécrit. Flux robuste à 3 étapes :

1. **initContainer `db-backfill-0004`** (NOUVEAU, AVANT migrate) — insère la ligne
   de tracking drizzle de `0004_auth_users` (appliquée à la main, jamais trackée).
   Idempotent (hash check → no-op si présente). **Sans cette étape, migrate
   rejouerait 0004 et échouerait** (table `account_users` déjà existante — dette
   connue). Réutilise le script déjà mergé `backfill-0004-tracking.ts`.
2. **initContainer `db-migrate`** — migrations Drizzle (idempotent, CREATE IF NOT
   EXISTS), `workingDir: /workspace/api`.
3. **conteneur `project-graph`** — lit `graph/<ville>/latest.json` (SCW) → upsert
   PG (`ON CONFLICT`, idempotent).

**Variante projection-seule** : `32-graph-projection-only-job.yaml` (NOUVEAU) —
projection sans migrate/backfill, pour les reprojections RÉPÉTÉES (re-graphify
v2.x). 100 % idempotent, aucune mutation de schéma. **C'est le job à privilégier
pour reprojeter les ~1000 graphes v2.1** une fois le schéma posé.

**Resources serrées** (budget tenant : ~256Mi/150m CPU libres) sur tous les
conteneurs : `requests {cpu 50m, memory 96Mi}`, `limits {cpu 150m, memory 256Mi}`,
`NODE_OPTIONS=--max-old-space-size=200` (heap V8 plafonné sous la limite conteneur
→ pas d'OOM-kill).

### A3 — Cron-isation du pipeline DÉTERMINISTE — FAIT

| Manifeste | Type | Rôle | Cadence |
| --- | --- | --- | --- |
| `33-scrape-job.yaml` | Job one-shot | scrape+parse+exploit (worker-live, `LIVE_SCRAPE_EXPLOIT=1`) → `raw/ parsed/ ontology/` SCW. HEAD-skip CAS, S3-only, AUCUN LLM | à la demande |
| `34-refresh-cronjob.yaml` › `radar-refresh-scrape` | CronJob | idem en récurrent | **quotidien 03:17 UTC** |
| `34-refresh-cronjob.yaml` › `radar-refresh-projection` | CronJob | projection SCW→PG (rattrape les graphes re-graphifiés hors-bande) | **quotidien 04:30 UTC** (après le scrape) |

**Cadences DÉCOUPLÉES** volontairement (brainstorm §4.1) : le scrape déterministe
(gratuit) tourne tous les jours ; la projection suit. **graphify N'EST PAS
cron-isé ici** (maillon agentique → Vague B). Bien séparer les cadences = clé de
l'anti-saturation.

**Idempotence / observabilité** : `concurrencyPolicy: Forbid` (jamais 2 scrapes
en //, politeness + mémoire), `startingDeadlineSeconds`, `activeDeadlineSeconds`
(garde-fou 2 h scrape / 30 min projection), `successful/failedJobsHistoryLimit: 3`
(inspection a posteriori). Jalons lisibles dans les logs : `worker-live: done`
(new/seen/errors), `project-graph-from-s3: terminé` (ok/skipped/errors).

**Câblage kustomization** : seul `34-refresh-cronjob.yaml` (déploiement
permanent) est ajouté au `kustomization.yaml`. Les Jobs one-shot 31/32/33 restent
hors bundle (appliqués à la main par le conducteur via `kubectl apply -f`),
cohérent avec la convention préexistante du job 31.

### A — Vérification (à la livraison de la PR)

- `kubectl kustomize deploy/k8s` → 23 ressources, dry-run client OK (2 CronJobs
  rendus + validés).
- `kubectl apply --dry-run=client -f 3{1,2,3}-*.yaml` → tous « created (dry run) ».
- `make typecheck` / `make lint` / `make build-api-image` : voir la PR (les
  nouveaux entrypoints sont déjà dans le typecheck du workspace api ; le build
  d'image valide réellement la production des 2+ outfiles).
- Build esbuild local (hors Docker) confirmé : les 5 outfiles attendus sont
  produits aux bons chemins, `api/dist/index.js` préservé.

### A — Reste à faire / handoff conducteur

- [ ] **Conducteur** : `make build-api-image` → `docker push` → `kubectl apply -f
  deploy/k8s/31-graph-projection-job.yaml` (1ʳᵉ fois : backfill+migrate+projection)
  pour reprojeter les ~1000 graphes v2.1 (avec `etape`).
- [ ] **Conducteur** : `kubectl apply -k deploy/k8s` (ou apply du CronJob seul)
  pour activer le refresh quotidien.
- [ ] **Point ouvert egress NetworkPolicy** : les pods scrape/projection portent
  `component: scrape` / `component: graph-projection`, PAS `component: api`. Les
  NetworkPolicies **egress** (vers PG, SCW, internet) sont owned par l'opérateur
  poc-k8s (baseline `allow-api-to-runtime-dependencies`, scope `component: api`).
  Le Job 31 préexistant tournait déjà sous `component: graph-projection` → on
  suppose l'egress autorisé/permissif côté opérateur. **À confirmer par le
  conducteur** avant le 1ᵉʳ run ; si bloqué, l'opérateur étend la baseline aux
  labels `scrape`/`graph-projection`. (Non corrigeable dans ce repo : egress
  baseline ≠ tenant.)
- [ ] **D8 (manifeste de nouveauté)** : agrégateur `runs/* → liste villes neuves`
  + sidecar `graph/<city>/.state.json`. Mentionné en Vague A par le brainstorm
  mais **NON inclus dans cette PR** (le périmètre demandé = fix projection + cron
  déterministe). C'est la **fondation de la file graphify** (Vague B) → spécifié
  ci-dessous, implémenté avec B.

---

## VAGUE B — DESIGN : externaliser SEULEMENT graphify (workspace « data », piloté chat)

> Objectif : supprimer le copier-coller h2a manuel ; graphify devient une **file**
> consommée par des agents background pilotables depuis un chat. **Seul** le
> maillon agentique bouge ; le déterministe (scrape/parse/projection) reste tel
> quel (déjà idempotent/testé/cron-isé en Vague A).

### B.0 — Pré-requis hérité de A (à finir avant B)

- **D8 — manifeste de nouveauté + sidecar d'état graphify.** C'est la fondation de
  la file. À implémenter (petit, déterministe, vit encore dans immo) :
  - Agrégateur post-scrape : pour chaque ville, `rawManifestHash = sha256(tri des
    casKey new+seen de la fenêtre)` lu depuis `runs/<city>/<source>/*/manifest.jsonl`.
  - Sidecar `graph/<city>/.state.json = { rawManifestHash, ontologyVersion,
    graphifyPromptVersion, builtAt }`, écrit en FIN de graphify.
  - Delta = villes où `state.rawManifestHash != hash courant` **OU**
    `state.ontologyVersion < cible`. C'est l'**entrée de la file graphify** et le
    moteur unique « désiré − présent » (reprise sélective = totale, juste le
    prédicat change).

### B.1 — Le workspace « data » sentropic (frontière minimale)

- Nouveau workspace sentropic `data` qui **importe l'image immo** (réutilise
  scrape/parse/projection/manifeste — on ne duplique pas le déterministe) et
  **ajoute UN seul composant neuf** : le **runner graphify agentique**.
- immo ne change pas : il continue d'exposer le code déterministe comme binaire
  (image) et de lire le contrat S3/PG. La frontière reste **S3** (déjà le cas).

### B.2 — RemoteTrigger (À CONCEVOIR — n'existe nulle part dans le repo)

RemoteTrigger = le déclencheur qui permet à un **chat distant** (ou un cron) de
**mettre en file** une tâche d'agent background sans session h2a manuelle. Il
remplace le copier-coller `h2a_offer` actuel. Design proposé (le plus simple
d'abord) :

- **Surface minimale** = 4 verbes sur une file persistante S3 (pas de broker) :
  - `enqueue(citySlug, ontologyVersion, promptVersion)` → écrit un item de file
    `graph/_queue/<citySlug>.<ontologyVersion>.json` (CAS sur la clé d'idempotence
    → ré-enqueue = no-op).
  - `re-enqueue(filter)` → enqueue en masse selon un prédicat (`ontologyVersion <
    cible`, ou liste de slugs) = la reprise totale/sélective.
  - `drain()` → un worker prend les items non `done`, dans la limite du quota.
  - `status()` → agrège la file + les sidecars `.state.json` (fresh/queued/
    running/failed) pour le chat.
- **Transport du déclenchement chat → file** : 3 options, préco incluse.
  | Option | Mécanisme | Pour | Contre | Préco |
  | --- | --- | --- | --- | --- |
  | RT-1 | le chat appelle un endpoint HTTP `data` (token-gated) qui `enqueue` | simple, observable | un service `data` à exposer | **Cible** |
  | RT-2 | le chat écrit directement l'item de file sur S3 (creds scopés) | zéro service | couplage S3 au chat ; pas de validation | Transition / spike |
  | RT-3 | broker (SCW Queues/NATS) | découplage fort | YAGNI en V1 (cf. SPEC_PERSISTENCE §6 « pas de file managée en v1 ») | ❌ |
  - **Préco : commencer RT-2 (spike, file = objets S3) → RT-1** quand le workspace
    data expose un service. La file S3 EST la file (réconciliation, pas de broker).

### B.3 — Conductor h2a (automatisé) + agents background

- Le **conductor h2a** (plus un humain dans une session, mais un process du
  workspace data) consomme la file et distribue aux agents bg via `h2a_offer` /
  `@sentropic/flow`. Il agrège l'avancement (`h2a` atteste/libère) pour le chat.
- Les **agents bg** (claude/codex/gemini via `@sentropic/llm-mesh`) prennent un
  item `{citySlug, rawManifestHash, ontologyVersion, promptVersion}`, lisent
  `raw/ parsed/` S3, produisent `graph/<city>/latest.json`, valident les **gates
  jq** (4 gates `etape` de `etape-anticipation-delegation.md §4` + « graphe non
  vide / ≥ 1 Source »), écrivent le **sidecar `.state.json`** et un événement de
  journal, puis libèrent l'item.

### B.4 — Idempotence (sidecar d'état) — la pierre angulaire

- Clé d'idempotence graphify = `(citySlug, rawManifestHash, ontologyVersion,
  promptVersion)`. **Skip si inchangé** (le sidecar B.0 répond à la question « ce
  graphe est-il à jour pour ce raw + cette ontologie ? » — aujourd'hui rien ne la
  répond).
- Rejouabilité sans dégât : un `enqueue` deux fois, un crash en plein graphify, un
  `drain` interrompu → tous repris par recalcul « désiré − présent ». La projection
  (upsert ON CONFLICT) reste idempotente en aval.

### B.5 — Anti-saturation (cœur de D3)

| Levier | Détail |
| --- | --- |
| Delta-only | le sidecar limite aux villes réellement changées (souvent 0–5/jour) |
| Multi-provider | `@sentropic/llm-mesh` route sur claude/codex/gemini **au quota/coût/qualité mesurée — sans favoriser aucun fournisseur** |
| Budget + backoff | quota journalier de tâches ; file persistante → si quota atteint, la file ATTEND demain (zéro perte) |
| Compte machine dédié | sortir graphify du compte Claude HUMAIN interactif (clé machine pour le workspace data) — sépare « je code » de « la prod graphifie » |
| Batch séquentiel | 1 graphify à la fois (règle OOM `oom-parallel-test-stacks`) |

### B — Étapes incrémentales (le plus simple d'abord) + critères de done

1. **D8 sidecar + agrégateur** (encore dans immo) → la liste exacte du delta existe.
2. **File S3 + 4 verbes (RT-2 spike)** → `enqueue/drain` manuel marche en local.
3. **Runner graphify agentique** (1 worker, séquentiel, gates jq mécanisés) →
   draine la file, écrit sidecar, bloque la projection si gate rouge.
4. **llm-mesh + quotas + compte machine** → anti-saturation effective.
5. **RemoteTrigger RT-1 + conductor h2a auto** → pilotage chat (`enqueue`/`drain`/
   `status`).

**Done Vague B** : « re-graphifie tout en v2.2 » se dit dans un chat ; la file
draine seule, anti-sature, reprend après crash, projette quand vert ; le chat voit
fresh/queued/running/failed par ville.

---

## VAGUE C — DESIGN : immo = frontend PUR

> Objectif : immo ne possède plus AUCUNE collecte/orchestration. La frontière S3
> `graph/<city>/latest.json` + `ontology/<city>/project-state.json` existe DÉJÀ —
> Vague C la **contractualise**, elle ne la crée pas.

### C.1 — Ce qui reste dans immo

API d'exploitation (`/api/signals`, `/api/ontology/:city`, `/api/opportunities`,
scoring), UI Svelte (Radar, Opportunités, Réconciliation), **geo** (local à immo —
consommée à la requête, pas à la collecte), **schéma PG** (immo reste seul lecteur
→ garde la migration ; data appelle le binaire de projection de l'image immo,
**pas de schéma Drizzle dupliqué**).

### C.2 — Ce qui quitte immo (déplacé/désactivé)

- Le **déclenchement** scrape/projection passe au workspace data (immo garde le
  *code* comme binaire mais ne **lance** plus rien : les CronJobs de Vague A sont
  re-hébergés côté data, ou pilotés par la file de Vague B).
- `worker-live` sort du chemin opérationnel d'immo ; `.agents/lanes` /
  `conductor-report` liés à la data partent côté data.
- immo passe en **lecture seule** sur le contrat (F1 S3 → F2 PG projeté).

### C.3 — Frontière des données (rappel brainstorm §2.2)

**F1 (S3 seul) maintenant → F2 (PG projeté, possédé par data) à terme.** PG
devient un détail de projection possédé par data (data lance le Job projection ;
immo lit la table). Pas d'API « data » interne en V1 (F3 = YAGNI).

### C — Étapes incrémentales + done

1. Geler toute écriture `graph/`/`raw/` côté immo (immo lit, n'écrit plus).
2. Re-héberger les CronJobs de Vague A côté workspace data.
3. Retirer d'immo les jobs k8s de collecte + `worker-live` du chemin opérationnel.
4. immo lecture seule S3/PG.

**Done Vague C** : immo ne lance plus aucun scrape/graphify/projection ; tout vit
dans data ; immo = API + UI + geo + scoring + lecteur PG.

> **Réversibilité** : Vague A seule vaut déjà le coup (refresh auto). B sans C =
> data orchestre, immo reste « gros » mais ça marche. C = hygiène, pas urgent.

---

## Décisions & jalons (journal)

- **2026-06-14** — Vague A implémentée (cette PR) : fix esbuild multi-entryPoints
  (D1 résolu), copie drizzle dans le runtime, Job 31 robuste (backfill→migrate→
  projection), Job 32 projection-seule, Job 33 scrape, CronJob 34 (scrape quotidien
  + projection quotidienne), resources serrées au budget tenant. B et C **designés**
  (specs ci-dessus), pas implémentés. D8 (manifeste nouveauté) spécifié, repoussé
  avec B (fondation de la file).
- **Décision frontière PG** : reste dans immo tant qu'immo est seul lecteur PG ;
  data réutilise le binaire de projection de l'image immo (pas de Drizzle dupliqué).
- **Décision graphify** : NON cron-isé en Vague A (agentique, saturable) ; passe en
  file agentique pilotée chat en Vague B uniquement.
