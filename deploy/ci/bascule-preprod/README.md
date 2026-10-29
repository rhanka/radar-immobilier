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

Removed with S6: these guards protected the differential refresh the bascule
used to run. The refresh is no longer part of the bascule (CronJob
`radar-refresh-pv`, triggered independently); `precheck-runs` stays available
(advisory `--prod`).

## Restore from a backup — `MODE=restore` / `MODE=list`

Workflow input `MODE`: `chain` (default of a dispatch: live dump S1, sequence
above) | `restore` (**always for a scheduled run**, from the latest complete
backup, 24 h guard active) (restore preprod FROM a daily
backup of `radar-immobilier-backup`, see `../backup/`) | `list` (read-only).
Logic: `restore-mode.mjs` (runner, kubectl only) + `backup-restore.cjs` (in-pod
steps, embedded verbatim in the Job templates with `node -e`, image radar-api =
Node + `@aws-sdk/client-s3`, 0 python, 0 new image). The scheduled restore stays
gated by `BASCULE_SCHEDULE_ENABLED` (armed by the k8s lane; OFF by default).

### Daily schedule (04:00 UTC)

Cron `0 4 * * *` (UTC, on the hour). Neighbouring schedules, all UTC:

| Time | Workload | Relation to the restore |
| --- | --- | --- |
| 00:00, 06:00, 12:00, 18:00 | preprod refresh `radar-refresh-pv` (runs observed 1 h 30 to 4 h, `activeDeadlineSeconds` 5 h 30) | a Job still running from 00:00 is **deleted by the quiesce** (owned by a quiesced CronJob); the CronJob is suspended during the restore, and the un-quiesce patches back its recorded `suspend` (a failed patch fails the un-quiesce step); its database work is replaced by the restore anyway |
| every 5 min | preprod `radar-refresh-pending-watchdog` | in `QUIESCE_CRONJOBS`: suspended during the restore, then patched back the same way (an active watchdog Job would trip G2) |
| 02:23 | prod backup `radar-backup-daily` (7 to 45 min observed; `startingDeadlineSeconds` 3600, `activeDeadlineSeconds` 3 h) | R0 picks `latestComplete` if it is at most 24 h old (age reference = dump start); there is no same-day check. Normal outcome after an on-time backup: the backup of the day, ~1.6 h old at 04:00. Example: if the backup of the day is missing or still running and the previous one started at 02:23, it is ~25.6 h old and R0 refuses it **before any quiesce** (preprod untouched); a previous-day backup that started later (e.g. a delayed or re-run dump) can still be under 24 h and is then restored |
| 05:00, 11:00, 17:00, 23:00 | prod refresh | not touched by the restore; shares the single node. Nominal margin: 60 min between the configured starts; with the 50 min upper observed restore, 10 min. A late GitHub start or a longer restore overlaps the prod refresh (CPU sharing, no guard) |
| 04:40 | sentropic IdP identities sync prod → preprod (sentropic side) | independent; CPU only |

Durations: observed restores take 18 to 50 min; the job timeout is 330 min
(sum of the runner-side Job waits ~260 min). If the restore still holds
`radar-refresh-pv` suspended at 06:00, the 06:00 pass is missed while suspended:
an un-quiesce within 10 min (`startingDeadlineSeconds` 600, `concurrencyPolicy`
Forbid) lets the controller start it right away; later, it is skipped and the
next pass is 12:00 (once the un-quiesce restored `suspend: false`). GitHub may
start a top-of-hour schedule late; nothing measures or bounds that delay.

Guard: `deploy/k8s/refresh-cronjobs/bascule-window.awk`, run by
`refresh-018.mk verify-renders` (CI), compares CONFIGURED start times only — the
single active cron of this workflow (`bascule-crons.awk`, any quoting), the
RENDERED prod and preprod `radar-refresh-pv` and `radar-backup-daily` (backup manifest rendered by kubectl kustomize) selected
by name, all Etc/UTC: on the hour, >= 60 min after the backup start the same UTC
day, on no refresh start, >= 60 min before the next refresh start. Mutation
cases: `verify-renders.test.sh`.

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

No refresh in any MODE (a restore is a restore). `DRY_RUN=true` runs G3 +
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
