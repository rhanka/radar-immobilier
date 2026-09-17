# Backup and disaster-recovery plan — 2026-09-17

## Scope and classification

| Data | Criticality | Mechanism and contract |
|---|---|---|
| Radar PostgreSQL/PostGIS: annotations Steve, manual provenance, application data | Critical | Daily `pg_dump -Fc --no-owner --no-privileges`, SHA-256 + JSON manifest to the environment-scoped OVH S3 bucket. A PG16/PostGIS-compatible client is mandatory. |
| Radar S3 documents (manual and source documents) | Critical where manual provenance; otherwise recoverable from source | S3-to-S3 versioned sync to an OVH recovery bucket, object inventory and hash manifest. Bucket/prefix source-gap. |
| Geo PostgreSQL/PostGIS | Critical | **Geo-cond contract:** same PG16 custom-dump/manifest/SHA interface under `postgres/<env>/daily|weekly|monthly`; separate geo-owned bucket and credentials. Implementation is not in this PR. |
| Geo tiles and S3 assets | Critical when manually curated; otherwise reconstructible | **Geo-cond contract:** S3-to-S3 sync, immutable inventory/hash manifest, same retention. Bucket/prefix source-gap. |
| Scrapes, signals, caches, derived graph/projections | Reconstructible | N-A as a PRA dependency: re-run idempotent acquisition/projection from retained documents. Signal backup is not critical by owner ruling. |

## Policy and targets

Each class keeps **daily 7, weekly 4, monthly 1** complete backup sets. The
monthly value means the current monthly set is retained; a longer archive is an
owner decision. Backup objects are encrypted at rest by OVH S3 (`AES256` request
and bucket policy), private, prefix-scoped by environment and concern.

Targets pending owner acceptance: **RPO 24 h** for critical data (daily job),
**RTO 4 h** for Radar PostgreSQL restore verification and service recovery, and
**RTO source-gap** for documents/geo until measured object volumes and bandwidth
are supplied. No PITR is claimed.

## Radar implementation and isolated rehearsal

`radar-db-backup` runs at 02:15 UTC, forbids overlap, produces a custom dump,
SHA-256 and manifest, and retains only complete sets. Preprod is active; the
production base is suspended. The backup secret is provisioned out-of-band.

On owner GO, the k8s lane selects a verified `postgres/preprod/.../radar-<UTC>`
stem, patches the fail-loud `BACKUP_OBJECT` in the Job renderer, then runs:

```sh
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/k8s/db-restore-verify | kubectl -n radar-immobilier-preprod apply -f -
kubectl -n radar-immobilier-preprod wait --for=condition=complete job/radar-db-restore-verify --timeout=3700s
kubectl -n radar-immobilier-preprod logs job/radar-db-restore-verify -c restore-and-verify
```

The Job verifies SHA-256, restores with `pg_restore --exit-on-error` only into
`radar_restore_verify`, and compares source and scratch table-count reports byte-for-byte, then emits
that result and the hash. It never swaps or writes the source database. Record
duration, dump bytes, manifest hash, table-count output and Job status in the
rehearsal report.

## Cost and source-gaps

No measured radar DB, document, geo DB, tile, or object sizes were available in
this worktree; storage cost is **source-gap**, not estimated. Formula: retained
GiB = daily dump GiB × 7 + weekly dump GiB × 4 + monthly dump GiB × 1 + synced
object GiB × retained versions; add provider storage and request prices from the
OVH quote. Compression ratio is also source-gap.

## Owner decisions (max. 3)

1. Approve RPO 24 h/RTO 4 h and monthly retention of one set, or specify values.
2. Confirm OVH backup bucket names, region, encryption/versioning/lifecycle and
   prefix-scoped identities for Radar, docs, Geo and tiles.
3. Approve the preprod rehearsal window and the evidence owner for the first
   restore; approve a longer monthly archive if required.
