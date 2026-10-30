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

Release cutover is blue/green and never closes a route (see "Release cutover:
switch, freeze, promotion, rollback, logs"). No dump restoration or migration
runs during release cutover. Preprod preparation clones the staged template into
the other database of `radar` / `radar_next` in the same instance, then runs
DDL, protected 6H and starts the prepared slot with its private smoke. The live
Secret remains untouched until promotion: a compare-and-swap JSON patch changes
only `POSTGRES_DB`. Old databases are retained. Production preparation takes a
recovery backup and verifies the live release migration hashes; production
cutover changes images only.

Both restore paths run `atomic-restore.sh`: every application schema is dropped
with `CASCADE` and recreated, then the archive is replayed without `--clean`, so
a snapshot with fewer migrations than the destination restores and a rerun is
idempotent. The daily live restore keeps the reset and the replay in one
transaction (COMMIT only after the whole archive was read); the template
database commits the reset, then loads with `pg_restore -j 2` (tuned).
Recovery backups go to the per-environment `recoveryBucket` in `config.json`;
a write/list `probe` Job runs before any closure and fails early.
The restore Job uses the per-environment `restoreResources` of `config.json`
(requests 250m CPU / 1 Gi, limits 1500m CPU / 2 Gi), which fits the preprod
`preprod-cap` ResourceQuota and LimitRange.
Preparation records `recoveryReference` for rollback: the production recovery
backup object, or the retained previous preprod database.

Prepared verification includes the preprod document re-check (`recon`): it
lists the preprod bucket, so it runs after writers are suspended and before any
switch, with the preparation deadline (840 s).

Documents are copied additively into the live preprod document bucket by the
template staging (additive copy, no deletion), so the cutover never waits on
document copy.

`radar-prepared-db` records preparation ownership, status, backup fingerprints,
release SHA, migration count and smoke result. Cutover refuses unless the stamp
is ready, at most 24 hours old, matches the release and current latestComplete
backup, and the dump is at most 26 hours old. Re-run prepare for a stale stamp.
Preparation releases `radar-change-lock` during long-running cluster Jobs; a
preparing stamp prevents a release cutover from consuming incomplete work.
Preparation failures stop owned Jobs, export the logs of and delete the prepared
slot, discard the disposable database, restore schedules and mark the slot
failed. Uncertain cleanup leaves it blocked. Prepare, staging and release
cutover suspend schedules and drain active refresh Jobs for up to ten minutes;
the daily restore deletes them immediately by UID. Sweep cursors under
`refresh/018/sweep/` are excluded from copy and reconciliation.

The `prepare-preprod-db` CI job blocks deployment on restore, DDL, 6H or smoke
failure. Its runner polls cluster Jobs for up to 50 minutes. This is incompatible
with the design's simultaneous five-minute runner wall-time budget; no long work
runs on the runner. The prepared smoke is the full UI/API/MCP smoke through the
prepared Services; the public smoke runs again after the switch.

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
Every operation waits up to `LOCK_WAIT` seconds (default 900) for a competing
operation to release `radar-change-lock` (daily restore at 04:00, staging at
05:00, release chain) instead of failing at once; waiting never adopts a lock.
`radar-change-lock` contains the original route/consumer/schedule inventory,
release, backup pins, Job UIDs and checkpoints. It has no automatic expiry.
Takeover requires an ended local process or terminal GitHub run and an atomic
resource-version comparison. A foreign host or unknown executor stays refused.
Writer-workflow orphan locks also use `resume RUN`. A release cutover never
closes: its recovery (automatic switch back before promotion, `resume` after,
`rollback`) is described under "Release cutover". The database selection is a
compare-and-set from the expected database, else a proof that the target is
already selected; the expected mismatch is not reported. A daily restore that
fails stays closed for explicit recovery; reopening requires every recorded Job
to be terminal (Complete or Failed) with no live Pod.

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

## Zero-downtime cutover (blue/green)

Design: blue/green by Service selector, data restore from a staged template
database, rehearsed in the preprod CI/CD. Every step below is code delivered in
this directory; nothing is applied to a cluster by CI or by the builder. Live
applications (RBAC, volume expansion, slot adoption, arming) are operator acts.

### Measurements (receipts)

The `database` Job reports `databaseSizes`, `sessionsByDb` and
`maxConnections`. The `docs` and `recon` Jobs report `timings` (`listMs`,
`planMs`, `copyMs`, `reconListMs`), `destListCalls` and
`destListCallsPerShard`. A restore into a prepared or template database
reports `restoreMs`, the ten slowest archive items (`top1Ms`..`top10Ms`, from a
timestamped `pg_restore --verbose`) and cgroup CPU deltas (`cpu_usage_usec`,
`cpu_nr_throttled`, `cpu_throttled_usec`). Job wrappers keep bounded numeric
values only; the merged verdicts land in the lock record, the prepared stamp and
`radar-cutover-receipt`.

### PostgreSQL volume expansion (one-time, operator)

The template, the prepared database and the live database share one volume.
Required size: see below. The StatefulSet
`volumeClaimTemplates` field is immutable, so the claim itself is patched
(compare-and-swap on its UID and current size, never shrunk):

```sh
make -f deploy/cutover/operator.mk pvc-expand ENV=preprod          # computed size
make -f deploy/cutover/operator.mk pvc-expand SIZE=12Gi ENV=preprod # explicit, refused below the computed size
make -f deploy/cutover/operator.mk pvc-verify ENV=preprod
```

Occupancy is measured in SQL by a `volume` Job (every database plus the WAL:
`pg_ls_waldir` when granted, else the `max_wal_size` ceiling) and compared to the
claim `status.capacity`; no Role grants `pods/exec`. The target size is
max(10 GiB, used + 2 x live database + 2 GiB). When the claim reports
`FileSystemResizePending`, restart `radar-postgres-0` once, outside any cutover
window (owner-scheduled), then run `pvc-verify`: it requires free capacity of at
least 2 x live database + 2 GiB. Staging refuses `volume_insufficient` otherwise.
`pvc-expand` and `slots-adopt` need the one-time Role of `rbac-adopt-<env>.yaml`
(claim patch, orphaning delete of the canonical Deployments, deletion of unnamed
ReplicaSets): install it for these acts, then remove it.

### Slot adoption (one-time, operator)

```sh
make -f deploy/cutover/operator.mk slots-adopt DRAIN=15 ENV=preprod
```

Under `radar-change-lock`, for `radar-api`, `radar-immo-mcp` then `radar-ui`:
delete the Deployment with `propagationPolicy: Orphan` (UID precondition; the
running ReplicaSet keeps serving), recreate it with selector and template label
`sentropic.io/slot=main`, wait Ready, add `slot=main` to the Service selector
(JSON-patch `test` on the whole selector), wait until the EndpointSlices list
only `slot=main` Pods, wait `DRAIN` seconds, then delete the orphaned
ReplicaSet. A rerun skips completed steps. MCP sessions re-initialize once.
The last-applied annotation is kept, so a later client-side `kubectl apply` of
the unlabelled manifests (the CI MCP apply included) keeps the slot labels; the
manifests deliberately do not carry the label, because an apply that changes a
Deployment selector before adoption would be rejected (immutable field).

### Staged template and clone (restore in under five minutes)

`T_restore` runs from the start of `resolve` to the `destination` verdict on the
prepared database. Restoring the archive inside that window took about 885 s;
the restore now happens earlier, once a day, into a template database:

```sh
make -f deploy/cutover/operator.mk stage RELEASE=deployed ENV=preprod
```

`stage` (preprod only, under `radar-change-lock`, refused while a preparation
is `preparing` or when free volume space is below 2 x database + 2 GiB) pins the
latest complete backup, stamps `radar-template-db` as `building`, drops and
recreates `radar_tpl` (`tplreset`), restores the archive into it with
`pg_restore -j 2`, `maintenance_work_mem=128MB`, `synchronous_commit=off` and a
`vacuumdb --analyze-only` pass, copies the documents (with their internal
reconciliation), then seals it (`tplseal`: `ALLOW_CONNECTIONS false`, sessions
terminated) and stamps `ready` with the backup date, fingerprints, migration
count and size. A rerun starts by dropping the template.

`prepare` pins the backup; when the template stamp is `ready` and matches the
pin it runs `clone` (`DROP DATABASE IF EXISTS <target>`, then
`CREATE DATABASE <target> TEMPLATE radar_tpl STRATEGY FILE_COPY`), one `recon`,
`ddl`, `data` and `destination`. Otherwise it stages first
(`restorePath=stage+clone`, about 15 minutes, reported) and skips the separate
`recon` because staging already reconciled the documents. The prepared stamp
records `restorePath` and `restoreSeconds`; the CI rehearsal fails when
`restoreSeconds` exceeds 300 or `restorePath` is not `clone`.

The destination listing (`docs`, `recon`) uses 64 shards listed 64 at a time
(`LIST_CONCURRENCY`, independent of the copy workers): the sequential depth per
shard drops from about 27 pages to about 7 on the preprod bucket.

### Prepared slot

After `destination`, `prepare` starts the prepared slot: `radar-api-prepared`,
`radar-immo-mcp-prepared` and `radar-ui-prepared` Deployments plus internal
Services of the same names and `radar-ui-nginx-prepared` (the UI nginx
ConfigMap with `proxy_pass http://radar-api-prepared:3000`). Pods keep the
canonical component labels (NetworkPolicies apply), carry
`sentropic.io/slot=prepared`, a literal `POSTGRES_DB=<targetDb>`, the release
images and `terminationGracePeriodSeconds: 30`; the prepared MCP calls
`RADAR_API_BASE_URL=http://radar-api-prepared:3000`. Replicas equal the
current canonical count (an HPA-scaled count included). A quota preflight
reads every ResourceQuota status and refuses `quota_insufficient` before
creating anything. The full private smoke (UI, build SHA, API health, anonymous
refusal, MCP bearer challenge and metadata) runs through the prepared Services;
the canonical Services and Ingresses are untouched. `prepare`, `run` and `rollback` refuse
`slots_not_adopted` before creating anything (lock included) unless every canonical
Deployment selects and labels `sentropic.io/slot=main` and every canonical
Service selects by slot: an unadopted Service selects only the component labels
and would route real traffic to prepared Pods. The slot stays Ready for the
switch; a new preparation deletes a previous slot first, a failed preparation
deletes it, and the daily `MODE=restore` refuses `prepared_stack_present`.

### Release cutover: switch, freeze, promotion, rollback, logs

```sh
make -f deploy/cutover/operator.mk run RELEASE=cutover-release/release.json OBSERVE=600 DRAIN=15 ENV=preprod
make -f deploy/cutover/operator.mk run RELEASE=cutover-release/release.json SAMEDB=1 OBSERVE=60 ENV=preprod
make -f deploy/cutover/operator.mk run RELEASE=cutover-release/release.json OBSERVE=120 DRILL=1 ENV=preprod
make -f deploy/cutover/operator.mk run RELEASE=cutover-release/release.json ENV=prod
```

No route is ever closed. Under `radar-change-lock`, `run` (MODE=run) executes:

1. Verify the prepared stamp (release, backup pin, migrations), record the
   deployed release as `.previousRelease`, run `recon` (preprod) and check the
   prepared slot is Ready on the selected database (`SAMEDB=1`: the live
   database, images only, the production path; otherwise the prepared one) and
   restarts it when it is not. Writer schedules are suspended and in-flight
   refresh Jobs drain (at most ten minutes).
2. Preprod without `SAMEDB`: `freeze` Job on the live database
   (`ALTER DATABASE ... SET default_transaction_read_only = on`, sessions opened
   before terminated and read back as gone) records `frozenAt`. From then on a
   write answers 503 `{"error":"maintenance_read_only"}` with `Retry-After: 5`
   (SQLSTATE 25006 / 57P01 mapped by `api/src/lifecycle/maintenance.ts`, also when a
   route catches the error itself; every pooled client, idle or checked out, keeps
   an error listener so a terminated session never crashes the API); reads are
   served. Production: one shared database, no freeze.
3. Switch: one JSON patch per Service with a `test` on the current
   `sentropic.io/slot` value (radar-api, radar-immo-mcp, radar-ui), then wait
   until every EndpointSlice lists only `slot=prepared` Pods; the mixed window is
   recorded (`switches[].mixedWindowMs`). Public `/health` and `/build.json` must
   serve the release (`firstGreenAt`, `freezeWindowMs` = first green - frozenAt),
   then the full public smoke runs. Any failure switches back (reverse order),
   unfreezes and exits non-zero.
4. Retention `OBSERVE` seconds (default 600): the public build is re-checked
   every 5 s; a degradation switches back. `DRILL=1`: switch back to `main`, the
   previous build must be served within 5 s (`drill.backMs`; preprod writes stay
   503 while frozen), then switch to `prepared` again.
5. Promotion (`checkpoints.promote`): export the `main` logs; preprod: CAS the
   Secret `POSTGRES_DB` live -> target and remove `GEO_DOCUMENTS_REPOINT`; patch
   the canonical images and the template annotation
   `sentropic.io/promoted-run=<RUN>` (a new ReplicaSet even for the same SHA),
   require new Ready Pods with another `pod-template-hash`, smoke the canonical
   Deployments through port-forwards and check the database identity (`database`
   Job); switch the Services back to `main`, wait the EndpointSlices and `DRAIN`
   seconds (default 15), export the `prepared` logs, delete the prepared slot.
6. Patch CronJob images, restore the schedules, verify, mark the preprod
   prepared stamp `consumed`, save `radar-cutover-receipt`, release the lock.

Logs (R5): the `logs*` Jobs (`logs-export-job.tmpl.yaml`, `logs-export.cjs`,
ServiceAccount from `rbac-logs-<env>.yaml`) start BEFORE the recorded Pods are
re-rolled or deleted, follow (`follow=true`) the log of every container until the
container exits (the SIGTERM drain lines included) and add the previous instance.
The Job Pod is Ready only once every stream is open: no deletion or re-roll starts
before. They write
`s3://<recoveryBucket>/cutover-logs/<env>/<RUN>/<slot><n>/<pod>/<container>[.previous].log.gz`
plus `manifest.json` (sha256, bytes, lines, first/last timestamp), each object
re-read and verified. The verdict must list every recorded Pod UID, else the
command stops (no further deletion). On `resume`, an export whose Pods are already
gone and whose manifest is incomplete is recorded in the receipt as `logGaps`
(the rehearsal fails on any gap). Slot adoption follows the orphaned ReplicaSet
Pods the same way before deleting them.

Recovery: a failure before promotion returns routing to `main`, unfreezes,
restores the schedules and removes the prepared slot (logs exported) automatically,
so the daily restore is never blocked by a leftover slot. A failure after promotion started keeps
the lock: `resume RUN=<uuid>` completes the promotion idempotently.
`rollback RUN=<uuid>` with that run's lock still present (interrupted before
promotion) switches back and unfreezes. After a promoted run, `rollback RUN=`
rebuilds a prepared slot from `.previousRelease` (production: the same database;
preprod: the retained previous database, unfrozen first, while the current one
is frozen; writes made on the promoted database are not carried), switches to
it and promotes it, without outage. Abandoned writes (preprod): a return to the previous
database, before promotion (switch back) or after it (`rollback RUN=`), leaves the
writes acknowledged by the abandoned database behind. They are counted as written
tuples (`pg_stat_database`, against the baseline taken before the switch; `-1`
when unknown), recorded in the receipt (`abandoned`) and appended, never overwritten,
as an entry of `radar-retained-db`; the next `prepare` refuses
`retained_db_unacknowledged` instead of replacing a database with a pending entry.
After an operator rollback the conductor reviews the receipt and runs
`make -f deploy/cutover/operator.mk ack RUN=<uuid> ENV=preprod`. The rehearsal
acknowledges its own rollback entries itself (`ack-probe RUN=<uuid> PROBE=<prefix>`)
only when the rows of its probe runs written in that database since the baseline
explain every abandoned tuple; the proof (prefix, probe rows, tuples) is stored in
the entry and in the rehearsal artifacts. Otherwise, or when a pending entry not
from the probe exists, the rehearsal fails and the conductor acknowledges. The probe
verdict is red when probe writes acknowledged by the abandoned database are not
detected (`abandoned-undetected`). The maintenance page remains only for the
daily `MODE=restore`. The API stops gracefully on SIGTERM
(`api/src/lifecycle/graceful.ts`: stop accepting, close SSE streams, wait for
in-flight requests up to 25 s; `terminationGracePeriodSeconds: 30`). MCP
sessions on the other slot answer 404 and the client re-initializes.

