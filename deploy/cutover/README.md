# Sequential database cutover

Run on Linux from the repository root with Bash, kubectl, jq, curl and GNU coreutils;
`gh` is needed for artifact downloads and GitHub-executor recovery.
The standalone Makefile never includes the root Makefile or reads dotenv files.
Local execution consumes installed namespace Secrets. No Python is used.

```sh
make -f deploy/cutover/operator.mk download-release BUILD_RUN=<BUILD_RUN_ID> SHA=<FULL_GIT_SHA> ENV=preprod
make -f deploy/cutover/operator.mk prepare RELEASE=cutover-release/release.json ENV=preprod
make -f deploy/cutover/operator.mk run RELEASE=cutover-release/release.json ENV=preprod
make -f deploy/cutover/operator.mk prepare RELEASE=cutover-release/release.json ENV=prod
make -f deploy/cutover/operator.mk run RELEASE=cutover-release/release.json ENV=prod
```

Rehearse the exact generated manifest in preprod before promoting that manifest
to production. Promotion downloads the original successful main build's artifact
by build-run ID and never rebuilds images. `dataMigration` accepts only `"6h"`
or `null`; changing it selects the sole approved hook, never arbitrary code.
OCI revision labels are not required (approved addendum).

Release cutover verifies prepared state, closes, switches, restarts, tests and
reopens. No dump restoration or migration runs during release cutover.
Preprod preparation restores into the other database of `radar` / `radar_next`
in the same instance, using `pg_restore -j 4`, then runs DDL, protected 6H and
an isolated `radar-api-prepared` smoke. The live Secret remains untouched until
switch: a compare-and-swap JSON patch changes only `POSTGRES_DB`. Old databases
are retained. Production preparation takes a recovery backup and verifies the
live release migration hashes; production cutover changes images only.

Restores drop every GRANT (`--no-privileges`); the `ddl` step runs the API
migrator, which re-asserts the restricted MCP role privileges on the prepared
database. The MCP role URLs follow `POSTGRES_DB` after the switch restart.

Both restore paths run `atomic-restore.sh`: every application schema is dropped
with `CASCADE` and recreated, then the archive is replayed without `--clean`, so
a snapshot with fewer migrations than the destination restores and a rerun is
idempotent. The daily live restore keeps the reset and the replay in one
transaction (COMMIT only after the whole archive was read); the prepared
disposable database commits the reset, then loads with `pg_restore -j 4`.
Recovery backups go to the per-environment `recoveryBucket` in `config.json`;
a write/list `probe` Job runs before any closure and fails early.
The restore Job uses the per-environment `restoreResources` of `config.json`
(requests 250m CPU / 1 Gi, limits 1500m CPU / 2 Gi), which fits the preprod
`preprod-cap` ResourceQuota and LimitRange; `pg_restore` keeps `-j 4`.
Preparation runs before any closure, so its duration is outside the five minutes.
Preparation records `recoveryReference` for rollback: the production recovery
backup object, or the retained previous preprod database.

The five-minute (295 s) budget starts at the effective closure, after preflight
and prepared verification. Exhausting it alone never keeps the site closed:
operation Jobs are stopped, the previous database and images are restored
(automatic rollback), the private smoke runs and routes reopen; the command
still exits non-zero. Any other failure stays closed for explicit recovery.
Prepared verification includes the preprod document re-check (`recon`): it
lists the whole preprod bucket (about 100 s), so it runs after writers are
suspended and before closure, with the preparation deadline (840 s). The
database switch refuses without that completed evidence.

