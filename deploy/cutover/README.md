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

Preprod preparation copies documents additively into the live preprod document
bucket before closure (additive copy, no deletion); this is kept
deliberately so the cutover never waits on document copy.

`radar-prepared-db` records preparation ownership, status, backup fingerprints,
release SHA, migration count and smoke result. Cutover refuses unless the stamp
is ready, at most 24 hours old, matches the release and current latestComplete
backup, and the dump is at most 26 hours old. Re-run prepare for a stale stamp.
Preparation releases `radar-change-lock` during long-running cluster Jobs; a
preparing stamp prevents a release cutover from consuming incomplete work.
Preparation failures stop owned Jobs, delete the smoke Deployment, discard the
disposable database, restore schedules and mark the slot failed. Uncertain
cleanup leaves it blocked. Both prepare and cutover suspend schedules before
document work; prepare drains active refresh Jobs for up to ten minutes,
cutover deletes them immediately by UID. Sweep cursors under
`refresh/018/sweep/` are excluded from copy and reconciliation.

The `prepare-preprod-db` CI job blocks deployment on restore, DDL, 6H or smoke
failure. Its runner polls cluster Jobs for up to 50 minutes. This is incompatible
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
| `rbac-preprod.yaml`, `rbac-prod.yaml` and `../ci/bascule-preprod/rbac-ci-bascule-prod.yaml` installed (Secret patch on `radar-db-credentials`, `radar-api-prepared` lifecycle, Job create/delete, get/list of KEDA `scaledobjects`/`scaledjobs`/`httpscaledobjects`, `verticalpodautoscalers` and Argo `rollouts`) | both namespaces | `prepare` and `run` check every right of the Role with `kubectl auth can-i` before any lock and fail with the missing rights |
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
Routes return to maintenance after a reopening/public-smoke failure; schedules
remain suspended. Maintenance Services remain on failure and are deleted only
when no ingress references them after complete reopening.

On success, API/UI/MCP and all captured routes are available on the selected
release, original schedule states are restored, and the sanitized receipt is
saved in `radar-cutover-receipt` before releasing the lock. ACME solver ingresses
are excluded. Originally suspended CronJobs stay suspended.

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
