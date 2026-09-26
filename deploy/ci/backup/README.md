# Daily prod backup — `radar-backup-daily`

A real, independent backup of production immo: every day, one dated, verified,
retained backup of the PostgreSQL database **and** the documents bucket, in a
dedicated bucket, restorable by date. It is **not** the bascule dump
(`radar-db-backup-prod`, suspended by design, only the bascule S1 trigger — left
untouched).

| File | Role |
| --- | --- |
| `cronjob-backup-daily.yaml` | CronJob `radar-backup-daily` (ns `radar-immobilier`) |
| `backup-daily.cjs` | Node script of the `backup` container (shipped as ConfigMap `radar-backup-daily-script`) |
| `backup-daily.selftest.mjs` | Offline selftest (in-memory versioned S3 fake + wiring checks) |
| `radar-backup-writer-sealed.yaml` | SealedSecret — job identity (committed verbatim from the k8s lane) |
| `radar-backup-reader-sealed.yaml` | SealedSecret — restore identity (read-only) |
| [`RETENTION.md`](RETENTION.md) | Retention policy and how it is enforced |
| [`RESTORE.md`](RESTORE.md) | Restore a backup of date D (PG + docs) |

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
manifests/latest.json        pointer to the newest manifest
```

`manifests/D.json` holds: status (`complete` | `partial`), start/end times, dump
key + sha256 + size + TOC entry count, PostgreSQL / PostGIS / pg_dump versions,
globals key + sha256, schema version (applied drizzle migrations count + last
migration id/hash/createdAt/tag, read **from the dump itself**), the served prod
code sha (public `/health`), docs counts (objects, bytes, copied, up to date,
pending, failed, excluded) + inventory key + sha256, and the script sha256 /
image digest that produced it. One manifest = one coherent backup of the day:
the DB is dumped first, the docs are listed after, and prod docs are
append-mostly, so every doc the DB references is in the inventory.

## How a run works

Schedule `23 2 * * *` UTC (after the 23:17 UTC refresh, before the 04:45 / 05:17
UTC jobs), `concurrencyPolicy: Forbid`, `activeDeadlineSeconds: 10800`,
`backoffLimit: 1`. One pod, two steps:

1. **initContainer `dump`** — image `postgis/postgis:16-3.4` (already in the
   cluster). Positive DB assert (`EXPECTED_DATABASE=radar`), `pg_dump -Fc`,
   `pg_restore --list` (readability: a truncated archive fails here), schema rows
   extracted from the dump, `sha256sum`, globals without passwords (best-effort).
2. **container `backup`** — radar-api image pinned by digest (same digest as the
   bascule dump CronJob; Node + `@aws-sdk/client-s3`). Guards (bucket names,
   versioning, dump size floor 1 MiB and ≥ 0.5 × the previous dump), upload with
   Content-MD5, **re-read of the whole object and sha256 comparison**, docs copy
   (server-side `CopyObject`, skip when Size + ETag match or the copy is newer
   than the last source write, concurrency 8, 90-minute budget), inventory,
   manifest, `latest.json`, then the retention purge (delete-markers only).

`pg_restore --list` runs on the local file before upload and the sha256 of the
uploaded object is re-read after upload: identical bytes, so the uploaded dump
is listable too.

Logs are verdict only (counts, backup keys, sha256) — never a doc key, a row or
a credential. Last line: `VERDICT OK|PARTIAL|OK-PURGE-FAILED date=… status=…`.

| Exit | Meaning | Retry |
| --- | --- | --- |
| 0 | complete backup, purge done | — |
| 1 | transient failure before the manifest (DB unreachable, S3 5xx, re-read mismatch) | once (`backoffLimit: 1`) |
| 2 | refusal: wrong DB/bucket, versioning off, dump size anomaly | no (`podFailurePolicy`) |
| 3 | purge failed after a complete manifest (backup valid) | no |
| 4 | manifest written with `status=partial` (docs pending/failed) | no — next night resumes |

The docs copy is idempotent and resumable: an initial seed larger than the
90-minute budget ends as `partial` (exit 4) and continues the next night (or
with a manual run, see below). `DOCS_EXCLUDE_PREFIXES` (comma list) keeps a
frozen, already-seeded archive prefix out of the daily copy; its objects are
reported `excluded` in the inventory.

## Provisioning (k8s lane — done and tested, referenced here)

- Bucket `radar-immobilier-backup` (OVH BHS): versioning ON, object-lock
  GOVERNANCE default retention 7 days, lifecycle: noncurrent versions expire
  after 7 days, incomplete multipart uploads after 1 day, orphan delete-markers
  cleaned (see [`RETENTION.md`](RETENTION.md)).
- `radar-backup-writer` (keys `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `BACKUP_BUCKET`, `SOURCE_DOCS_BUCKET`): read
  `radar-immobilier-docs`; on the backup bucket Put/Get/List/multipart +
  `DeleteObject` without VersionId (delete-marker only). No
  `DeleteObjectVersion`, no `BypassGovernanceRetention`. Used by the CronJob.
