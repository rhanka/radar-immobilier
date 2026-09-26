# bascule-preprod — bascule PROD → PRÉPROD (« iso-prod »)

Bascule **rejouable par la CI immo / l'owner SANS IA** (OPS-3) : déclencheur dump
prod → restore préprod → migrations → copie docs → recon → flip serving → refresh
différentiel → smoke. **0 Python.**

> **CD-native v2 (toute action de prod pilotée par du code, 0 owner-in-the-loop)** —
> l'apply du bundle prod (2 SealedSecrets + VAP + RBAC T1 + RO-role + CronJob dump)
> se fait **au merge sur `main`** (`.github/workflows/bascule-bundle-cd.yml`,
> cred permanent `KUBE_CONFIG_DATA_PROD` = SA `radar-ci-bascule-prod`), plus aucun
> token éphémère, plus aucun `kubectl apply` owner-direct, plus aucune
> matérialisation GH-secret des 2 creds (SealedSecrets committées, matérialisées
> par le controller sealed-secrets in-cluster). La bascule tourne en
> **planification hebdomadaire** (dimanche 03:17 UTC, `bascule-preprod.yml`, `schedule`) ; le refresh reste
> GH-triggerable à la demande (`bascule-refresh.yml`) et câblé APRÈS la bascule.
> Flux complet, install 1×, secrets GH devenus supprimables et gestes éliminés :
> **`CD_NATIVE_MIGRATION.md`**.

## RUNNER KUBECTL-ONLY (contrat owner + co-val i-infra, NON négociable)

**Contrainte dure : AUCUNE donnée PII, AUCUNE cred S3, AUCUN listing/clé ne
transite ni n'est lu par le runner GitHub.** Motif : OVH n'a **pas** de scope S3
list-only → toute cred S3 sur le runner pourrait `GET` le dump PII, quoi que
fasse le code. Donc **0 cred S3 runner**.

Le runner ne fait QUE :

- `kubectl` (2 kubeconfigs : **préprod** par défaut + **PROD** pour le seul
  trigger dump) : patch cronjob (suspend), dispatch + **OBSERVE `.status`** des
  Jobs, scale (quiesce), flip (set-env).
- `curl` `/health` (smoke S7 — ni S3 ni PII).

**Le runner ne lit JAMAIS `kubectl logs` ni le stdout d'un Job** (qui portent
clés/tables/listings) : il ne lit que `.status` (succeeded/failed). Runner
PII-free, **ses logs compris**. Debug = in-cluster.

**Tout l'accès object-store ET DB vit dans des Jobs PRÉPROD verdict-only** (creds
via `secretKeyRef` in-cluster, jamais d'URI mot-de-passe ; ils ne renvoient qu'un
exit code) : fetch/upload/copie/LIST/HEAD/dryrun. `pg_dump`/`pg_restore` (image
`postgis/postgis:16-3.4`) + S3 (`amazon/aws-cli`, déjà pinné in-repo) sont
in-cluster. dump prod = **CronJob owner** `radar-db-backup-prod` (HORS de ce
dossier). **0 pg_dump / 0 pg_restore / 0 s5cmd / 0 aws / 0 cred S3 sur le runner.**

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `bascule.mjs` | CLI Node kubectl-only : sous-commandes + gardes fail-closed + `classifyJobStatus` (verdict `.status`) + `dispatchS3Check`. |
| `s3-check-job.tmpl.yaml` | **(nouveau)** Patron générique des CHECKS S3 verdict-only (aws-cli) : `CHECK_MODE=freshness|recon|runs`. |
| `db-restore-job.tmpl.yaml` | Patron Job restore (S2) : initContainer `fetch` (aws-cli, **self-select** du dump frais) + `restore` (postgis, `pg_restore`). |
| `db-rollback-job.tmpl.yaml` | Patron Job rollback G1 : `dump` (postgis, pg_dump préprod) + `upload` (aws-cli → bucket). |
| `docs-sync-job.tmpl.yaml` | Patron Job docs-sync (S3/S4) `docs-sync-prod-to-preprod` : image radar-api, **aws-sdk `CopyObject`** server-side + `GrantFullControl` (Option A) ; Secret `radar-docs-src-preprod` pre-created by k8s (durable, no ownerReference), rewritten by the bascule before the quiesce. |
| `db-migrate-job.tmpl.yaml` | Patron Job migrate (S2c), `node dist/db/migrate.js`. |
| `refresh-job.tmpl.yaml` | Patron Job refresh différentiel (S6), worker-live delta. |
| `bascule.selftest.mjs` | Self-test de `classifyJobStatus` (0 appel réel). |
| `restore-mode.mjs` | `MODE=restore\|list` runner side (restore FROM a daily backup) — section "Restore from a backup". |
| `backup-restore.cjs` | In-pod steps resolve / list / fetch-dump / docs / recon (embedded in the 3 templates below). |
| `backup-read-job.tmpl.yaml` · `db-restore-backup-job.tmpl.yaml` · `docs-restore-backup-job.tmpl.yaml` | Jobs of `MODE=restore\|list`. |
| `ci-secrets.mjs` | `docs-secret-fill` / `backup-secrets-fill`: the bascule rewrites its pre-created Secrets (`radar-docs-src-preprod`, `radar-backup-reader-preprod`, `radar-backup-restore-docs`) from the GitHub environment `radar-bascule`. |
| `served-refs-job.tmpl.yaml` · `served-refs.cjs` · `e2e-refs.mjs` · `served-refs-configmaps.yaml` | e2e O1: zone references read-only from the restored DB → ConfigMaps → artefact `immo-served-refs-<CYCLE_ID>`. |
| `served-ids.mjs` | e2e contract: `immo-served-canonical-ids-<CYCLE_ID>` + `cycle-leg-immo-<CYCLE_ID>`. |
| `rbac-ci-bascule-preprod-docs-secret.yaml` · `rbac-ci-bascule-preprod-pods-read.yaml` | RBAC additions for SA `radar-ci-bascule-preprod` (k8s applies after review). |
| `restore-mode.selftest.mjs` | Offline selftest of all of the above (+ workflow wiring). |
| `../../../.github/workflows/bascule-preprod.yml` | `workflow_dispatch` S0→S7. |
| *(NON créé ici)* CronJob `radar-db-backup-prod` | **owner/k8s-délivré**, HORS de ce dossier. `pg_dump --format=custom` prod → `s3://radar-immobilier-backups-preprod/postgres/prod/sets/<ts>/radar.dump`. |