Preprod preparation and the daily restore copy the documents of the pinned
backup into the live preprod document bucket before closure. Outside the
PG-coupled prefixes the copy is additive. The PG-coupled prefixes (`graph/`,
`refresh/018/`: canonical graph, run states, receipts and coverage ledgers) are
MIRRORED from the same snapshot as the restored database: objects absent from
the snapshot are deleted. `refresh/018/sweep/` (preprod sweep cursor), the
artifact catalogue (`artifacts.*` schema, `artifacts/` blobs) and every other
prefix survive. Deletion needs `DeleteObject` on `graph/*` and
`refresh/018/*` of the preprod bucket for the copy identity; the docs Job probes
it in both prefixes before the first write and refuses otherwise. Deletions run only
after every copy succeeded; a copy error skips them all (`deleteSkipped`). Keys
with a `.`, `..` or empty inner segment are counted (`mirrorAnomalies`) and never
deleted, but listing readers (`readRefreshStates` lists `refresh/018/<city>/runs/`)
would still read them: recon and `coherence_gate` refuse while any remains. Remove
them by hand after review, then re-run; the `Coherence OK` line prints
`mirror_anomalies=0`. A volume guard refuses before any write when snapshot D holds nothing in a
mirror prefix that preprod fills, or when more than `MIRROR_MAX_DELETE_RATIO`
(default 0.5) of a prefix would be deleted; review the logged plan, then pass
`MIRROR_FORCE=1` (or a higher ratio) to the `make` command. After the restore Job,
`coherence_gate` (`tools/make/cutover-coherence.jq`) refuses unless the
database dump, the documents and the recon share the pinned snapshot and the
mirror prefixes hold nothing outside it. The PG-coupled CronJobs
(`preprod.coherenceSchedules`: `radar-refresh-pv`) stay suspended from the
document mirror until the live database is that snapshot: a `prepare` holds
them (annotation `sentropic.io/held-until-coherent`) until the release switch;
a successful switch or coherent daily restore releases them to the original state
recorded as `<run>:(true|false)`. Any other annotation value is a human hold: it is
kept and never released automatically (remove it, or write `<token>:false`, by hand); a rollback or a restore reopened without restoration keeps them held.

Incident 2026-11-14: the former additive copy left preprod run receipts and
ledgers next to the production ones; every projection was then refused with
`postgres-regression-refused`. Remediation is the daily restore below, never a
manual alignment.

