# bascule-preprod — bascule PROD → PRÉPROD (« iso-prod »)

Bascule **rejouable par la CI immo / l'owner SANS IA** (OPS-3) : déclencheur dump
prod → restore préprod → migrations → copie docs → recon → flip serving → refresh
différentiel → smoke. **0 Python.**

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
| `docs-sync-job.tmpl.yaml` | Patron Job docs-sync (S3/S4) `docs-sync-prod-to-preprod` : image radar-api, **aws-sdk `CopyObject`** server-side + `GrantFullControl` (Option A) ; secret éphémère GC ownerRef. |
| `db-migrate-job.tmpl.yaml` | Patron Job migrate (S2c), `node dist/db/migrate.js`. |
| `refresh-job.tmpl.yaml` | Patron Job refresh différentiel (S6), worker-live delta. |
| `bascule.selftest.mjs` | Self-test de `classifyJobStatus` (0 appel réel). |
| `../../../.github/workflows/bascule-preprod.yml` | `workflow_dispatch` S0→S7. |
| *(NON créé ici)* CronJob `radar-db-backup-prod` | **owner/k8s-délivré**, HORS de ce dossier. `pg_dump --format=custom` prod → `s3://radar-immobilier-backups-preprod/postgres/prod/sets/<ts>/radar.dump`. |

## Séquence (S0→S7)