## Séquence (S0→S7)

| Pas | Sous-commande | Ce qui se passe | Où |
| --- | --- | --- | --- |
| G3 | `confirm` | `CONFIRM` = `iso-prod-<today UTC>`, first action of **every** MODE (chain, restore, list; DRY included), before any kubectl write, Secret write or Job; re-checked by the CLI before each Secret write and each Job. | runner |
| S0 | `preflight` | binaires runner (`node kubectl curl`) + params (dont `DUMP_BUCKET`, `BHS`) ; **0 cred S3/DB runner**. | runner |
| S0.s | `docs-secret-fill` | rewrites the pre-created Secret `radar-docs-src-preprod` from the environment `radar-bascule` **before the quiesce** (DRY: `--check`, server dry-run only, nothing written) — a missing GitHub secret, Secret or RBAC fails before any destructive step. | kubectl |
| Q | `quiesce` | enregistre les replicas d'origine → scale 0 + suspend cronjobs + attend le drain (pour G2). | préprod (kubectl) |
| S1 | `dump` | **DÉCLENCHEUR T1** : `kubectl --kubeconfig $DUMP_KUBECONFIG patch cronjob radar-db-backup-prod suspend=false` (**cluster PROD**, dual-kubeconfig) ; puis **Job freshness** (aws-cli, poll INTERNE : LastModified epoch > T1, clé ⊇ EXPECTED_DATABASE, `.dump`, Size>0 → exit 0/1) ; **re-suspend** toujours (best-effort). Runner lit `.status`, 0 S3 runner. | runner (kubectl) + Job |
| S2 | `restore` | **G2 quiesce** puis **G1 Job rollback** (pg_dump préprod → bucket) puis **Job restore** (fetch **self-select** du dump frais + `pg_restore --clean --if-exists --single-transaction`). 0 S3/DB runner. | préprod (Jobs) |
| S2c | `migrate` | Job `node dist/db/migrate.js` (image préprod exacte) = test iso-prod. | préprod (Job) |
| S3/S4 | `copy-docs` | **Job radar-api aws-sdk** (Option A, `docs-sync-prod-to-preprod`) : pré-check GET prod fail-closed + boucle `CopyObject` server-side additif **+ `GrantFullControl`** (→ canonical préprod). Identité prod-owner `radar-docs-src-preprod` (durable Secret, rewritten at S0.s). DRY : copie NON jouée (0 S3 runner). | préprod (Job) |
| S3b | `recon` | **Job DIFF LIST-only** (verdict-only, 0 HEAD/GET) : dual `s3api list-objects-v2` src+dst, compare **Key+Size** (ETag ignoré : docs content-addressed par sha ⇒ robuste au re-chunk multipart) → dest ⊇ src → exit 0, sinon exit 1. Écrit un sentinel LOCAL `recon.ok.json` (verdict). | préprod (Job) |
| S3c | `precheck-runs` | **Job aws s3api list runs/** (verdict-only) : `runs/` vide → exit 1. | préprod (Job) |
| S5 | `flip` | `kubectl set env deploy/radar-api GEO_DOCUMENTS_REPOINT-` (défaut OFF = iso-prod, réversible). | préprod (kubectl) |
| U | `unquiesce` | scale-back aux replicas enregistrés + `rollout status` ; restaure suspend. `if: always()`, sans CONFIRM. **No quiesce recorded in this run ⇒ no-op** (the `UNQUIESCE_REPLICAS` map only applies with `SKIP_QUIESCE=true`). | préprod (kubectl) |
| S6 | `refresh` | Job worker-live **delta** (PAS `--all`) ; assert `ConfigMap SCRAPE_S3_BUCKET == PREPROD_DOCS` (MEDIUM2, kubectl) + Job runs/ (MEDIUM3). | préprod (Job) |
| S7 | `smoke` | `curl préprod/health` ; `db.ok` + `objectStore.ok` exigés. | runner (curl) |

Ordre workflow : **G3** → S0 → **S0.s (docs-sync Secret)** → **S0.b (`precheck-runs --prod`, Job advisory)** → **Q** (+ artefact `bascule-quiesce-state-<run_id>`) → S1 → S2 → S2c → S3 → S3b → S5 → **U (`always`)** → **S3c (Job gate)** → S6 → S7 → failure summary (`failure()` after a successful S2) → upload pointeurs (`always`).

### Timeouts and the un-quiesce

- Job budget per MODE: **chain 180 min**, **restore 330 min** (cap 360), above the
  sum of the runner-side Job waits (restore ≈ 260 min: R0 10 + quiesce 5 + G1 20 +
  restore 30 + migrate 15 + docs 125 + recon 15 + G4 recon 15 + un-quiesce 10 +
  served-refs 15). A hung Job ends by its own Node timeout: a **step failure**, after
  which the `always()` un-quiesce runs with its full budget (step `timeout-minutes: 15`).
- A **job-level timeout** is a GitHub **cancellation**: `always()` steps are still
  started, but only within a short grace period, so the un-quiesce (rollout waits)
  is **not guaranteed** to finish (not exercised by a real run: no workflow launched).
  Recovery: download the artefact `bascule-quiesce-state-<run_id>` (uploaded right
  after the quiesce), put `quiesce-state.json` in an empty `BASCULE_WORKDIR`, then
  `node deploy/ci/bascule-preprod/bascule.mjs unquiesce` (same vars as the job).

### Failure after S2 (inherited from the chain — behaviour unchanged)

When a step fails **after a successful S2**, the un-quiesce puts preprod back in
service on the database of day D (restore: the backup date; chain: the prod dump of
T1) while docs/recon/flip may be incomplete, and nothing rolls back automatically.
The step "Failure after S2 — summary" (`failure-summary`) states it in the run
summary ("Preprod back in service on a database at day D — docs/flip INCOMPLETE",
or "NOT back in service" when the un-quiesce failed) with the outcome of each step
and the **G1 rollback procedure** for the exact key of this run:

```bash
export BASCULE_WORKDIR="$(mktemp -d)" MODE=chain CONFIRM="iso-prod-$(date -u +%F)" CONFIRM_EXPECTED="iso-prod-$(date -u +%F)"
export DUMP_BUCKET=<bucket> EXPECTED_DATABASE=<db> BHS=<endpoint> PREPROD_NAMESPACE=<ns>
node deploy/ci/bascule-preprod/bascule.mjs quiesce
DUMP_PREFIX=<rollback key> T1_EPOCH=0 DUMP_KEY_ASSERT_DB=0 node deploy/ci/bascule-preprod/bascule.mjs restore
node deploy/ci/bascule-preprod/bascule.mjs unquiesce
```

`restore` first takes a new G1 rollback of the current state (a new key, never
matched by the exact `DUMP_PREFIX`). Debt: no automatic rollback (noted in the PR).

## Gardes fail-closed (clé OPS-3), et comment elles sont ADAPTÉES

- **STATUS-ONLY (mesure i-infra) :** `runJobFromTemplate` lit UNIQUEMENT `.status`
  (via `classifyJobStatus`) — **0 `kubectl logs`**, sur échec/timeout il reporte
  « inspecter in-cluster » (le debug se fait au cluster). Pour TOUS les Jobs
  (freshness/recon/runs/restore/rollback/docs-sync/migrate/refresh).
- **G1 — rollback avant restore (Job préprod).** `restore` dispatche
  `radar-db-rollback-bascule` (pg_dump préprod → `s3://$DUMP_BUCKET/rollback/…`,
  DURABLE). Fail-closed : pas de restore sans rollback réussi. DB via
  `radar-db-credentials`, écriture S3 via `radar-pra-admin` (S3-only).
- **G2 — quiesce vérifié (Jobs `bascule` exclus).** scale 0 + suspend + 0 Job
  batch actif **SAUF** les Jobs labelisés `sentropic.io/bascule`. **Choix = les
  DEUX** : quiesce ordonné AVANT tout dispatch + exclusion `bascule` du check.
- **G3 — CONFIRM explicite.** `CONFIRM=iso-prod-AAAA-MM-JJ`, recoupé au jour (anti-rejeu).
- **G4 — flip seulement si recon OK.** Sentinel LOCAL (verdict) + **re-dispatch**
  du Job recon juste avant le flip. 0 listing runner.
- **EXPECTED_DATABASE — contrôle POSITIF hors runner, fail-closed in-cluster :**
  (a) Jobs freshness/restore : la clé du dump frais ⊇ EXPECTED_DATABASE ;
  (b) Job restore : header du custom-archive (`;   dbname:`) == EXPECTED_DATABASE ;
  (c) CronJob owner : dumpe la DB **nommée** EXPECTED_DATABASE.
- **MEDIUM 2 (kubectl, pas S3) :** `refresh` exige `ConfigMap radar-api.SCRAPE_S3_BUCKET
  == PREPROD_DOCS`. **MEDIUM 3 :** Job runs/ verdict-only avant S6.

## Matrice « quel secret / où » (runner vs cluster)

**Runner GitHub** — kubectl-only, 0 cred S3/DB :

| Clé | Type | Contenu / usage |
| --- | --- | --- |
| `KUBE_CONFIG_DATA_BASCULE_PREPROD` | secret | kubeconfig base64 **préprod** — token **DÉDIÉ moindre-privilège** (SA `radar-ci-bascule-preprod`), **PAS** le secret partagé `KUBE_CONFIG_DATA` (scope plus large : build-push-images / run-job / k8s-apply-mcp / rollback). Pilotage par défaut. |
| `KUBE_CONFIG_DATA_PROD_TRIGGER` | secret | kubeconfig base64 **PROD** (token name-scopé patch `radar-db-backup-prod` + VAP suspend-only, SA `radar-ci-trigger-prod`) → `DUMP_KUBECONFIG`, utilisé **UNIQUEMENT** sur les 2 patch cronjob prod. Non requis en DRY. **Renommé v2** (le nom `KUBE_CONFIG_DATA_PROD` désigne désormais la SA d'apply du bundle). |
| `BHS` / `S3_REGION` / `PROD_DOCS` / `PREPROD_DOCS` / `DUMP_BUCKET` / `DUMP_PREFIX` | var | endpoint + buckets + préfixe dump (`postgres/prod/sets`), rendus dans les Jobs. **NON secrets.** |
| `DUMP_CRONJOB` / `DUMP_CRONJOB_NAMESPACE` | var | CronJob dump owner (défauts `radar-db-backup-prod` / `radar-immobilier`). |
| `DOCS_SYNC_READ_SECRET` / `DOCS_SYNC_GRANTEE` | var | nom du Secret docs-sync (`radar-docs-src-preprod`, pre-created by k8s, durable, rewritten by the bascule) + canonical id du `GrantFullControl` (défaut `1901410700457444:user-Wq74B63YQum8`). **NON secrets** (nom + id, pas de valeur cred). |
| `EXPECTED_DATABASE` / `PREPROD_NAMESPACE` / `PREPROD_HEALTH_URL` / `EXPECTED_KUBE_APISERVER_HOST[_PROD]` / `UNQUIESCE_REPLICAS` | var | DB attendue / cible cluster / smoke / pré-vol / repli un-quiesce. |

**RETIRÉS du runner :** `BASCULE_PROD_PG*` (5), `BASCULE_PREPROD_PG*` (5),
`BASCULE_DOCS_AWS_*`, **et `BASCULE_S3_LIST_AWS_*` (0 cred S3 runner)** — plus
aucun `AWS_*` ni secret S3/DB côté runner. Plus d'install `s5cmd`/postgresql-client.

**In-cluster (Secrets préprod, référencés par les Jobs via `secretKeyRef`)** —
0 secret touché/minté par ce patch, juste référencé :

| Secret | Job(s) | Clés attendues | Usage |
| --- | --- | --- | --- |
| `radar-pra-admin` | restore (fetch), rollback (upload) | `S3_ACCESS_KEY`/`S3_SECRET_KEY` — **S3 SEULEMENT** (mesure k8s, PAS de POSTGRES_*) | fetch/upload S3 du bucket backups. |
| `radar-db-credentials` | restore, rollback, migrate | `POSTGRES_USER/PASSWORD/DB` (user préprod `radar` = superuser → `--clean` OK) | libpq PG* du pg_restore/pg_dump. |
| `radar-docs-src-preprod` | **docs-sync UNIQUEMENT** (`docs-sync-prod-to-preprod`) | `S3_ACCESS_KEY`/`S3_SECRET_KEY` (identité **prod-owner** immo-docs-prod) | LECTURE docs PROD + rw préprod + CopyObject. **Pre-created by k8s** (Opaque, no ownerReference); **rewritten by the bascule at every run** before the quiesce from the GitHub environment `radar-bascule` (see "docs-sync Secret" below). **Jamais référencé par les Jobs de check**. |
| `radar-backups-reader-preprod` | **Job freshness (S1)** | `S3_ACCESS_KEY`/`S3_SECRET_KEY` | RO-reader PERSISTANT du bucket backups (LIST/HEAD). Var `FRESHNESS_CHECK_SECRET`. |
| `radar-docs-s3-credentials` | **migrate (S2c) + refresh (S6)** | `DOCS_S3_ACCESS_KEY`/`DOCS_S3_SECRET_KEY` | creds S3 applicatifs — **aligné sur `radar-refresh-pv` QUI MARCHE (#738)** (l'ancien défaut `radar-s3-credentials` a un access-key bidon, `radar-scrape-s3-credentials` est absent en préprod = RUN blocker corrigé). Vars `S3_SECRET`/`SCRAPE_S3_SECRET`. |
| `radar-s3-credentials` **(⚠ access-key bidon, cf. QA#6)** | Jobs recon (S3b) + runs/ (S3c) — via `CHECK_DOCS_SECRET` | `S3_ACCESS_KEY`/`S3_SECRET_KEY` | LIST prod+préprod docs. **DRY#4 a réussi avec `radar-docs-reader-preprod`** (RO-reader) → défaut `CHECK_DOCS_SECRET` à trancher (cf. QA#6). |

> **0 Python, 0 image nouvelle non validée.** Runner : kubectl + curl. Jobs :
> `postgis/postgis:16-3.4` (pg_dump/pg_restore 16) + `amazon/aws-cli` (LIST/HEAD/
> cp/sync — déjà pinné in-repo, cf. `object-storage-inventory-preprod`). Jobs
> migrate/refresh : image radar-api exacte servie en préprod.

## Docs-sync — Option A CANONIQUE (aws-sdk CopyObject, co-val k8s)

Le Job **`docs-sync-prod-to-preprod`** tourne dans
l'**image radar-api** (aws-sdk `@aws-sdk/client-s3`, 0 python) et utilise
l'identité **prod-owner** `radar-docs-src-preprod` (creds immo-docs-prod) :

1. **pré-check GET fail-closed** : `HeadObject` d'un objet prod (l'owner passe,
   sinon exit 1) ;
2. boucle `ListObjectsV2(prod, prefix?)` → `CopyObject(préprod, MÊME clé,
   GrantFullControl id=$COPY_GRANTEE)` = CopyObject **server-side** (0 octet par
   le pod), **additif** (pas de delete), **idempotent**. Le `GrantFullControl`
   explicite (canonical radar-docs préprod) rend les objets copiés **lisibles par
   l'API préprod** (sinon 403 propagé).

### docs-sync Secret — rewritten by the bascule (owner rule 2026-09-26)

No k8s watcher any more (a scheduled run failed on S3 when nobody created the
Secret). The Secret `radar-docs-src-preprod` (ns `radar-immobilier-preprod`) is
**pre-created by k8s** (Opaque, keys `S3_ACCESS_KEY` + `S3_SECRET_KEY` only, no
ownerReference) and the bascule **rewrites it at every run, before the quiesce**
and any destructive step (step `S0.s`, subcommand `docs-secret-fill`,
`ci-secrets.mjs`; `DRY_RUN`: `docs-secret-fill --check`, server dry-run only):

1. the job `bascule` runs in the GitHub **environment `radar-bascule`** (main-only),
   secrets `RADAR_DOCS_SYNC_ACCESS_KEY` / `RADAR_DOCS_SYNC_SECRET_KEY` (32–64
   lowercase hex, one line), passed through the step `env:` only (never
   interpolated in `run:`, no `set -x`);
2. guard `^[0-9a-f]{32,64}$` on both values — fail-closed before any kubectl call;
3. `kubectl get` of the Secret labels/annotations, then `kubectl replace
   --dry-run=server -f` and `kubectl replace -f` of a JSON manifest written 0600
   in a 0700 temp dir (removed in `finally`); nothing in argv or logs, kubectl
   output captured and redacted;
4. **not blanked** at the end: the credential is durable and least-privilege
   (read-only on prod docs, write without delete on preprod docs); rewriting it at
   every run means a crashed run never leaves an empty Secret.

RBAC (k8s applies after review): `rbac-ci-bascule-preprod-docs-secret.yaml` — SA
`radar-ci-bascule-preprod`, `secrets` verbs `get`,`update`, `resourceNames:
["radar-docs-src-preprod", "radar-backup-reader-preprod", "radar-backup-restore-docs"]`
(the two backup identities: section "Restore from a backup"), nothing else on
Secrets. Never a SealedSecret.

## Rejouer SANS IA

1. **DRY (défaut, sûr).** `CONFIRM=iso-prod-<aujourd'hui>`, `DRY_RUN=true` :
   G3 + `preflight` + docs-sync Secret `--check` (server dry-run) + Jobs
   recon/advisory-runs (read-only, `continue-on-error`) + `smoke`. **Aucune écriture
   de données, aucune copie réelle.** Note `MODE=restore|list`: a DRY run still
   **writes the backup Secrets** (same values, needed by the read-only Jobs) and runs
   R0 (read-only Job) — see "Restore from a backup".
2. **Exécution.** `DRY_RUN=false` + `CONFIRM=iso-prod-<date du jour UTC>`. quiesce
   automatisé + un-quiesce `if: always()` (jamais préprod à terre).
3. **Isolation S5/S6** : `SKIP_FLIP` / `SKIP_REFRESH`.
4. **Quiesce manuel** : `SKIP_QUIESCE=true` + `BASCULE_UNQUIESCE_REPLICAS=radar-api=1,radar-immo-mcp=1`
   (the map is applied ONLY with `SKIP_QUIESCE=true`; without it and without a
   recorded quiesce, the un-quiesce does nothing).
5. **Rollback DURABLE.** Dumps (prod S1 + rollback G1) dans
   `s3://radar-immobilier-backups-preprod` (durables). Pointeurs (T1, clés,
   quiesce/recon) uploadés en artefact GitHub `bascule-rollback-<run_id>` (7 j).
   Restaurer : rejouer le Job restore ciblant `ROLLBACK_KEY` (le patron fait le
   `pg_restore --clean --if-exists --single-transaction` in-cluster).

## Points à trancher en QA (source-gaps — non déterminables par lecture)

1. **Kubeconfig PROD du trigger (résolu par dual-kubeconfig).** Le CronJob dump
   reste en PROD (`radar-immobilier`) ; le RBAC ci-deployer préprod exclut la prod
   (`deploy/k8s/11-ci-deployer-preprod-rbac.yaml`) → patch préprod = 403. S1 passe
   par `DUMP_KUBECONFIG` (secret `KUBE_CONFIG_DATA_PROD_TRIGGER` : token name-scopé
   patch `radar-db-backup-prod` + **VAP suspend-only**, minté à l'install). Fail-closed
   si absent. DRY ne trigger pas.
2. **Convention de clé dump (figée k8s) :** `postgres/prod/sets/<ISO-ts>/radar.dump`
   → `DUMP_PREFIX=postgres/prod/sets`, listing **récursif** (list-objects-v2 est
   récursif). Le Job freshness/restore matche `radar` (EXPECTED_DATABASE) + `.dump`.
   Dump owner = `pg_dump --format=custom --no-owner --no-privileges` (contrat).
3. **Secrets in-cluster à provisionner (owner/immo, 0 minté ici) :**
   `radar-pra-admin` (S3-only, RW backups, restore/rollback) ;
   `radar-backups-reader-preprod` (RO-reader **PERSISTANT** backups, Job freshness ;
   var `FRESHNESS_CHECK_SECRET`) ; `radar-s3-credentials` (**PERSISTANT**, LIST
   prod+préprod docs, Jobs recon + runs/ ; var `CHECK_DOCS_SECRET`) ;
   `radar-docs-src-preprod` (prod-owner, docs-sync uniquement). Tous
   clés `S3_ACCESS_KEY`/`S3_SECRET_KEY`. **Les Jobs de check ne réfèrent JAMAIS le
   secret docs-sync** (sinon CreateContainerConfigError aux pas de check — bug
   attrapé en DRY). Clés/nom à confirmer (sinon régler les vars ci-dessus).
   - **`radar-docs-src-preprod`** : pre-created by k8s, **rewritten by the bascule
     at every run** from the GitHub environment `radar-bascule` (section
     "docs-sync Secret" above; RBAC `rbac-ci-bascule-preprod-docs-secret.yaml`).
     No k8s watcher.
4. **Grant docs-sync sur OVH BHS.** `DOCS_SYNC_GRANTEE` = canonical id radar-docs
   préprod (défaut `1901410700457444:user-Wq74B63YQum8`). **Item DRY** : vérifier
   que l'endpoint OVH BHS honore bien `CopyObject` avec `GrantFullControl` (ACL S3
   par objet) ; sinon l'API préprod pourrait 403 sur les objets copiés (à traiter
   avec i-infra). `forcePathStyle` par défaut `true` (`DOCS_S3_FORCE_PATH_STYLE`).
5. **user préprod `radar` superuser** (pour `pg_restore --clean --if-exists`) — à confirmer.
6. **Secret des Jobs de CHECK (recon/runs).** Défaut `CHECK_DOCS_SECRET=radar-s3-credentials`
   — or **k8s LIVE dit que `radar-s3-credentials/S3_ACCESS_KEY` est BIDON** (seul S6
   le lisait, corrigé) et **DRY#4 a fait passer recon+runs avec `radar-docs-reader-preprod`**
   (RO-reader). → **À trancher** : basculer le défaut `CHECK_DOCS_SECRET` sur
   `radar-docs-reader-preprod` (LIVE-confirmé) plutôt que `radar-s3-credentials`
   (bidon). Non changé ici (hors scope du fix S6/migrate demandé) mais overridable
   via `CHECK_DOCS_SECRET` ; sinon recon/runs échoueraient au RUN sans override.

## MEDIUM 2 / MEDIUM 3

- **MEDIUM 2** (classe du bug Farid, kubectl pas S3) : `refresh` exige
  `ConfigMap radar-api.SCRAPE_S3_BUCKET == PREPROD_DOCS` (sinon PV écrits hors
  served bucket → re-404). Échappatoire `ASSERT_REFRESH_BUCKET=0`.
- **MEDIUM 3** (mémoire de collecte) : le delta S6 n'est un delta que si `runs/`
  est présent dans PREPROD_DOCS. Job runs/ verdict-only (gate PREPROD_DOCS ;
  advisory PROD_DOCS). Défense en profondeur : `refresh` re-dispatche le Job runs/.
  Échappatoire `ASSERT_RUNS_MEMORY=0`.

## Restore from a backup — `MODE=restore` / `MODE=list`

Workflow input `MODE`: `chain` (default, and always for a scheduled run: live
dump S1, sequence above, unchanged) | `restore` (restore preprod FROM a daily
backup of `radar-immobilier-backup`, see `../backup/`) | `list` (read-only).
Logic: `restore-mode.mjs` (runner, kubectl only) + `backup-restore.cjs` (in-pod
steps, embedded verbatim in the Job templates with `node -e`, image radar-api =
Node + `@aws-sdk/client-s3`, 0 python, 0 new image). The scheduled restore stays
frozen by `BASCULE_SCHEDULE_ENABLED=false` (untouched).

### Inputs

| Input | Values | Effect |
| --- | --- | --- |
| `MODE` | `chain` \| `restore` \| `list` | see above |
| `BACKUP_ID` | `latest` (default) \| `YYYY-MM-DD` | `latest` = `manifests/latest.json` → `latestComplete` (never the newest partial/incomplete); a date = `manifests/<D>.json` |
| `ALLOW_STALE_BACKUP` | `false` (default) \| `true` | accept a `latest` older than 24 h |
| `CYCLE_ID` | empty \| `^[A-Za-z0-9._-]{1,100}$` | e2e contract (orchestrator `bascule-e2e.yml`) |
| `CONFIRM` / `DRY_RUN` | unchanged | G3 anti-replay unchanged; `DRY_RUN=true` = read-only |

### Sequence (`MODE=restore`)

| Step | Subcommand | What happens | Where |
| --- | --- | --- | --- |
| G3 | `confirm` | `CONFIRM` anti-replay, **every MODE** (list included), before any Secret write or Job; re-checked by `preflight-backup`, each Secret write and each Job | runner |
| S0 | `preflight-backup` | binaries, params (`EXPECTED_DATABASE`, `BHS`, **`PROD_DOCS` required**, `PREPROD_DOCS`, `DUMP_BUCKET`), `BACKUP_ID`/`CYCLE_ID` format; forbidden docs destinations = the frozen production docs bucket `radar-immobilier-docs` + `PROD_DOCS` + the backup bucket (+ `BACKUP_FORBIDDEN_DST_BUCKETS`), never empty; `PREPROD_DOCS` among them ⇒ refusal. The in-pod step refuses an empty list too | runner |
| S0.s | `backup-secrets-fill` | rewrites the pre-created Secrets `radar-backup-reader-preprod` (and, in restore, `radar-backup-restore-docs`) from the environment `radar-bascule` (see "Identities" below) | kubectl |
| R0 | `backup-resolve` | **read-only Job, BEFORE the quiesce**: `BACKUP_ID` → date D; refuses unless `status: complete`; `latest` older than 24 h (age = `pg.dumpStartedAt`, the RPO point) refused unless `ALLOW_STALE_BACKUP=true`; an explicit date is never blocked by its age (logged); `.sha256` sidecar = manifest `pg.sha256`, dump size = manifest, inventory present. Writes the **PIN** `backup-pin.json` (D + manifest sha256 + dump sha256) | Job `radar-bascule-backup-resolve` |
| Q | `quiesce` | unchanged | kubectl |
| S2 | `restore-backup` | G3, **G2** quiesce, **G1** rollback of the preprod DB (same Job as chain), then Job: `fetch` (re-reads `manifests/<D>.json`, sha256 must equal the PIN — a same-day manual backup re-run rewrites it; downloads `pg/<D>/radar.dump` by its manifest version id streaming a sha256; refuses unless it equals manifest = sidecar = PIN) → `restore` (`pg_restore --list`: TOC entries = manifest, archive dbname = `EXPECTED_DATABASE`; `pg_restore --clean --if-exists --single-transaction --exit-on-error`). **No S1** | Job `radar-db-restore-backup` |
| S2c | `migrate` | unchanged (delta migrations of `main` on the data of D) | Job |
| S3' | `docs-restore` | G3; docs state **at D**: `docs-inventory/<D>.json` (reader; sha256 = manifest) + `ListObjectVersions(<backup>/docs/)` and preprod listing (copy signer) → every `backed-up` entry whose preprod copy is not already the same content (size + ETag) is copied **server-side** (`CopyObject`, 0 byte through the pod or the runner) from `<backup>/docs/<key>?versionId=<v>` — the recorded version, else the version whose ETag is the inventory's (object rewritten since D). If the version listing is refused: recorded versionIds used as is, the others copied only when the current backup copy has the inventory ETag + size (HEAD). Additive (no delete; preprod objects newer than D are kept and counted). Entries `excluded` by the backup itself (excluded prefixes, backup still `complete`) are treated as the backup treats them: not required, counted apart (`excluded`) and logged. Any other object not in the backup (`pending`, `failed`) or without a restorable version ⇒ refusal before the first copy | Job `radar-docs-restore-backup` |
| S3b' | `recon-backup` | preprod docs ⊇ inventory(D), Key + Size; writes the `recon.ok.json` sentinel (mode restore + D + manifest sha256) | Job `radar-bascule-recon-backup` |
| S5 | `flip` | **G4** = sentinel of THIS backup + `recon-backup` re-run | kubectl |
| U / S7 | `unquiesce` / `smoke` | unchanged | kubectl / curl |

No refresh in `MODE=restore` (a restore is a restore). `DRY_RUN=true` runs G3 +
S0 + S0.s (**the backup Secrets are still written** — same values; the read-only
Jobs need them) + R0 (read-only Job) + `docs-restore --dry` (plan only: every
inventory object restorable?) + S7. No quiesce, no restore, no copy.
`MODE=list` runs S0 + Job `radar-bascule-backup-list` (every dated manifest still
listed: date, status, dump size, schema migrations + last tag, dump sha256 (16),
docs objects, served code; `*` = latest complete), printed in the log and the step
summary, and uploaded as artefact `backup-list-immo-<CYCLE_ID|run_id>`
(`backup-list.json`, format `radar-backup-list/v1`).

### How the runner learns D without touching S3

The runner stays kubectl-only (0 S3 credential). Each backup Job writes its
verdict JSON (≤ 4 KiB: dates, statuses, sizes, sha256, counts — never a doc key,
a row or a credential) to its container **termination message**; the runner reads
it from the pod `.status` (`kubectl get pods -l job-name=<job> -o json`), never
`kubectl logs`, and **only from the pods of the Job instance it just created**
(uid read after the apply; a pod is kept when its controller ownerReference or its
`controller-uid` label carries that uid — a pod of a deleted previous instance of
the same Job name is never read; no uid ⇒ no verdict). A refusal reason (e.g. stale
backup) is printed from there.

`MODE=list` limit: the list travels in that termination message (≤ 4 KiB), so it
holds the **newest ~15 dated backups** (`truncated: true` beyond; the retention
keeps at most 16 visible, `../backup/RETENTION.md`). A date older than the listed
window cannot be confirmed from the list: the e2e orchestrator refuses it cleanly
(it asks for a date inside the window); a standalone `MODE=restore BACKUP_ID=<date>`
still resolves any date directly from `manifests/<date>.json`.

### Identities, Secrets, RBAC, network (what k8s provides)

Dedicated preprod identities (created and tested by the k8s lane 2026-09-26).
**OVH:** `s3:GetObjectVersion` is refused in OVH policies — a versioned read is a
`GetObject` / `CopyObject` with `versionId`, covered by `GetObject`; nothing here
relies on a distinct version permission.

| Item | Where | Content | Used by |
| --- | --- | --- | --- |
| Secret **`radar-backup-reader-preprod`** (OVH user 809853) | ns `radar-immobilier-preprod`, pre-created Opaque | keys `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET` (= `radar-immobilier-backup`); `GetObject` on `pg/*`, `manifests/*`, `docs-inventory/*` + `ListBucket` (`docs/` → 403) | R0, list, S2 fetch, S3'/S3b' manifest + inventory |
| Secret **`radar-backup-restore-docs`** (OVH user `radar-backup-restore-preprod`, 809849) | ns `radar-immobilier-preprod`, pre-created Opaque | same keys; `GetObject` on `radar-immobilier-backup/docs/*` (+ version listing when granted), `ListBucket` + `GetBucketLocation` + `PutObject` + `PutObjectAcl` on the preprod docs bucket, no delete (k8s check 2026-09-26: effective policy + real LIST 200) — the versioned `CopyObject` with `GrantFullControl` answers 200 | S3' (signer of the copies), S3b' (preprod listing) |
| their material | GitHub environment **`radar-bascule`** (main-only): `RADAR_BACKUP_READER_PREPROD_ACCESS_KEY`/`_SECRET_KEY`, `RADAR_BACKUP_RESTORE_DOCS_ACCESS_KEY`/`_SECRET_KEY` (+ `.env` recovery copy; rotation 90 days, `CRED_CYCLE.md`) | **rewritten by the bascule** before first use (step "Write backup Secrets", `ci-secrets.mjs`): `kubectl replace --dry-run=server` then `kubectl replace` on the pre-created Secrets — never `create`/`apply` (RBAC by resourceNames), never a SealedSecret; keys guarded `^[0-9a-f]{32,64}$`, `BACKUP_BUCKET` = fixed var value | bascule job |
| RBAC `radar-ci-bascule-preprod` | `rbac-ci-bascule-preprod-docs-secret.yaml` | secrets get/update on `radar-docs-src-preprod`, `radar-backup-reader-preprod`, `radar-backup-restore-docs`; configmaps get on `immo-served-refs-0..3` | Secret writes, e2e O1 |
| RBAC `radar-ci-bascule-preprod` | `rbac-ci-bascule-preprod-pods-read.yaml` | `pods` get/list (read the termination messages) — no `pods/log` | R0, list, failure reasons |
| SA `radar-bascule-refs-writer` + 4 ConfigMaps | `rbac-ci-bascule-preprod-docs-secret.yaml`, `served-refs-configmaps.yaml` | configmaps get/update on `immo-served-refs-0..3` (pre-created, create is not name-scopable) | e2e O1 served-refs Job |
| NetworkPolicy | ns `radar-immobilier-preprod` | the restore Jobs carry `sentropic.io/bascule` → `radar-postgres:5432` already open by `allow-bascule-to-postgres`; **egress**: no egress policy today; if one is added, the pods labelled `sentropic.io/bascule` need TCP 443 to the S3 endpoint (`s3.bhs.io.cloud.ovh.net`) + DNS, and the served-refs pod the API server | all backup Jobs |

Repo variables (optional): `BASCULE_BACKUP_BUCKET` (`radar-immobilier-backup`),
`BASCULE_BACKUP_READER_SECRET` (`radar-backup-reader-preprod`),
`BASCULE_BACKUP_DOCS_COPY_SECRET` (`radar-backup-restore-docs`, no fallback on the
reader), `BASCULE_BACKUP_MAX_AGE_HOURS` (24).

### e2e contract (`CYCLE_ID` set)

- **O1 — zone references immo holds (decision: no HTTP endpoint).** After S7,
  step `served-refs` dispatches the Job `radar-bascule-served-refs`: `extract`
  (psql, `default_transaction_read_only=on`) reads the RESTORED preprod database —
  canonical zone ids referenced by `geo_resolutions` (`target_type = 'Zone'`),
  `opportunity_dossiers.zone_canonical_id`, `constraint_hits` (`target_kind =
  'zone'`) and the current `zone_versions` referential — and outputs the distinct
  `(city_slug, zone_code)`: `zone_versions.city_slug` + `code_affiche` when the
  canonical id is known there, else parsed from `ogc:zones:<city>:<code>`. **Fact:
  immo does not persist the raw OGC zone code** (`code_affiche` holds
  `normalizeZoneCode(raw)`), so the geo builder re-canonicalises immo's normalised
  code; a residual divergence of that lossy step shows up as `divergent-code`.
  `publish` (served-refs.cjs) gzips the TSV (a few hundred KiB expected) and
  rewrites the pre-created ConfigMaps `immo-served-refs-0..3` (≤ 900 KiB each) with
  the SA `radar-bascule-refs-writer`; the runner reads them (configmaps get),
  checks CYCLE_ID + sha256 + row count and uploads `immo-served-refs-<CYCLE_ID>`.
- `MODE=restore|chain`: job `served-ids` (no cluster credential) builds
  `immo-served-canonical-ids-<CYCLE_ID>` (`served-ids.txt` + `.sha256` + meta, zone
  ids through the published `@sentropic/geo@0.6.2`, same pin as the geo leg) from
  that artefact; job `cycle-leg` (always) publishes `cycle-leg-immo-<CYCLE_ID>`
  (`legs.immo`: run, sha, MODE, backup id/date/manifest+dump sha256, `t1` = backup
  dump start, verdict pg/s3).
- `MODE=list`: artefact `backup-list-immo-<CYCLE_ID>`.
- The run name is `bascule-preprod <MODE> <CYCLE_ID>` (orchestrator correlation).

## Lancer une sous-commande à la main (hors workflow)

```bash
# mêmes variables d'env que le workflow (voir matrice) — 0 cred S3/DB runner
node deploy/ci/bascule-preprod/bascule.mjs preflight
node deploy/ci/bascule-preprod/bascule.mjs precheck-runs --prod   # Job advisory (PROD_DOCS)
node deploy/ci/bascule-preprod/bascule.mjs precheck-runs          # Job gate (PREPROD_DOCS)
node deploy/ci/bascule-preprod/bascule.selftest.mjs               # self-test classifyJobStatus (0 appel réel)
node deploy/ci/bascule-preprod/restore-mode.selftest.mjs          # MODE=restore|list + docs-sync Secret + e2e (offline)
```
