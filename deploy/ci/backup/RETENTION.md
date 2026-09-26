# Retention — `radar-immobilier-backup`

Policy: **daily 7 days, weekly 4 weeks, monthly 6 months.**

S3 lifecycle rules filter by prefix/tag and age, not by weekday or day of month,
so the weekly and monthly tiers cannot be expressed by lifecycle alone. The
enforcement is split in two:

| Layer | Owner | What it does |
| --- | --- | --- |
| Object lock GOVERNANCE, default retention 7 days | k8s lane (bucket) | Every object version is undeletable for 7 days after it is written. |
| Lifecycle | k8s lane (bucket) | Noncurrent versions expire 7 days after they become noncurrent; incomplete multipart uploads after 1 day; orphan delete-markers removed. |
| Dated-folder purge | `radar-backup-daily` (identity `radar-backup-writer`) | After the manifest of the day is written, puts a **delete-marker** (DeleteObject without VersionId) on every dated object outside the policy. |

The job never deletes a version. A purged object becomes a noncurrent version,
stays readable by version id for 7 more days (restore grace), then the lifecycle
removes it (object lock has long ended by then: the lock counts from the write,
the purge happens at the earliest 7 days after the write).

## What is kept

Dated objects: `pg/<D>/*`, `docs-inventory/<D>.json`, `manifests/<D>.json`. A date
is a **backup** when its manifest exists. At each run (today = T, UTC):

| Reason | Kept dates |
| --- | --- |
| daily | every date with `T - D < 7` days (including unfinished days, for diagnosis) |
| weekly | the latest backup of each ISO week (Monday–Sunday), i.e. **the Sunday** when it ran, if `T - D < 28` days |
| monthly | the earliest backup of each month, i.e. **the 1st** when it ran, for the current month and the 5 previous ones |
| min-keep | the 7 newest backups, whatever their age (an outage never shrinks the history to one point) |
| future | dates after T (clock skew) |

Everything else is purged. If a Sunday (or a 1st) had no backup, the latest day
of that week (or the earliest day of that month) takes its place; that day is
still inside the daily window when its week ends, so it is never purged too
early. Steady state: at most 16 visible dated backups (7 daily + 3 older
Sundays + 6 monthly, fewer when they overlap), plus the purged ones during their
7-day grace.

Never purged: `docs/` (the mirror), `manifests/latest.json`, any key that does not
match the dated layout, and anything at all when the manifest of today is not
listed (the purge refuses and the run exits 3). If the job stops running,
nothing is purged: the failure mode is accumulation, never loss.

## Timeline of one daily dump

| Day | Event |
| --- | --- |
| D | written (`pg/D/radar.dump`), locked until D+7 |
| D+7 | leaves the daily window → delete-marker (unless Sunday / 1st / min-keep) |
| D+7 … D+14 | noncurrent, readable by version id (reader identity) |
| ≈ D+14 | expired by the lifecycle |

A Sunday is purged at D+28 (expired ≈ D+35); a 1st of month when it becomes
6 months old (expired 7 days later).

## Docs history

`docs/` holds the current copy of every source object (never purged). When a
source object is rewritten under the same key, the next run copies it again and
the previous backup content becomes noncurrent: with the bucket-wide 7-day
noncurrent rule it is kept 7 days only. Write-once docs are restorable at every
retained date; for rewritten keys see "Known limits" in `README.md` (proposed
lifecycle change: `docs/` noncurrent ≥ 190 days, 7-day rule scoped to the dated
prefixes).

## Bucket configuration (as provisioned by the k8s lane, S3 terms)

```json
{ "ObjectLockEnabled": "Enabled",
  "Rule": { "DefaultRetention": { "Mode": "GOVERNANCE", "Days": 7 } } }
```

```json
{ "Rules": [
  { "ID": "noncurrent-7d", "Status": "Enabled", "Filter": {},
    "NoncurrentVersionExpiration": { "NoncurrentDays": 7 } },
  { "ID": "abort-incomplete-mpu-1d", "Status": "Enabled", "Filter": {},
    "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 } },
  { "ID": "orphan-delete-markers", "Status": "Enabled", "Filter": {},
    "Expiration": { "ExpiredObjectDeleteMarker": true } }
] }
```

(Rule IDs are illustrative; the effect is what the job relies on.)

## Knobs (CronJob env, defaults = policy)

`RETENTION_DAILY_DAYS=7`, `RETENTION_WEEKLY_WEEKS=4`, `RETENTION_MONTHLY_MONTHS=6`,
`RETENTION_MIN_KEEP=7`, `PURGE_DRY_RUN=false` (true = compute and log the plan,
put no delete-marker). The algorithm is `planRetention` in `backup-daily.cjs`,
covered by `backup-daily.selftest.mjs` (500-day simulation, missing Sunday,
outage, unfinished days, boundaries).