`radar-prepared-db` records preparation ownership, status, backup fingerprints,
release SHA, migration count and smoke result. Cutover refuses unless the stamp
is ready, at most 24 hours old, matches the release and current latestComplete
backup, and the dump is at most 26 hours old. Re-run prepare for a stale stamp.
Preparation releases `radar-change-lock` during long-running cluster Jobs; a
preparing stamp prevents a release cutover from consuming incomplete work.
Preparation failures stop owned Jobs, delete the smoke Deployment, discard the
disposable database, restore schedules and mark the slot failed. Uncertain
cleanup leaves it blocked until the stamp is older than every stage budget
combined (14400 s); the next prepare then abandons it to `failed` (recording
`abandonedAt` and keeping the dead run's record for forensics) and proceeds. Both prepare and cutover suspend schedules before
document work; prepare drains active refresh Jobs for up to ten minutes,
cutover deletes them immediately by UID. Sweep cursors under
`refresh/018/sweep/` are excluded from copy and reconciliation.

The `prepare-preprod-db` CI job runs only when the repository variable
`PREPROD_PREPARE_ENABLED` is `true` (absent = off). It is a rehearsal: its failure
on restore, DDL, 6H or smoke is reported as a warning and never gates the preprod
rollout. Releases carry `dataMigration: null` since production applied 6H on
2026-11-14. Its runner polls cluster Jobs for up to 240 minutes, aligned with the
sum of the preparation stage budgets (about 12 390 s after the preparing
stamp). This is incompatible
with the design's simultaneous five-minute runner wall-time budget; no long work
runs on the runner. The prepared smoke checks API health, SHA and anonymous
refusal; the existing full UI/MCP smoke runs during cutover.

## Installation (infrastructure/application owners)

1. Complete lot 0 **before installing the replacement**: re-mint the dedicated
   `radar-ci-bascule-preprod` durable credential; update only the GitHub
   `radar-bascule/KUBE_CONFIG_DATA_BASCULE_PREPROD` secret; verify `auth whoami`
   and Deployment reads; complete the existing daily workflow in `MODE=restore`.
   Record 90-day rotation and immediate incident revocation.
2. Install `rbac-preprod.yaml`, `rbac-prod.yaml` and the updated existing
   `../ci/bascule-preprod/rbac-ci-bascule-prod.yaml` through infrastructure.
   Production's namespace-scoped identity is `radar-ci-deployer`; put its
   kubeconfig in `production/KUBE_CONFIG_DATA`. Local production operators use
   that identity. Never substitute a cluster-wide shared credential.
3. Preserve the restored `allow-bascule-to-postgres` NetworkPolicy; the
   controller checks it and stamps every Job Pod with the application label and
   `sentropic.io/bascule=<operation UUID>`. No CNI attestation is requested.
4. Verify the fixed public installation values in `config.json`, the live
   database selected by the Secret, destination buckets and backup upload rights.
   Install the referenced database, backup-upload, backup-reader and document-copy
   Secrets. Local operators do not read their data. The daily workflow fills only
   its existing named reader/copy Secrets through `ci-secrets.mjs` under the lock.
5. Populate **both** `radar-cutover-6h` ConfigMaps with key `plan.json` matching
   `plan.example.json`. Use production `account_users.sub` values and the
   application's ratified 6G/6H roster, including explicit destinations and
   membership/capability assignments. Preprod-IdP subjects are invalid.
   No production roster was supplied or invented in this implementation.
6. Build a release containing `database-cutover.js`. Rehearse it and observe the
   next scheduled run. Both protected GitHub variables remain unchanged.
7. Complete the infrastructure prerequisites below. This branch ships manifests
   and documentation only; nothing is applied by the controller or by CI.

### Infrastructure prerequisites (owner: infrastructure)

| Prerequisite | Where | Check before use |
|---|---|---|
| Application role has `CREATEDB` (`ALTER ROLE <app role> CREATEDB`) | preprod PostgreSQL | `reset` refuses with `createdb_required` otherwise |
| Application role owns every application schema and may `CREATE EXTENSION postgis` | preprod PostgreSQL | the atomic restore drops and recreates them |
| PostgreSQL PVC holds both `radar` and `radar_next` plus WAL/temporary space; today 5 Gi in `deploy/k8s/20-postgres-postgis.yaml` | preprod namespace | measure both database sizes; expand the PVC if they do not fit twice |
| Restore Job within quota: requests 250m CPU / 1 Gi, limits 1500m CPU / 2 Gi (`restoreResources`; no 4-CPU node needed) | preprod `preprod-cap` ResourceQuota | Job admitted; keep 1500m CPU and 2 Gi of limits free |
| `rbac-preprod.yaml`, `rbac-prod.yaml` and `../ci/bascule-preprod/rbac-ci-bascule-prod.yaml` installed (Secret patch on `radar-db-credentials`, `radar-api-prepared` lifecycle, Job create/delete, get/list of KEDA `scaledobjects`/`scaledjobs`/`httpscaledobjects`, `verticalpodautoscalers` and Argo `rollouts`) | both namespaces | `prepare` and `run` check every right of the Role with `kubectl auth can-i` before any lock and fail with the missing rights; types absent from `kubectl api-resources` (CRD not installed) are skipped |
| `radar-backup-s3-credentials` can write and list the environment's `recoveryBucket` (`config.json`: preprod `sentropic-pgbackup-preprod`, prod `sentropic-pgbackup`) | both namespaces | the `probe` Job runs before closure and fails early otherwise |

The adapter rejects absent/unapproved accounts, conflicting workspaces or
destinations and revoked rights. It creates declared missing initialization
only, then uses protected durable resume. Scoped databases skip initialization
and attachment; 6K remains unchanged. Business behavior is covered by release
tests; cutover smoke checks availability, image identity and anonymous refusal.

## Failure and recovery

```sh
make -f deploy/cutover/operator.mk status ENV=preprod
make -f deploy/cutover/operator.mk resume RUN=<ORIGINAL_UUID> ENV=preprod
make -f deploy/cutover/operator.mk rollback RUN=<ORIGINAL_UUID> ENV=preprod
```

Use `ENV=prod` for production recovery. A repeated `run` never adopts a lock.
`radar-change-lock` contains the original route/consumer/schedule inventory,
release, backup pins, Job UIDs and checkpoints. It has no automatic expiry.
Takeover requires an ended local process or terminal GitHub run and an atomic
resource-version comparison. A foreign host or unknown executor stays refused.
Writer-workflow orphan locks also use `resume RUN`; failed cutovers retain their
record and stay closed. Explicit rollback selects the previous database and
previous immutable images, runs smoke and reopens. No automatic rollback occurs.
The database selection is a compare-and-set from the prepared database, else a
proof that the previous database is already selected (switch never started);
the expected mismatch is not reported. Reopening requires every recorded Job to
be terminal (Complete or Failed) with no live Pod, so a rollback after a refused
Job reopens.

After a caught failure, known database Jobs must stop. Missing Job evidence or
unreachable Kubernetes means **unknown**, never success. A successful recorded
restore is reconciled and never replayed because its checkpoint was interrupted.
A `restore`, `backup`, `ddl` or `data` Job that ended **Failed** is relaunched by
`resume` under a new Job name; the restore reset makes that relaunch idempotent.
### Daily restore (preprod) after closure

The daily restore replaces the live database only through the atomic restore
Job (one transaction): until it commits, the previous database is intact. Any
failure after closure starts (closure deadline, failed or stopped restore,
migration, rollout or smoke failure) therefore reopens instead of staying
closed: operation Jobs are stopped, a fresh `verify` Job proves that the live
database carries every migration of the deployed release, the original
Deployments, routes and schedules are restored, the private and public smokes
run, the lock is released and `REOPENED WITHOUT RESTORE` is printed. The
command still exits non-zero and the previous `radar-cutover-receipt` is kept.
A refused verification (restored database not yet migrated) or a started 6H
data migration keeps the site closed; `resume RUN` then continues forward.

The same reopening is available explicitly:

```sh
make -f deploy/cutover/operator.mk rollback RUN=<ORIGINAL_UUID> ENV=preprod
```

Lost GitHub executor (runner killed, job cancelled or timed out, so no trap
ran): the workflow `recover` job runs after a failed or cancelled `bascule`
job, takes over only the lock recorded for its own run once the GitHub API
reports the `bascule` job completed, and runs the same reopening. If that job
cannot run, an operator with `gh` authenticated runs `status` then the
`rollback` above; takeover is refused while the recorded job is not completed.

The closure check probes every Ingress host; a wildcard host
(`*.pages.preprod.immo…`) is probed through the concrete label
`cutover-probe.`. A closure deadline names the last unmet condition.

Routes return to maintenance after a reopening/public-smoke failure; schedules
remain suspended. Maintenance Services remain on failure and are deleted only
when no ingress references them after complete reopening.

On success, API/UI/MCP and all captured routes are available on the selected
release, original schedule states are restored, and the sanitized receipt is
saved in `radar-cutover-receipt` before releasing the lock. ACME solver ingresses
are excluded. Originally suspended CronJobs stay suspended.

### Preprod artifact catalogue (union, preprod only)

A prod-to-preprod restore (daily `MODE=restore` and `prepare`) keeps the
preprod artifacts and imports the prod ones. Spec:
`docs/spec/SPEC_EVOL_ARTIFACTS_RESTORE_PERSIST.md` §2b.

1. The `restore` Job writes `deploy/cutover/artifacts-catalogue.sh` to `/work`
   and, before the schema reset, exports the live preprod catalogue
   (`artifacts.*`) and stashes it in schema `catalogue_stash` of the database
   it restores. The reset spares `catalogue_stash` and `catalogue_journal`.
   `prepare` exports from the live database (`LIVE_DB`), never from the
   candidate. Each stash generation is tagged with the run and backup pin: the
   same run relaunched reuses its own; a pending stash of another run is never
   imported alone: the live database is exported again as a newer generation
   and every generation is imported, newest first. `prepare` also carries the
   pending generations of the live stash into the candidate.
2. The coherence gate runs, then the migrations (`ddl`, `data`).
3. The `catalogue` Job first copies the prod artifact blobs (init container
   `blobs`, `deploy/cutover/artifacts-blobs.sh`): prod bucket
   `radar-immobilier-artifacts`, prefix `artifacts/radar-immobilier/blobs/sha256/`,
   read only; destination `radar-immobilier-artifacts-preprod`, prefix
   `artifacts/radar-immobilier-preprod/blobs/sha256/`; missing names only, no
   delete. Then `import-stash` moves the prod rows to the preprod scope, checks
   that every visible release has its blobs, runs the union with the replayed
   prod catalogue, checks the blobs again, then drops the stash. Prod wins on any unique key; the preprod
   row is kept in `catalogue_journal.conflicts`, a row whose parent is gone is
   kept there as `orphan:<parent>`. Per-table counts land in
   `catalogue_journal.imports`. No stash = nothing to do (exit 0).

Hold: when a daily restore fails after its restore Job ran, the automatic
reopening first imports the catalogue (`catalogue` Job). If that import fails,
the site stays closed (`Automatic reopening refused`); fix the cause, then
`resume RUN`. Preprod never reopens on the prod replay without its artifacts.

Refusals (the run fails, nothing is imported, the stash stays for a rerun):

- Missing blob: a visible release references a `sha256:` digest absent from
  the preprod bucket listing (blob check before and after the union).
- Copy identity: Secret `radar-artifacts-restore-copy` (keys `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`) must exist in the preprod namespace with `s3:ListBucket` and
  `s3:GetObject` on `radar-immobilier-artifacts` (read only) and
  `s3:ListBucket`, `s3:GetObject`, `s3:PutObject` on
  `radar-immobilier-artifacts-preprod`. No delete right, no multipart right:
  each blob is one single-part copy (`-p 64` MiB); a blob above
  `RELEASE_FILE_BYTES_MAX` (16 MiB) is refused before any copy.
- In-flight publishes: the export refuses while `artifacts.object_intents`
  holds `pending` rows. Wait for them to drain (or let them expire), then
  relaunch. Closure (`MODE=restore`) and the writer drain (`prepare`) stop new
  publishes before the export.
- Schema: the restored database after the migrations must carry every
  migration the export was taken with (same release or newer). Refused before
  any load: a target column `NOT NULL` without default that the export lacks,
  or a common column whose type differs.
- Identity: a subject `rejected` in prod but `approved` in preprod refuses.

Prod never runs either side: `CATALOGUE_DIR` is empty outside preprod.

Journal of the last imports (read-only SQL on the preprod database):

```sql
SELECT tbl, exported, same, inserted, collisions, orphans FROM catalogue_journal.imports ORDER BY recorded_at DESC LIMIT 20;
```

## Daily and cross-tenant adapters

The scheduled caller remains at 04:00 UTC in `radar-bascule`, with the existing
`BASCULE_SCHEDULE_ENABLED` condition. It pins deployed images under the lock,
runs Drizzle and documents, skips the 6H hook and never triggers refresh.

```sh
make -f deploy/cutover/operator.mk run RELEASE=deployed MODE=restore BACKUP_ID=latest ENV=preprod
make -f deploy/cutover/operator.mk run RELEASE=deployed MODE=list CYCLE_ID=<cycle> ENV=preprod
```

Explicit-date selection and `backup-list-immo-*`, `immo-served-refs-*` and
`cycle-leg-immo-*` artifacts retain the cross-tenant contract. Reporting runs
separately from the normal availability gate. Live-dump chain mode and quiesce/
flip escape paths have been removed. Normal Make runs need no date token.

## Local verification

```sh
make -f deploy/cutover/operator.mk test ENV=test-cutover
make -f deploy/cutover/operator.mk test-api ENV=test-cutover
make -f deploy/cutover/operator.mk typecheck ENV=test-cutover
make -f deploy/cutover/operator.mk lint ENV=test-cutover
```

Each campaign takes the machine Docker lock, uses no published port, waits for
other test stacks and always runs `down -v`. Kubernetes and HTTP boundaries are
fake; adapter tests use isolated real PostgreSQL databases. Lint runs `eslint .`.

Typechecking covers every workspace. `test-api` runs the release adapter and
existing 6H activation/attachment and 6K cutover regression suites, plus
`atomic-restore.test.sh` (N-migration archive onto N+k with dependent foreign
keys, relaunch, truncated-archive rollback, prepared `-j 4` target) on PostgreSQL.

For a focused controller reproduction, pass `TEST_PATTERN='<test-name regex>'`
to `test`; omit it for the complete campaign. Backup/reporting self-tests always run.
