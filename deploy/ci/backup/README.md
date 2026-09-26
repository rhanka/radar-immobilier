# Daily prod backup — `radar-backup-daily`

A real, independent backup of production immo: every day, one dated, verified,
retained backup of the PostgreSQL database **and** the documents bucket, in a
dedicated bucket, restorable by date. It is **not** the bascule dump
(`radar-db-backup-prod`, suspended by design, only the bascule S1 trigger — left
untouched).

| File | Role |
| --- | --- |
| `cronjob-backup-daily.yaml` | CronJob `radar-backup-daily` (ns `radar-immobilier`): dump → backup → purge |
| `cronjob-backup-freshness.yaml` | CronJob `radar-backup-freshness`: fails when the backup is stale or not complete for too long |
| `backup-daily.cjs` | Node script, modes `backup` / `purge` / `freshness` (shipped as ConfigMap `radar-backup-daily-script`) |
| `backup-daily.selftest.mjs` | Offline selftest (in-memory versioned S3 fake, per-identity SDK views, wiring checks) |
| [`RETENTION.md`](RETENTION.md) | Retention policy and how it is enforced |
| [`RESTORE.md`](RESTORE.md) | Restore a backup of date D (PG + docs) |

No credential is committed here, sealed or not: the three S3 identities live in
the GitHub Environment `radar-backup-prod` (+ the k8s lane `.env` recovery copy)
and the CD writes them into the cluster — see [Credentials](#credentials).

## What one run produces (day D, UTC)

Bucket `radar-immobilier-backup`:

```
pg/D/radar.dump              pg_dump -Fc of db radar (RO role radar_db_ro_prod)
pg/D/radar.dump.sha256       sha256sum line, re-read after upload
pg/D/globals.sql(.sha256)    pg_dumpall --globals-only --no-role-passwords
docs/<key>                   incremental server-side mirror of radar-immobilier-docs
docs-inventory/D.json        docs state at D: key, size, ETag, lastModified,
                             backup ETag + version id (when known), state
manifests/D.json             THE record of backup D (see below)
manifests/latest.json        pointer: newest backup + latestComplete + firstBackupDate
```

`manifests/D.json` holds: `status`, start/end times, dump key + sha256 + size +
TOC entry count, PostgreSQL / PostGIS / pg_dump versions, globals key + sha256,
schema version (applied drizzle migrations count + last migration
id/hash/createdAt/tag, read **from the dump itself**), the served prod code sha
(public `/health`), docs counts (objects, bytes, copied, up to date, pending,
failed, excluded, source guard) + inventory key + sha256, and the script sha256 /
image digest that produced it. One manifest = one coherent backup of the day: the
DB is dumped first, the docs are listed after, and prod docs are append-mostly,
so every doc the DB references is in the inventory.

`status`:

| status | meaning | Job |
| --- | --- | --- |
| `complete` | PG + every docs object backed up | Complete, purge runs |
| `partial` | PG complete; docs seed still pending within the 90-min budget, **no error** (resumes next run) | Complete (exit 0, verdict `PARTIAL`), purge skipped |
| `incomplete` | PG complete; docs copy/listing **errors** | Failed (exit 4), purge skipped |

## How a run works

Schedule `23 2 * * *` UTC (after the 23:17 UTC refresh, before the 04:45 / 05:17
UTC jobs), `concurrencyPolicy: Forbid`, `activeDeadlineSeconds: 10800`,
`backoffLimit: 1`. One pod, three sequential steps, **one identity each**:

1. **initContainer `dump`** — `postgis/postgis:16-3.4` (already in the cluster),
   RO DB role. Manual-run guard, positive DB assert (`EXPECTED_DATABASE=radar`),
   `pg_dump -Fc`, `pg_restore --list` (readability: a truncated archive fails
   here), schema rows extracted from the dump, `sha256sum`, globals without
   passwords (best-effort).
2. **initContainer `backup`** — radar-api image pinned by digest (same digest as
   the bascule dump CronJob; Node + `@aws-sdk/client-s3`), identity
   **`radar-backup-writer` (no delete right)**. Guards (bucket names, versioning,
   dump ≥ 1 MiB and ≥ 0.5 × the previous dump, docs source > 0 objects and
   ≥ 0.5 × the previous count), upload with Content-MD5, **re-read of the whole
   object and sha256 comparison**, docs copy (server-side `CopyObject`, skip when
   Size + ETag match or the copy is strictly newer than the last source write,
   concurrency 8, 90-minute budget), inventory, manifest, `latest.json`, and the
   retention **plan** (`purge-plan.json` in the pod's work volume).
3. **container `purge`** — same image, identity **`radar-backup-purger`**
   (DeleteObject only, dated prefixes). Starts only after both initContainers
   exited 0; executes the plan **only when it records a `complete` backup**,
   re-checks that every key is dated and outside the daily window, and puts
   delete-markers only (no VersionId). It never reads an object.

`pg_restore --list` runs on the local file before upload and the sha256 of the
uploaded object is re-read after upload: identical bytes, so the uploaded dump
is listable too.

Logs are verdict only (counts, backup keys, sha256) — never a doc key, a row or
a credential. Last lines: `VERDICT OK|PARTIAL|INCOMPLETE date=…` (backup) and
`PURGE OK|SKIPPED …` (purge).

| Exit | Step | Meaning | Retry |
| --- | --- | --- | --- |
| 0 | all | backup complete or partial / purge done or skipped | — |
| 1 | dump, backup | transient failure before the manifest (DB unreachable, S3 5xx, re-read mismatch) | once |
| 2 | dump, backup | refusal: manual run in the scheduled window, wrong DB/bucket, versioning off, dump size anomaly, docs source empty or collapsed (no manifest, no purge) | no |
| 3 | backup, purge | retention plan or purge failed after a complete manifest (backup valid) | no |
| 4 | backup | manifest written with `status=incomplete` | no — next night resumes |

(`podFailurePolicy`: exit 2/3/4 fail the Job without retry — a retry would
re-dump prod for nothing.)

**Manual runs.** `kubectl create job --from=cronjob/radar-backup-daily …` (or the
CD input `backup_run_now`) escapes `concurrencyPolicy: Forbid`. The `dump` step
therefore refuses (exit 2) any Job whose name is not `radar-backup-daily-<n>`
(i.e. not created by the CronJob controller) inside the scheduled window
02:00–05:30 UTC, before touching the database.

The docs copy is idempotent and resumable: an initial seed larger than the
90-minute budget ends as `partial` and continues the next night (or with a
manual run outside the window). `DOCS_EXCLUDE_PREFIXES` (comma list) keeps a
frozen, already-seeded archive prefix out of the daily copy; its objects are
reported `excluded` in the inventory.

## Freshness check — `radar-backup-freshness`

Daily at 06:53 UTC (after the backup window), identity `radar-backup-reader`.
Reads `manifests/latest.json` and fails (exit 5) when:

- the newest backup is older than `FRESHNESS_MAX_AGE_DAYS` (1: today or yesterday);
- the last `complete` backup (`latestComplete`; before any, `firstBackupDate`) is
  older than `FRESHNESS_MAX_INCOMPLETE_DAYS` (3) — partial/incomplete for too long;
- the pointer does not match what it points to (manifest sha256, dump size).

**Alert destination: not decided yet.** For now the **failed Job** of
`radar-backup-freshness` is the signal (`failedJobsHistoryLimit: 7`, TTL 7 days);
a failed `radar-backup-daily` Job is the signal for a real backup error.

## Provisioning (k8s lane — done and tested, referenced here)

- Bucket `radar-immobilier-backup` (OVH BHS): versioning ON, object-lock
  GOVERNANCE default retention 7 days, lifecycle: noncurrent versions expire
  after 7 days, incomplete multipart uploads after 1 day, orphan delete-markers
  cleaned (see [`RETENTION.md`](RETENTION.md)).
- `radar-backup-writer` (keys `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `BACKUP_BUCKET`, `SOURCE_DOCS_BUCKET`): read
  `radar-immobilier-docs`; on the backup bucket Put/Get/List/multipart. **No
  delete of any kind.** Used by the `backup` step.
- `radar-backup-purger` (keys `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `BACKUP_BUCKET`): `DeleteObject` (delete-marker) restricted by
  ARN to `pg/*`, `manifests/*`, `docs-inventory/*`, plus ListBucket /
  GetBucketLocation; no GET, no PUT, nothing on `docs/`. Used by the `purge` step.
- `radar-backup-reader` (keys `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `BACKUP_BUCKET`): GetObject (with versionId), ListBucket,
  ListBucketVersions. Used by the freshness check and restores.
- The three k8s Secrets above are **pre-created** in ns `radar-immobilier`
  (type `Opaque`); their content is written by the CD from GitHub (below).
- Secret quota of the prod namespace raised to 24.
- Rotation every 90 days: `../bascule-preprod/CRED_CYCLE.md`.

## Credentials

**Source of truth: the GitHub Environment `radar-backup-prod` + the `.env`
recovery copy of the k8s lane. No SealedSecret.** The Environment has a
deployment branch policy of `main` only (a job started from any other branch
cannot read it) and no required reviewer (the merge path stays automatic). It is
created and filled by the k8s lane; nothing about these values is committed.

| k8s Secret / key | `radar-backup-writer` | `radar-backup-reader` | `radar-backup-purger` |
| --- | --- | --- | --- |
| `S3_ENDPOINT` | variable `BACKUP_S3_ENDPOINT` (= `https://s3.bhs.io.cloud.ovh.net`) | same | same |
| `S3_REGION` | variable `BACKUP_S3_REGION` (= `bhs`) | same | same |
| `S3_ACCESS_KEY` | secret `RADAR_BACKUP_WRITER_ACCESS_KEY` | secret `RADAR_BACKUP_READER_ACCESS_KEY` | secret `RADAR_BACKUP_PURGER_ACCESS_KEY` |
| `S3_SECRET_KEY` | secret `RADAR_BACKUP_WRITER_SECRET_KEY` | secret `RADAR_BACKUP_READER_SECRET_KEY` | secret `RADAR_BACKUP_PURGER_SECRET_KEY` |
| `BACKUP_BUCKET` | variable `BACKUP_BUCKET` (= `radar-immobilier-backup`) | same | same |
| `SOURCE_DOCS_BUCKET` | variable `BACKUP_SOURCE_BUCKET` (= `radar-immobilier-docs`) | — | — |

The step **Write backup Secrets from GitHub** of job `apply-backup` runs at
every CD run, before the ConfigMap and the CronJobs:

1. **Fail-closed guard, before any write**: the 6 secrets and 4 variables are set
   and single-line; access keys match `^[A-Za-z0-9]{16,128}$` and secret keys
   `^[A-Za-z0-9/+=]{16,128}$`; `BACKUP_S3_ENDPOINT` is exactly
   `https://s3.bhs.io.cloud.ovh.net` and `BACKUP_S3_REGION` exactly `bhs` (the
   pinned OVH BHS target); `BACKUP_BUCKET` / `BACKUP_SOURCE_BUCKET` equal the
   `EXPECTED_*` guards of `cronjob-backup-daily.yaml`; the three Secrets exist.
   A failing value is named — never printed — and nothing is applied.
2. For each identity: render the Secret client-side (`kubectl create secret
   generic --dry-run=client`, each value read from a file of a `0700` temp dir —
   never in argv, never echoed; the dir is removed on exit), label it
   `app.kubernetes.io/component: db-backup`. **No partial write**: a
   server-side dry-run of the three PUTs (`kubectl replace --dry-run=server`)
   must pass for all three, then the real `kubectl replace` (GET + PUT) runs.
   The PUT makes the live key set **exactly** the one the CronJobs mount (a stale
   extra key is dropped), writes no `last-applied-configuration` annotation (a
   client-side `kubectl apply` would copy the credentials into it) and clears a
   former sealed-secrets `ownerReference`.
3. The key set returned by the server is compared with the expected one.

Values reach the script through the step `env:` only (never a `${{ }}` inside
`run:`), GitHub masks the secrets, there is no `set -x`; the log carries
names and key names only. The SA `radar-ci-bascule-prod` holds
**get/update on these three Secret names only** — no create, patch, list,
watch or delete on Secrets (`../bascule-preprod/rbac-ci-bascule-prod.yaml`): a
missing Secret is a hard error, never a create.

DB access reuses the RO role secret `radar-db-ro-prod` (bascule bundle). Network:
the pod carries `app.kubernetes.io/component: db-backup`, allowed to
`radar-postgres:5432` by the existing `allow-backup-to-postgres`
(`deploy/k8s/70-networkpolicy.yaml`). No NetworkPolicy change. Egress needed:
the S3 endpoint (and, best-effort, `https://immo.sent-tech.ca/health`); the
namespace has no egress policy today — if one is added, these two must stay open.

## How it reaches prod (CD)

`.github/workflows/bascule-bundle-cd.yml`, job **`apply-backup`** — same path and
guards as the bascule bundle: permanent SA `radar-ci-bascule-prod`
(`KUBE_CONFIG_DATA_PROD`), positive PROD apiserver pre-flight, runner = kubectl
only, job bound to the Environment `radar-backup-prod`. Steps: selftest
(fail-closed before any apply) → write the three Secrets from GitHub
([Credentials](#credentials)) → render the ConfigMap from `backup-daily.cjs`
and apply it → apply both CronJobs and assert their live
schedule/suspend/concurrency. Triggered on push to `main`
touching `deploy/ci/backup/**`; independent of the `apply-bundle` job. A
`workflow_dispatch` with `backup_run_now=true` **skips `apply-bundle`**, so the
bundle's RO-role Job never competes with the backup pod for CPU (a plain
dispatch or a push touching the bundle still re-applies it).

**Capacity during a backup.** A running backup pod counts 1 CPU of limits (its
`dump` step) against the namespace quota: `limits.cpu` measured at ≈ 2350m /
2500m and the node at ≈ 97 % of requests during the first run. Avoid concurrent
manual launches during the day (manual backup runs, one-shot Jobs, bundle
re-applies) while a backup runs; the scheduled 02:23 UTC run is alone by design,
and manual backup runs are refused inside 02:00–05:30 UTC.

Arming (repo variables): `BASCULE_BUNDLE_CD_ENABLED=true` and
`BACKUP_DAILY_CD_ENABLED=true`, set by the k8s lane after it re-applied
`deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml` (install-time,
cluster-admin: name-scoped get/update on the Secrets
`radar-backup-writer`, `radar-backup-reader`, `radar-backup-purger`, the
ConfigMap `radar-backup-daily-script`, the CronJobs `radar-backup-daily`,
`radar-backup-freshness`), pre-created the three Secrets and filled the
Environment `radar-backup-prod`.

**Cutover from the SealedSecrets of the first delivery (one-time).** The first
delivery committed the three identities as SealedSecrets; they are removed (owner
rule: no SealedSecret). Order, before the next 02:23 UTC run:

1. k8s lane: create the Environment `radar-backup-prod` (deployment branches:
   `main` only, no reviewer), set its 6 secrets and 4 variables (current values,
   same as `.env`); make sure the three Secrets exist (today they do,
   materialized by the controller); re-apply `rbac-ci-bascule-prod.yaml`.
2. Merge: the push runs `apply-backup`, which rewrites the three Secrets from
   GitHub (the PUT also clears their sealed-secrets `ownerReference`).
3. k8s lane: delete the three SealedSecret objects **with `--cascade=orphan`**
   (`kubectl -n radar-immobilier delete sealedsecret radar-backup-writer
   radar-backup-reader radar-backup-purger --cascade=orphan`): the Secrets are
   kept even if step 2 did not run.
4. `workflow_dispatch` of `bascule-bundle-cd` **without** `backup_run_now`:
   `apply-backup` rewrites the three Secrets again, with no SealedSecret left.
5. Verify: the run is green and logs `secret/radar-backup-<id> replaced from
   GitHub — keys: …` for the three; `kubectl -n radar-immobilier get
   sealedsecret` lists only `radar-db-ro-prod` and `radar-pra-admin-prod`;
   the three Secrets have no `ownerReferences`; the next `radar-backup-daily`
   and `radar-backup-freshness` Jobs are `Complete`.

## Verification

Every day (any operator, no cluster write):

1. Last Jobs of `radar-backup-daily` and `radar-backup-freshness` = `Complete`;
   logs end with `VERDICT OK` / `PURGE OK` and `FRESHNESS OK`.
2. `manifests/latest.json` → `date` = today (UTC), `status` = `complete`,
   `latestComplete.date` = today.
3. Integrity of a date D (reader identity): download `pg/D/radar.dump` and
   `pg/D/radar.dump.sha256`, `sha256sum -c` must print `OK`; the value equals
   `manifests/D.json` `pg.sha256`.
4. `pg_restore --list radar.dump` lists the archive.

Wave 2 (not in this PR): an automated restore-test job (restore the latest dump
into a scratch database and compare the drizzle migrations count/last hash with
the manifest; resolve a sample of inventory entries with the reader).

## Knobs (CronJob env)

`COPY_CONCURRENCY` (8), `DOCS_COPY_BUDGET_SECONDS` (5400), `DOCS_EXCLUDE_PREFIXES`
(empty), `MIN_DUMP_BYTES` (1048576), `MIN_DUMP_RATIO` (0.5), `MIN_DOCS_RATIO` (0.5)
— for both ratios 0 disables the relative check; after a legitimate large
cleanup, set it to 0 by PR for one run, then back — `RETENTION_*` (see
`RETENTION.md`), `PURGE_DRY_RUN` (false), `SCHEDULED_WINDOW_START/END`
(0200/0530), `FRESHNESS_MAX_AGE_DAYS` (1), `FRESHNESS_MAX_INCOMPLETE_DAYS` (3).

## Known limits

- **Docs overwritten in place** (e.g. canonical graph objects under the same
  key): the bucket-wide lifecycle expires noncurrent versions after 7 days, so a
  weekly/monthly restore point only restores the *previous* content of such an
  object for 7 days after it was overwritten. Write-once docs (PV PDFs) are
  restorable at every retained date. Keeping longer history needs a lifecycle
  change by the k8s lane: scope the 7-day noncurrent rule to `pg/`,
  `docs-inventory/`, `manifests/` and add a `docs/` noncurrent rule of ≥ 190 days.
- The reader reading objects written by the writer (OVH object ownership/ACL) is
  proven by the first freshness run (manifest GET) and the wave-2 restore-test.
- Object-lock writes carry Content-MD5 (plain PUT, no aws-chunked trailer);
  behaviour against the OVH bucket is observed on the first run.
- `code.servedSha` comes from the public `/health`; `unknown` if unreachable
  (never fails the backup).
