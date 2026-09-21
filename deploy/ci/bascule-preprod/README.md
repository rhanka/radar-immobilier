# bascule-preprod — bascule PROD → PRÉPROD (« iso-prod »)

Bascule **rejouable par la CI immo / l'owner SANS IA** (OPS-3) : sauvegarde prod
→ restauration préprod → migrations → copie docs → recon → flip serving →
refresh différentiel → smoke. **0 Python.** Outils natifs uniquement : `pg_dump`
/ `pg_restore` (postgresql-client 16), `s5cmd` (copie + recon server-side),
`node` (migrations + refresh via l'image radar-api existante), `kubectl`
(flip + Jobs), `curl` (smoke).

**Aucune IA au runtime.** Toute la logique et toutes les gardes fail-closed sont
en Node dans `bascule.mjs` ; le workflow `.github/workflows/bascule-preprod.yml`
ne fait qu'installer les outils, câbler les secrets et appeler le CLI dans
l'ordre.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `bascule.mjs` | CLI Node : sous-commandes `preflight quiesce dump restore migrate copy-docs recon precheck-runs flip unquiesce refresh smoke` + les gardes fail-closed. |
| `db-migrate-job.tmpl.yaml` | Patron du Job migrate (S2c) rendu + appliqué en préprod (patron de `deploy/k8s/36-db-migrate-job.yaml`). |
| `refresh-job.tmpl.yaml` | Patron du Job refresh différentiel (S6), worker-live delta (patron de `deploy/k8s/34-refresh-cronjob.yaml`). |
| `../../../.github/workflows/bascule-preprod.yml` | `workflow_dispatch` qui enchaîne S0→S7. |

## Séquence (S0→S7)

| Pas | Sous-commande | Ce qui se passe | Où |
| --- | --- | --- | --- |
| S0 | `preflight` | binaires + secrets présents + contrôle positif `PROD_PGDATABASE == EXPECTED_DATABASE`. | runner |
| Q | `quiesce` | **enregistre les replicas d'origine** de `radar-api`/`radar-immo-mcp` → scale 0 + suspend des 3 cronjobs + attend le drain (pour que G2 passe). | préprod (kubectl) |
| S1 | `dump` | `pg_dump --format=custom --no-owner --no-privileges` prod (snapshot MVCC), T0 = label. | runner |
| S2 | `restore` | **G1 rollback préprod** puis `pg_restore --clean --if-exists --exit-on-error --single-transaction`. | runner (libpq) |
| S2c | `migrate` | Job in-cluster `node dist/db/migrate.js` (image préprod exacte) = test iso-prod. | préprod (kubectl) |
| S3 | `copy-docs` | `s5cmd --endpoint-url $BHS sync 's3://$PROD_DOCS/*' 's3://$PREPROD_DOCS/'` server-side, additif. | runner → S3 |
| S3b | `recon` | re-`s5cmd --dry-run sync` ; **sortie VIDE exigée** (dest ⊇ src) sinon exit 1. Écrit le sentinel `recon.ok`. | runner |
| S3c | `precheck-runs` | garde **mémoire de collecte** (read-only) : `s5cmd ls` du préfixe `runs/` du bucket servi (PREPROD_DOCS). `runs/` **vide** → exit 1 (rescrape complet imminent) ; source sans `collected-urls.jsonl` → WARN (refetch borné). | runner → S3 |
| S5 | `flip` | `kubectl set env deploy/radar-api GEO_DOCUMENTS_REPOINT-` (défaut OFF = iso-prod, réversible). | préprod (kubectl) |
| U | `unquiesce` | **scale-back aux replicas enregistrés + `rollout status`** ; restaure le suspend d'origine. Joué en `if: always()` (jamais préprod à terre). **Sans CONFIRM** (reprise). | préprod (kubectl) |
| S6 | `refresh` | Job in-cluster worker-live **delta** (PAS `--all`) ; écrit dans le **bucket servi config-driven** (assert `ConfigMap SCRAPE_S3_BUCKET == PREPROD_DOCS`) ; le CronJob refresh reste suspendu. | préprod (kubectl) |
| S7 | `smoke` | `curl préprod/health` ; `db.ok` + `objectStore.ok` exigés. UAT Farid = hors script. | runner |

Ordre workflow : S0 → **S0.b (`precheck-runs --prod`, advisory)** → **Q** → S1 → S2 → S2c → S3 → S3b → S5 → **U (`always`)** → **S3c (`precheck-runs`, gate)** → S6 → S7 → upload rollback (`always`).

## Gardes fail-closed (clé OPS-3), et où elles sont câblées

Toutes sont **en Node** dans `bascule.mjs` :

- **G1 — rollback avant restore.** `restore` fait d'abord un `pg_dump` custom de
  la DB préprod (`assertQuiesced()` puis dump rollback) et refuse le
  `pg_restore` destructif si ce rollback est vide/illisible. (`cmdRestore`)
- **G2 — quiesce vérifié.** `restore` refuse si les consommateurs préprod ne sont
  pas au repos : Deployments `radar-api`, `radar-immo-mcp` à `replicas=0`, CronJobs
  `radar-refresh-pv`, `radar-consistency-snapshot`, `radar-populate-geo-daily` à
  `suspend=true`, **ET 0 Job batch actif** dans le namespace (les Jobs one-off —
  scrape, projection, graphify, populate-geo, mapper, snapshot, migrate… —
  tiennent une connexion à `radar-postgres` uniquement quand ils tournent, donc
  ils échappent au suspend/scale : `status.active>0` → exit 1). Échappatoire
  `SKIP_ACTIVE_JOBS_CHECK=1` (OFF par défaut). (`assertQuiesced`)
- **G3 — CONFIRM explicite.** Toute étape mutante (`dump`, `restore`, `migrate`,
  `copy-docs` réel, `flip`, `refresh`) exige `CONFIRM=iso-prod-AAAA-MM-JJ` ;
  recoupé au jour courant via `CONFIRM_EXPECTED` (anti-rejeu). (`assertConfirm`)
- **G4 — flip seulement si recon OK.** `flip` exige le sentinel `recon.ok` (écrit
  par S3b) **et rejoue la recon en direct** juste avant de muter l'env.
  (`assertReconOk`)
- **+ contrôle positif source.** `preflight` et `dump` refusent si
  `PROD_PGDATABASE != EXPECTED_DATABASE` (on ne dumpe pas la mauvaise DB).
- **+ pré-check mémoire de collecte (`runs/`).** `precheck-runs` (et `refresh`
  en interne) refusent S6 si le préfixe `runs/` est **entièrement absent** du
  bucket servi (rescrape complet imminent). Cf. section « MEDIUM 3 » ci-dessous.
  (`assertRunsMemory`)

Idempotence / rejouabilité : `s5cmd sync` saute l'inchangé ; `pg_restore --clean`
= remplacement ; `migrate` saute les migrations déjà appliquées ; `flip`
= remove-if-present ; les Jobs sont supprimés-puis-appliqués.

## Secrets & variables CI

**Secrets** (repository/environment secrets — jamais imprimés) :

| Secret | Contenu |
| --- | --- |
| `KUBE_CONFIG_DATA` | kubeconfig base64, capable préprod (mêmes creds que le CD). |
| `BASCULE_PROD_PGHOST` / `_PGPORT` / `_PGUSER` / `_PGPASSWORD` / `_PGDATABASE` | DB prod **RO**. |
| `BASCULE_PREPROD_PGHOST` / `_PGPORT` / `_PGUSER` / `_PGPASSWORD` / `_PGDATABASE` | DB préprod (cible). |
| `BASCULE_DOCS_AWS_ACCESS_KEY_ID` / `BASCULE_DOCS_AWS_SECRET_ACCESS_KEY` | identité S3 **spanning** (read+list docs prod / write+list docs préprod, même endpoint). |

**Variables** (`vars.*`, non secrètes) :

| Variable | Exemple |
| --- | --- |
| `BASCULE_EXPECTED_DATABASE` | nom de la DB prod (contrôle positif). |
| `BASCULE_BHS_ENDPOINT` | endpoint objet OVH BHS (`https://…`). |
| `BASCULE_PROD_DOCS_BUCKET` / `BASCULE_PREPROD_DOCS_BUCKET` | buckets docs prod / préprod. |
| `BASCULE_AWS_REGION` | région S3 (peut être vide). |
| `BASCULE_PREPROD_NAMESPACE` | `radar-immobilier-preprod` (défaut). |
| `BASCULE_PREPROD_HEALTH_URL` | `https://preprod.immo.sent-tech.ca/health`. |
| `EXPECTED_KUBE_APISERVER_HOST` | `hlhedx.c1.bhs5.k8s.ovh.net` (pré-vol cluster). |
| `BASCULE_UNQUIESCE_REPLICAS` | (optionnel) repli d'un-quiesce si `SKIP_QUIESCE=true` : `radar-api=1,radar-immo-mcp=1`. |

> **Pas d'image `radar-backup`.** Le runner installe pg-client 16 + s5cmd ; les
> Jobs migrate/refresh réutilisent l'**image radar-api exacte servie en préprod**
> (résolue par `kubectl get deploy radar-api`), pour rester iso-prod.

## Rejouer SANS IA

1. **DRY (défaut, sûr).** `workflow_dispatch` → `CONFIRM=iso-prod-<aujourd'hui>`,
   `DRY_RUN=true`. Joue `preflight` + plan de copie (`--dry`) + `recon`
   (informatif) + `smoke`. **Aucune écriture.**
2. **Exécution.** Rejouer avec `DRY_RUN=false` et `CONFIRM=iso-prod-<date du jour
   UTC>` exact (G3 anti-rejeu). Le **quiesce est automatisé** (pas Q : enregistre
   les replicas d'origine → scale 0 + suspend + drain) et l'**un-quiesce** (pas U,
   `if: always()`) rétablit préprod à la fin ou après un échec — **jamais préprod
   à terre**. Rien à faire à la main.
3. **Isolation S5.** Si la CI n'a pas encore le RBAC kubectl préprod pour muter
   l'env : `SKIP_FLIP=true` (et au besoin `SKIP_REFRESH=true`). Le flip devient
   le seul pas porté hors-CI (owner / enabler k8s) :
   `kubectl -n radar-immobilier-preprod set env deploy/radar-api GEO_DOCUMENTS_REPOINT-`.
4. **Quiesce manuel.** `SKIP_QUIESCE=true` si l'owner quiesce à la main ; dans ce
   cas renseigner `BASCULE_UNQUIESCE_REPLICAS=radar-api=1,radar-immo-mcp=1` pour
   que l'**un-quiesce reste automatisé** (sinon aucun état à restaurer → préprod
   resterait scale 0). Commandes manuelles de quiesce :
   ```
   kubectl -n radar-immobilier-preprod scale deploy/radar-api deploy/radar-immo-mcp --replicas=0
   kubectl -n radar-immobilier-preprod patch cronjob/radar-refresh-pv          -p '{"spec":{"suspend":true}}'
   kubectl -n radar-immobilier-preprod patch cronjob/radar-consistency-snapshot -p '{"spec":{"suspend":true}}'
   kubectl -n radar-immobilier-preprod patch cronjob/radar-populate-geo-daily   -p '{"spec":{"suspend":true}}'
   ```
5. **Rollback DURABLE.** En fin de run (`if: always()`), le dump prod (S1) + le
   dump rollback préprod (G1, `preprod-rollback-<ts>.dump`) + les états sont
   uploadés en **artefact GitHub** `bascule-rollback-<run_id>` (rétention 7 j) —
   ils survivent au workdir éphémère. Restaurer : `pg_restore --clean --if-exists
   --single-transaction` vers la DB préprod. Le flip est réversible (ré-ajouter
   `GEO_DOCUMENTS_REPOINT` rétablit le drift). Pour de très gros dumps, préférer
   un push S3 (bucket de backups via `s5cmd`) à l'artefact GitHub.

## MEDIUM 2 — cible d'écriture du refresh (classe du bug Farid)

Le Job refresh (S6) écrit les nouveaux PV dans le **bucket servi config-driven**
(#738), **pas** un `SCRAPE_S3_BUCKET` divergent qui recréerait la divergence (PV
écrits là où l'API ne lit pas → re-404). Deux niveaux :

- **Manifeste** : `refresh-job.tmpl.yaml` prend `SCRAPE_S3_ENDPOINT/BUCKET/REGION/
  FORCE_PATH_STYLE` du **ConfigMap `radar-api`** (lu par l'API ET le refresh) ;
  seuls `SCRAPE_S3_ACCESS_KEY/SECRET_KEY` viennent du secret scrape.
- **Assertion Node** : avant S6, `refresh` exige
  `ConfigMap radar-api.SCRAPE_S3_BUCKET == PREPROD_DOCS` (sinon exit 1).
  Échappatoire documentée : `ASSERT_REFRESH_BUCKET=0` (dégrade en warning),
  `REFRESH_SERVED_BUCKET_KEY` si la clé du ConfigMap diffère.

## MEDIUM 3 — mémoire de collecte (`pré-check runs/`)

Le refresh S6 (`worker-live` delta) ne fait un **delta** — et pas un **rescrape
complet** — que si l'état object-store `runs/{source}/collected-urls.jsonl` est
présent dans le bucket qu'il **lit** (PREPROD_DOCS, **après** la copie S3). Cet
état pilote le skip « déjà scrapé → on ne re-télécharge pas » (clé par URL, cf.
`api/src/services/sources/known-urls.ts`). Si le préfixe `runs/` est **entièrement
absent**, `loadCollectedUrls` renvoie « rien de connu » pour chaque source →
fail-open → re-téléchargement de tout le back-catalogue (le rescrape des 528).

La sous-commande **`precheck-runs`** (read-only, `s5cmd ls`) matérialise la garde :

- **Cible par défaut = PREPROD_DOCS** (le bucket réellement lu par S6). C'est le
  **gate** : `runs/` vide/absent → **exit 1** (rescrape complet imminent).
- **`--prod`** (ou `PRECHECK_TARGET=prod`) → cible **PROD_DOCS** en mode
  **advisory** (prédiction précoce : la copie amènera-t-elle `runs/` ?) — ne
  bloque **jamais** (WARN seulement).
- **Plancher fail-closed** : hard-fail **uniquement** si `runs/` est vide/absent.
  Sinon la garde liste `runs/*/collected-urls.jsonl`, **rapporte** N préfixes
  source / M avec état / la liste des manquants, et **WARN** (pas de hard-fail)
  sur les sources sans `collected-urls.jsonl` — un refetch **borné** de CETTE
  source (self-heal via bootstrap des manifests), pas un rescrape global.
- **DRY** : la garde est **read-only**, donc `DRY=1`/`--dry` ne la relâche pas :
  la liste est jouée à l'identique et le hard-fail « `runs/` vide » reste actif
  (visibilité précoce). En **workflow DRY** la copie S3 réelle n'a pas eu lieu →
  seul l'appel **advisory PROD_DOCS** (S0.b) est joué ; le **gate PREPROD_DOCS**
  (S3c) n'est joué qu'en exécution réelle (sinon faux négatif sur un préprod
  pas encore copié).
- **source-gap** : l'énumération des sources **actives** vit dans la config TS de
  l'app (villes config-only) et n'est pas disponible cheap à ce CLI `.mjs` (aucun
  `dist` importable au runner). Le plancher se fonde donc sur l'état du store
  (sources = préfixes présents sous `runs/`). Repli optionnel :
  `PRECHECK_EXPECTED_SOURCES="a,b,c"` → WARN (jamais hard-fail) sur les sources
  attendues absentes de `runs/`.
- **Défense en profondeur** : `refresh` (S6) rejoue `assertRunsMemory` en interne
  (cible PREPROD_DOCS) pour gater aussi un `refresh` lancé seul. Échappatoire
  documentée `ASSERT_RUNS_MEMORY=0` (dégrade en warning — à n'utiliser qu'en
  connaissance de cause).

Où c'est câblé dans le workflow : **S0.b** `precheck-runs --prod` (advisory, joué
aussi en DRY, `continue-on-error`) après S0 ; **S3c** `precheck-runs` (gate) après
S3/S3b (copie docs) et **avant** S6, `if: !DRY_RUN && !SKIP_REFRESH`.

## Lancer une sous-commande à la main (hors workflow)

```bash
# mêmes variables d'env que le workflow (voir tableau secrets/vars)
node deploy/ci/bascule-preprod/bascule.mjs preflight
DRY=1 node deploy/ci/bascule-preprod/bascule.mjs copy-docs        # plan seul
node deploy/ci/bascule-preprod/bascule.mjs precheck-runs --prod   # advisory (PROD_DOCS)
node deploy/ci/bascule-preprod/bascule.mjs precheck-runs          # gate (PREPROD_DOCS)
```
