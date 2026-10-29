# Sequential database cutover

Run on Linux from the repository root with Bash, kubectl, jq, curl and GNU coreutils;
`gh` is needed for artifact downloads and GitHub-executor recovery.
The standalone Makefile never includes the root Makefile or reads dotenv files.
Local execution consumes installed namespace Secrets. No Python is used.

```sh
make -f deploy/cutover/operator.mk download-release BUILD_RUN=<BUILD_RUN_ID> SHA=<FULL_GIT_SHA> ENV=preprod
make -f deploy/cutover/operator.mk run RELEASE=cutover-release/release.json ENV=preprod
make -f deploy/cutover/operator.mk run RELEASE=cutover-release/release.json ENV=prod
```

Rehearse the exact generated manifest in preprod before promoting that manifest
to production. Promotion downloads the original successful main build's artifact
by build-run ID and never rebuilds images. `dataMigration` accepts only `"6h"`
or `null`; changing it selects the sole approved hook, never arbitrary code.
OCI revision labels are not required (approved addendum).

The six printed stages restore, close, migrate, restart, test and reopen.
Production skips the production-to-preprod restore. Both destinations receive
a current recovery backup before DDL. Document copies are additive and pinned
to the resolved production backup, prepared before closure. Production is only
a backup source during preprod restoration. No refresh is triggered.

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
4. Verify the fixed public installation values in `config.json`, database
   `radar`, destination document buckets and upload rights for `db-backups/`.
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

The adapter rejects absent/unapproved accounts, conflicting workspaces or
destinations and revoked rights. It creates declared missing initialization
only, then uses protected durable resume. Scoped databases skip initialization
and attachment; 6K remains unchanged. Business behavior is covered by release
tests; cutover smoke checks availability, image identity and anonymous refusal.

## Failure and recovery

```sh
make -f deploy/cutover/operator.mk status ENV=preprod
make -f deploy/cutover/operator.mk resume RUN=<ORIGINAL_UUID> ENV=preprod
```

Use `ENV=prod` for production recovery. A repeated `run` never adopts a lock.
`radar-change-lock` contains the original route/consumer/schedule inventory,
release, backup pins, Job UIDs and checkpoints. It has no automatic expiry.
Takeover requires an ended local process or terminal GitHub run and an atomic
resource-version comparison. A foreign host or unknown executor stays refused.
Writer-workflow orphan locks also use `resume RUN`; failed cutovers retain their
record and stay closed. No automatic database or image rollback occurs.

After a caught failure, known database Jobs must stop. Missing Job evidence or
unreachable Kubernetes means **unknown**, never success. A successful recorded
restore is reconciled and never replayed because its checkpoint was interrupted.
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