### Probes (rehearsal evidence)

- `availability-probe.mjs <url> <out.jsonl>`: 5 Hz on `/health`, `/build.json`
  and `/.well-known/oauth-protected-resource/mcp` (status, latency, served SHA,
  transport error or timeout).
- `writer-probe.mjs <url> <probe-run> <out.jsonl>`: 5 writes/s to
  `POST /api/internal/cutover-probe` (bearer `CUTOVER_PROBE_TOKEN` from the
  optional Secret `radar-cutover-probe`; the route answers 404 unless
  `CUTOVER_PROBE_ENABLED=true` in the `radar-api` ConfigMap, preprod only). Each
  acknowledged write is a row of `cutover_probe_writes` (migration 0028) and the
  answer names the database that stored it.
- `make -f deploy/cutover/operator.mk probe-verify PROBE=<probe-run> OUTPUT=<dir> ENV=preprod`:
  a `probeverify` Job reads the acknowledged rows of `radar` and `radar_next` back
  as sequence ranges (`<dir>/probe-ranges.json`).
- `probe-verify.mjs <reads> <writes> <receipt> <ranges> <samedb|preprod>`: the
  verdict. Red on any read transport error, timeout, 5xx or gap above 1 s; a
  served SHA other than the release after the first green response (outside the
  drill); a lost write (acknowledged, absent from the database that acked it);
  `samedb`: any refused write; `preprod`: an acknowledgement from the live
  database after `frozenAt`, a refusal other than 503 `maintenance_read_only`, a
  503 outside [`freezeStartedAt`, first green] (+ drill), a freeze window above
  10 s; a mixed window above 2 s; a drill not back on the previous build within
  5 s.