| Pas | Sous-commande | Ce qui se passe | Où |
| --- | --- | --- | --- |
| S0 | `preflight` | binaires runner (`node kubectl curl`) + params (dont `DUMP_BUCKET`, `BHS`) ; **0 cred S3/DB runner**. | runner |
| Q | `quiesce` | enregistre les replicas d'origine → scale 0 + suspend cronjobs + attend le drain (pour G2). | préprod (kubectl) |
| S1 | `dump` | **DÉCLENCHEUR T1** : `kubectl --kubeconfig $DUMP_KUBECONFIG patch cronjob radar-db-backup-prod suspend=false` (**cluster PROD**, dual-kubeconfig) ; puis **Job freshness** (aws-cli, poll INTERNE : LastModified epoch > T1, clé ⊇ EXPECTED_DATABASE, `.dump`, Size>0 → exit 0/1) ; **re-suspend** toujours (best-effort). Runner lit `.status`, 0 S3 runner. | runner (kubectl) + Job |
| S2 | `restore` | **G2 quiesce** puis **G1 Job rollback** (pg_dump préprod → bucket) puis **Job restore** (fetch **self-select** du dump frais + `pg_restore --clean --if-exists --single-transaction`). 0 S3/DB runner. | préprod (Jobs) |
| S2c | `migrate` | Job `node dist/db/migrate.js` (image préprod exacte) = test iso-prod. | préprod (Job) |
| S3/S4 | `copy-docs` | **Job radar-api aws-sdk** (Option A, `docs-sync-prod-to-preprod`) : pré-check GET prod fail-closed + boucle `CopyObject` server-side additif **+ `GrantFullControl`** (→ canonical préprod). Identité prod-owner éphémère `radar-docs-src-preprod` (GC ownerRef). DRY : copie NON jouée (0 S3 runner). | préprod (Job) |
| S3b | `recon` | **Job aws s3 sync --dryrun** (verdict-only) : dest ⊇ src → exit 0, sinon exit 1. Écrit un sentinel LOCAL `recon.ok.json` (verdict, PAS de contenu). | préprod (Job) |
| S3c | `precheck-runs` | **Job aws s3api list runs/** (verdict-only) : `runs/` vide → exit 1. | préprod (Job) |
| S5 | `flip` | `kubectl set env deploy/radar-api GEO_DOCUMENTS_REPOINT-` (défaut OFF = iso-prod, réversible). | préprod (kubectl) |
| U | `unquiesce` | scale-back aux replicas enregistrés + `rollout status` ; restaure suspend. `if: always()`, sans CONFIRM. | préprod (kubectl) |
| S6 | `refresh` | Job worker-live **delta** (PAS `--all`) ; assert `ConfigMap SCRAPE_S3_BUCKET == PREPROD_DOCS` (MEDIUM2, kubectl) + Job runs/ (MEDIUM3). | préprod (Job) |
| S7 | `smoke` | `curl préprod/health` ; `db.ok` + `objectStore.ok` exigés. | runner (curl) |

Ordre workflow : S0 → **S0.b (`precheck-runs --prod`, Job advisory)** → **Q** → S1 → S2 → S2c → S3 → S3b → S5 → **U (`always`)** → **S3c (Job gate)** → S6 → S7 → upload pointeurs (`always`).

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
| `KUBE_CONFIG_DATA_PROD` | secret | kubeconfig base64 **PROD** (token name-scopé patch `radar-db-backup-prod` + VAP suspend-only, généré au prod-apply) → `DUMP_KUBECONFIG`, utilisé **UNIQUEMENT** sur les 2 patch cronjob prod. Non requis en DRY. |
| `BHS` / `S3_REGION` / `PROD_DOCS` / `PREPROD_DOCS` / `DUMP_BUCKET` / `DUMP_PREFIX` | var | endpoint + buckets + préfixe dump (`postgres/prod/sets`), rendus dans les Jobs. **NON secrets.** |
| `DUMP_CRONJOB` / `DUMP_CRONJOB_NAMESPACE` | var | CronJob dump owner (défauts `radar-db-backup-prod` / `radar-immobilier`). |
| `DOCS_SYNC_READ_SECRET` / `DOCS_SYNC_GRANTEE` | var | nom du secret éphémère (`radar-docs-src-preprod`) + canonical id du `GrantFullControl` (défaut `1901410700457444:user-Wq74B63YQum8`). **NON secrets** (nom + id, pas de valeur cred). |
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
| `radar-docs-src-preprod` **(ÉPHÉMÈRE)** | docs-sync (`docs-sync-prod-to-preprod`), recon, advisory runs/ prod | `S3_ACCESS_KEY`/`S3_SECRET_KEY` (identité **prod-owner** immo-docs-prod) | LECTURE docs PROD + rw préprod + CopyObject. **Créé par k8s** (ownerRef=Job) / **GC cascade au TTL** ; la CI n'y touche jamais. |
| `radar-docs-s3-credentials` | gate runs/ préprod | `DOCS_S3_ACCESS_KEY`/`DOCS_S3_SECRET_KEY` (identité API préprod) | LIST `runs/` préprod (état vu par l'API). |
| `radar-s3-credentials` / `radar-scrape-s3-credentials` | migrate / refresh | `S3_ACCESS_KEY/SECRET_KEY` / `SCRAPE_S3_*` | S3 applicatif / écriture PV scrape. |

> **0 Python, 0 image nouvelle non validée.** Runner : kubectl + curl. Jobs :
> `postgis/postgis:16-3.4` (pg_dump/pg_restore 16) + `amazon/aws-cli` (LIST/HEAD/
> cp/sync — déjà pinné in-repo, cf. `object-storage-inventory-preprod`). Jobs
> migrate/refresh : image radar-api exacte servie en préprod.

## Docs-sync — Option A CANONIQUE (aws-sdk CopyObject, co-val k8s)

Le Job **`docs-sync-prod-to-preprod`** (nom EXACT, watché par k8s) tourne dans
l'**image radar-api** (aws-sdk `@aws-sdk/client-s3`, 0 python) et utilise
l'identité **prod-owner ÉPHÉMÈRE** `radar-docs-src-preprod` (creds immo-docs-prod) :

1. **pré-check GET fail-closed** : `HeadObject` d'un objet prod (l'owner passe,
   sinon exit 1) ;
2. boucle `ListObjectsV2(prod, prefix?)` → `CopyObject(préprod, MÊME clé,
   GrantFullControl id=$COPY_GRANTEE)` = CopyObject **server-side** (0 octet par
   le pod), **additif** (pas de delete), **idempotent**. Le `GrantFullControl`
   explicite (canonical radar-docs préprod) rend les objets copiés **lisibles par
   l'API préprod** (sinon 403 propagé).

**Cycle de vie du secret éphémère (co-val k8s) :** la **CI dispatche le Job** +
lit `.status` ; **k8s** crée `radar-docs-src-preprod` avec `ownerRef=Job.UID` →
**GC cascade au `ttlSecondsAfterFinished` (3600s)** du Job (déterministe, Complete
OU Failed). `activeDeadlineSeconds: 7200` couvre le retry de montage du secret
pendant que k8s le crée. **La CI ne crée / ne lit / ne supprime AUCUN secret**
(0 droit secrets runner — pas d'étape cleanup).

## Rejouer SANS IA

1. **DRY (défaut, sûr).** `CONFIRM=iso-prod-<aujourd'hui>`, `DRY_RUN=true` :
   `preflight` + Jobs recon/advisory-runs (read-only, `continue-on-error`) + `smoke`.
   **Aucune écriture, aucune copie réelle.**
2. **Exécution.** `DRY_RUN=false` + `CONFIRM=iso-prod-<date du jour UTC>`. quiesce
   automatisé + un-quiesce `if: always()` (jamais préprod à terre).
3. **Isolation S5/S6** : `SKIP_FLIP` / `SKIP_REFRESH`.
4. **Quiesce manuel** : `SKIP_QUIESCE=true` + `BASCULE_UNQUIESCE_REPLICAS=radar-api=1,radar-immo-mcp=1`.
5. **Rollback DURABLE.** Dumps (prod S1 + rollback G1) dans
   `s3://radar-immobilier-backups-preprod` (durables). Pointeurs (T1, clés,
   quiesce/recon) uploadés en artefact GitHub `bascule-rollback-<run_id>` (7 j).
   Restaurer : rejouer le Job restore ciblant `ROLLBACK_KEY` (le patron fait le
   `pg_restore --clean --if-exists --single-transaction` in-cluster).

## Points à trancher en QA (source-gaps — non déterminables par lecture)

1. **Kubeconfig PROD du trigger (résolu par dual-kubeconfig).** Le CronJob dump
   reste en PROD (`radar-immobilier`) ; le RBAC ci-deployer préprod exclut la prod
   (`deploy/k8s/11-ci-deployer-preprod-rbac.yaml`) → patch préprod = 403. S1 passe
   par `DUMP_KUBECONFIG` (secret `KUBE_CONFIG_DATA_PROD` : token name-scopé patch
   `radar-db-backup-prod` + **VAP suspend-only**, à fournir au prod-apply). Fail-closed
   si absent. DRY ne trigger pas.
2. **Convention de clé dump (figée k8s) :** `postgres/prod/sets/<ISO-ts>/radar.dump`
   → `DUMP_PREFIX=postgres/prod/sets`, listing **récursif** (list-objects-v2 est
   récursif). Le Job freshness/restore matche `radar` (EXPECTED_DATABASE) + `.dump`.
   Dump owner = `pg_dump --format=custom --no-owner --no-privileges` (contrat).
3. **Secrets in-cluster à provisionner (owner/immo, 0 minté ici) :**
   `radar-pra-admin` (S3-only : S3_ACCESS_KEY/S3_SECRET_KEY, RW backups) ;
   `radar-docs-src-preprod` (identité prod-owner : S3_ACCESS_KEY/S3_SECRET_KEY, read
   prod + rw préprod). Clés/nom à confirmer (sinon régler `PRA_SECRET`/
   `DOCS_SYNC_READ_SECRET`).
   - **`radar-docs-src-preprod` est ÉPHÉMÈRE, géré 100% par k8s** (co-val k8s) : la
     CI **dispatche** le Job `docs-sync-prod-to-preprod` ; **k8s** watch ce nom,
     lit l'UID et crée le secret `ownerRef=Job.UID` → **GC cascade au TTL**
     (3600s). La CI ne crée / ne lit / ne supprime **AUCUN secret** (0 droit
     secrets runner) — pas d'étape cleanup. `activeDeadlineSeconds: 7200` couvre le
     retry de montage pendant la création. **RIEN à ajouter au RBAC ci-deployer.**
4. **Grant docs-sync sur OVH BHS.** `DOCS_SYNC_GRANTEE` = canonical id radar-docs
   préprod (défaut `1901410700457444:user-Wq74B63YQum8`). **Item DRY** : vérifier
   que l'endpoint OVH BHS honore bien `CopyObject` avec `GrantFullControl` (ACL S3
   par objet) ; sinon l'API préprod pourrait 403 sur les objets copiés (à traiter
   avec i-infra). `forcePathStyle` par défaut `true` (`DOCS_S3_FORCE_PATH_STYLE`).
5. **user préprod `radar` superuser** (pour `pg_restore --clean --if-exists`) — à confirmer.

## MEDIUM 2 / MEDIUM 3

- **MEDIUM 2** (classe du bug Farid, kubectl pas S3) : `refresh` exige
  `ConfigMap radar-api.SCRAPE_S3_BUCKET == PREPROD_DOCS` (sinon PV écrits hors
  served bucket → re-404). Échappatoire `ASSERT_REFRESH_BUCKET=0`.
- **MEDIUM 3** (mémoire de collecte) : le delta S6 n'est un delta que si `runs/`
  est présent dans PREPROD_DOCS. Job runs/ verdict-only (gate PREPROD_DOCS ;
  advisory PROD_DOCS). Défense en profondeur : `refresh` re-dispatche le Job runs/.
  Échappatoire `ASSERT_RUNS_MEMORY=0`.

## Lancer une sous-commande à la main (hors workflow)

```bash
# mêmes variables d'env que le workflow (voir matrice) — 0 cred S3/DB runner
node deploy/ci/bascule-preprod/bascule.mjs preflight
node deploy/ci/bascule-preprod/bascule.mjs precheck-runs --prod   # Job advisory (PROD_DOCS)
node deploy/ci/bascule-preprod/bascule.mjs precheck-runs          # Job gate (PREPROD_DOCS)
node deploy/ci/bascule-preprod/bascule.selftest.mjs               # self-test classifyJobStatus (0 appel réel)
```