- `radar-backup-reader` (keys `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `BACKUP_BUCKET`): GetObject (with versionId), ListBucket,
  ListBucketVersions. Never mounted by the CronJob; used for restores.
- Secret quota of the prod namespace raised to 24.
- Rotation every 90 days: `../bascule-preprod/CRED_CYCLE.md`.

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
only. Steps: selftest (fail-closed before any apply) → apply the two
SealedSecrets → wait Synced (tolerant) → render the ConfigMap from
`backup-daily.cjs` and apply it → apply the CronJob and assert the live
schedule/suspend/concurrency. Triggered on push to `main` touching
`deploy/ci/backup/**`; independent of the `apply-bundle` job (no `needs`).

Activation order (once):

1. Merge the PR (the `apply-backup` job stays skipped: not armed yet).
2. k8s lane re-applies `deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml`
   (install-time, cluster-admin): the SA gains name-scoped get/patch/update on
   `radar-backup-writer`, `radar-backup-reader` (sealedsecrets),
   `radar-backup-daily-script` (configmap), `radar-backup-daily` (cronjob).
3. Set the repo variable `BACKUP_DAILY_CD_ENABLED=true`.
4. `workflow_dispatch` of `bascule-bundle-cd` (input `backup_run_now=true` also
   starts a first run immediately), or wait for the next change under
   `deploy/ci/backup/`.

## Verification

Every day (any operator, no cluster write):

1. Last Job of `radar-backup-daily` = `Complete`; its log ends with `VERDICT OK`.
2. `manifests/latest.json` → `date` = today (UTC), `status` = `complete`.
3. Integrity of a date D (reader identity): download `pg/D/radar.dump` and
   `pg/D/radar.dump.sha256`, `sha256sum -c` must print `OK`; the value equals
   `manifests/D.json` `pg.sha256`.
4. `pg_restore --list radar.dump` lists the archive.

Wave 2 (not in this PR): an automated restore-test job (restore the latest dump
into a scratch database and compare the drizzle migrations count/last hash with
the manifest; resolve a sample of inventory entries with the reader).

## Knobs (CronJob env)

`COPY_CONCURRENCY` (8), `DOCS_COPY_BUDGET_SECONDS` (5400), `DOCS_EXCLUDE_PREFIXES`
(empty), `MIN_DUMP_BYTES` (1048576), `MIN_DUMP_RATIO` (0.5; 0 disables the
relative check — after a legitimate large data cleanup, set it to 0 by PR for one
run, then back), `RETENTION_*` (see `RETENTION.md`), `PURGE_DRY_RUN` (false).

## Known limits

- **Docs overwritten in place** (e.g. canonical graph objects under the same
  key): the bucket-wide lifecycle expires noncurrent versions after 7 days, so a
  weekly/monthly restore point only restores the *previous* content of such an
  object for 7 days after it was overwritten. Write-once docs (PV PDFs) are
  restorable at every retained date. Keeping longer history needs a lifecycle
  change by the k8s lane: scope the 7-day noncurrent rule to `pg/`,
  `docs-inventory/`, `manifests/` and add a `docs/` noncurrent rule of ≥ 190 days.
- The reader reading objects written by the writer (OVH object ownership/ACL) is
  proven by the first restore (wave 2) — the bascule docs-sync needed an explicit
  grant between identities.
- Object-lock writes carry Content-MD5 (plain PUT, no aws-chunked trailer);
  behaviour against the OVH bucket is observed on the first run.
- `code.servedSha` comes from the public `/health`; `unknown` if unreachable
  (never fails the backup).