### CI/CD release and rehearsal (preprod)

`prepare-preprod-db` reads `make -f deploy/cutover/operator.mk slots-status ENV=preprod`
(`adopted` or `legacy`). Legacy (slots not adopted yet): no preparation,
`deploy-preprod` keeps its direct migrate + roll path. Adopted (conductor
decision): `prepare` runs, `deploy-preprod` applies the configuration only
(`RECONCILE_CONFIG_ONLY=1`: ConfigMaps, no Deployment or CronJob apply, no MCP
roll, no migration, no `set-image`, no served-SHA assertion) and the job
`rehearse-preprod-bluegreen` performs the preprod release itself:

```sh
make -f deploy/cutover/operator.mk rehearse RELEASE=cutover-release/release.json OUTPUT=rehearsal ENV=preprod
```

Scenarios, each under the read and writer probes and judged by
`probe-verify.mjs`: `preprod` (`run OBSERVE=120 DRILL=1`, previous -> new
release: freeze, prepared database, routing drill back to the previous build),
`rollback` (`rollback RUN=<preprod run>`: the previous release rebuilt on the
retained database, which is unfrozen first, while the promoted one is frozen),
`repromote` (`rollback RUN=<rollback run>`: the new release back on its database),
then `samedb` (`run SAMEDB=1 OBSERVE=60`, the production path on the now
migrated live database). Red when the prepared stamp is not `restorePath=clone`
with `restoreSeconds <= 300`, when the previous and new releases are the same
(no version change), and per scenario when the run fails, `probe-verify.mjs`
reports a violation, a prepared Deployment is left, a `logGaps` entry exists, or
the sessions exceed 80 % of `max_connections`. A run interrupted after its
promotion started is completed by `resume RUN=<uuid>` at once (the scenario stays
red). A prepared slot whose ConfigMaps changed since its start (configuration
fingerprint) is restarted before any switch. Evidence is uploaded as
`cutover-rehearsal-<sha>`. `bascule-stage-preprod.yml` stages the template daily
at 05:00 UTC when `vars.BASCULE_STAGE_ENABLED == 'true'` (owner arming) or on
manual dispatch. `PREPROD_CD_ENABLED` and `BASCULE_SCHEDULE_ENABLED` are never
written.

### Live application order (operator; nothing is applied by this branch)

1. Install `rbac-preprod.yaml`, `rbac-prod.yaml`, `rbac-logs-preprod.yaml`,
   `rbac-logs-prod.yaml` (permanent); preprod: create Secret `radar-cutover-probe`
   (`CUTOVER_PROBE_TOKEN`, 32+ characters, also as the GitHub secret
   `CUTOVER_PROBE_TOKEN`) and set `CUTOVER_PROBE_ENABLED=true` in the preprod
   `radar-api` ConfigMap.
2. From a checkout of this branch, BEFORE its merge: install
   `rbac-adopt-<env>.yaml`, run `pvc-expand` / `pvc-verify` (preprod; restart
   `radar-postgres-0` once if the resize is pending) and `slots-adopt DRAIN=15`
   (preprod, then production), then remove `rbac-adopt-<env>.yaml`. Until then,
   `prepare`, `run` and `rollback` refuse `slots_not_adopted` and the preprod CI
   keeps the legacy path.
3. Merge and deploy (migration 0028, graceful stop, 503 mapping, probe route).
4. `stage RELEASE=deployed` (or dispatch `bascule-stage-preprod.yml`), then arm
   `BASCULE_STAGE_ENABLED` when ready.
