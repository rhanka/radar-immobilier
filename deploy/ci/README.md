# `deploy/ci/` — CD orchestration & mise-en-prod runbook

The CI-side helpers that `.github/workflows/build-push-images.yml` calls into
during a release, plus the **release sequence** each voie runs. The workflow is
the source of truth; this file documents the contract so a reader does not have
to reverse-engineer the YAML.

## Release sequence (per voie)

Every armed release path runs the same ordered, **fail-closed** sequence:

```
backup → migrate → set-image → assert
```

- **backup** — pre-migration snapshot (`run-db-backup.sh`, fail-closed). This is
  the rollback point. It runs **before** migrate on purpose: a snapshot taken
  after a migration is not a valid rollback target. This ordering is load-bearing
  for any future **destructive** migration — do not reorder.
- **migrate** — drizzle migrations (`node dist/db/migrate.js`, base manifest
  `deploy/k8s/36-db-migrate-job.yaml`), run as a Job pinned to the exact image
  the voie is about to deploy. Fail-closed: a failed or timed-out migration
  **aborts the release before set-image**, so no code ever rolls onto an
  un-migrated DB. Idempotent: the drizzle journal replays already-applied
  migrations as a no-op, so re-running a release re-runs migrate harmlessly.
- **set-image** — roll the Deployments to the released image (preprod: `<sha7>`
  tag; prod: immutable digest).
- **assert** — post-roll rollout/health checks already present in each job.

### Arming — the sequence runs **only WHEN ARMED**

Backup **and** migrate are gated on the **same** enable var per voie
(`BACKUP_BEFORE_RELEASE_ENABLED` for preprod, `BACKUP_BEFORE_RELEASE_PROD_ENABLED`
for prod). Two consequences:

- Migrate can never run without a fresh pre-migration backup preceding it — the
  shared gate is what guarantees the rollback point.
- When the var is **not** `'true'`, the sequence above does **not** run: both
  backup and migrate are **skipped** and the deploy proceeds through the rest of
  its steps (reconcile / apply-mcp, then set-image) with no backup and no
  migration. For a release carrying a pending schema change (e.g. drizzle `0011`)
  that rolls new code onto an **un-migrated** DB. This staged arming is by design
  — prod ships **disarmed until the cutover**, so merging never arms prod as a
  side effect — but the skip is **never silent**: a disarmed run emits a loud
  `::warning::` (the `Warn if DB backup+migrate DISARMED …` step).

**Runbook — arm before a schema-change release:** set
`BACKUP_BEFORE_RELEASE_PROD_ENABLED = 'true'` (prod) or
`BACKUP_BEFORE_RELEASE_ENABLED = 'true'` (preprod) before promoting/deploying any
release that carries a pending migration, so backup+migrate actually run.

## Voies (jobs in `build-push-images.yml`)

| Job | Trigger | Namespace | Image pin | Migrate | Enable var (backup + migrate) |
|---|---|---|---|---|---|
| `deploy-preprod` | push `main` | `radar-immobilier-preprod` | `<sha7>` tag | ✅ *(when armed)* | `BACKUP_BEFORE_RELEASE_ENABLED` |
| `promote-prod` | tag `v*` | `radar-immobilier` | immutable **digest** | ✅ *(when armed)* | `BACKUP_BEFORE_RELEASE_PROD_ENABLED` |
| `deploy` *(legacy)* | push `main` | `radar-immobilier` | `<sha7>` tag | ❌ **by design** | — |

- **Preprod (`deploy-preprod`)** — gated by **two** switches: `PREPROD_CD_ENABLED
  == 'true'` arms the preprod voie itself, and `BACKUP_BEFORE_RELEASE_ENABLED ==
  'true'` arms backup+migrate within it. **When both are armed**, every push to
  `main` replays the migrations against preprod — the test-before-prod check: a
  migration that would break prod fails here first. (Voie armed but backup+migrate
  disarmed → a push deploys preprod without running migrate; see the Arming
  section above.)
- **Prod (`promote-prod`)** — a `v*` tag promotes the already-built,
  already-preprod-tested artifact to prod **by immutable digest** (the `<sha7>`
  tag may have aged out of the registry). The migrate Job is pinned to that same
  digest, so the migration and the deployed code are byte-identical. The
  `radar-immo-mcp` drift-heal apply (which pins `radar-api:latest` with a
  `Recreate` strategy, so it rolls MCP pods onto new code) runs **after** migrate
  and before set-image, so MCP is not rolled onto new code before this release's
  migrations are applied.
- **Legacy `deploy` (main→prod)** — the pre-cutover direct path. Superseded by
  `deploy-preprod` + `promote-prod` once `PREPROD_CD_ENABLED` is set. It carries
  **no migrate step by design**: it is a void path that must not be the one that
  migrates prod. Its gate is the inverse of the new path: if `PREPROD_CD_ENABLED`
  is ever unset/flipped off, legacy `deploy` **re-arms** and would roll `main→prod`
  with **no backup and no migrate** — so **removing the job is the durable fix**.
  **Follow-up (separate PR, at cutover): delete the legacy `deploy` job.** Until
  then it stays gated OFF by `PREPROD_CD_ENABLED`.

### Migrate Job mechanics

The migrate step overlays `deploy/k8s/36-db-migrate-job.yaml` with `kubectl
kustomize` at release time (the base is **copied into a tmpdir** so no
`--load-restrictor` flag is needed), overriding:

- `namespace` → the voie's namespace;
- `nameSuffix: -<sha7>` → a **per-sha Job name** (`radar-db-migrate-<sha7>`), so a
  re-deploy within the Job's `ttlSecondsAfterFinished` window does not collide
  with a lingering completed Job (a `delete --ignore-not-found` precedes the apply
  as a belt-and-braces);
- `images` → the exact release image (preprod: `newTag: <sha7>`; prod: `digest:
  <resolved digest>`).

The step then polls the Job: `Complete` → proceed; `Failed` or 600 s timeout →
`exit 1` (release aborts before set-image). The abort decision reads only `get
job` conditions — it does **not** depend on pod logs, so it is robust in both
voies.

A migration that *hangs* (a blocked `ALTER`/`CREATE INDEX`) is stopped for real,
not just abandoned by the poller, through two layers:

- the base Job carries `activeDeadlineSeconds: 540` (kept **below** the 600 s CI
  poll) so the cluster self-terminates the pod with `DeadlineExceeded` → `Failed`
  *before* the CI times out, giving the poll a clean condition to abort on;
- on either abort path the step also runs `kubectl delete job <name>
  --ignore-not-found` before `exit 1`, which requests deletion of the Job and its
  pod so the in-cluster work is torn down even if self-termination lags (subject
  to the pod's normal termination grace).

On failure the step also tries `kubectl logs job/<name> --tail=80` for inline
debugging, but this is **best-effort and voie-dependent**:

- **prod** (`promote-prod`) — there is no scoped prod deployer ServiceAccount;
  the job authenticates with an owner kubeconfig from an environment secret, a
  broad credential that can typically read pod logs, so the last 80 lines are
  usually dumped inline in the CI output.
- **preprod** (`deploy-preprod`) — `11-ci-deployer-preprod-rbac` **deliberately
  withholds `pods/log`** (least-priv: the runner cannot read Job pod logs), so the
  `logs` call is a guarded `|| true` no-op (HTTP 403). A failed preprod migration
  therefore dumps **no inline logs** in CI — the abort still fires correctly;
  debug from the owner-side cluster logs. This is by design; do not grant the
  preprod runner `pods/log` to get the inline dump, as that would weaken the
  least-priv posture `11-ci-deployer-preprod-rbac` deliberately took.

## Helpers in this directory

| File | Role |
|---|---|
| `run-db-backup.sh` | Renders + applies the backup Job, polls fail-closed, then prunes retention **chronologically** (by S3 date, never lexically by key) and **never** deletes the just-created backup. |
| `db-backup-job.tmpl.yaml` | Backup Job template consumed by `run-db-backup.sh`. |
| `rollback-release.sh` | Roll a Deployment back to a prior image. |
| `reconcile-preprod.sh` | Targeted server-side apply of preprod manifests. |
| `kfilter.py` | Manifest filter used by the reconcile step. |
| `*.test.sh` | Shell tests for the runners above. |

## Resumable whole-bucket inventory

Long MinIO inventories use a durable checkpoint while every attempt writes a
fresh report directory:

```text
migrate-object-storage.sh inventory <coordinates and classifications> \
  --report-dir report-01 --checkpoint-dir checkpoint \
  --page-size 100 --time-budget-seconds 300
migrate-object-storage.sh inventory <same arguments> \
  --report-dir report-02 --checkpoint-dir checkpoint \
  --page-size 100 --time-budget-seconds 300 --resume
```

Receipts cover the bucket root; prefixes classify keys but never limit listing.
Pages and body-evidence shards are hash-bound, atomically committed, and resumed
with exclusive `StartAfter` boundaries. Coordinates, identity fingerprints,
classification and limits are bound by `configDigest`. No credential or opaque
continuation token is persisted. Object keys are persisted, so checkpoint
custody is an operator responsibility.

After the provisional chain completes, repeat the same resumable inventory with
the validated writer-fence file. This builds a separate `fenced/` chain and
emits `final-inventory.json` only if both complete bucket observations are
stable. `toolComplete:true` never means the fence was validated:
`fenceValidated:false` remains explicit.

Every executed copy requires that final artifact and the same fence:

```text
migrate-object-storage.sh copy <same coordinates and classifications> \
  --report-dir copy-report --execute-copy \
  --fence-record writer-fence.txt \
  --inventory-proof checkpoint/final-inventory.json \
  --conditional-write-proof conditional-write-proof.json
```

The copy consumes the frozen manifests instead of relisting either bucket and
re-hashes each source body immediately before its conditional PUT. Source
versions and delete markers outside the current `ListObjectsV2` view remain out
of scope. The final inventory proof has no tool-enforced maximum age. Its
freshness therefore remains under conductor custody: retain the exact matching
fence evidence, independently confirm that the fence is still continuously
valid, and regenerate both inventory phases if custody or fence continuity is
uncertain. A structurally valid old proof is not fresh evidence by itself.

## Object-storage conditional-write gate

`migrate-object-storage.sh copy --execute-copy` requires
`--conditional-write-proof FILE`. The operator creates this JSON evidence from
a disposable-key probe against the exact destination, using the same migration
identity. The probe must prove both that a duplicate `If-None-Match: *` create
is rejected and that an update with a stale `If-Match` ETag is rejected:

```json
{
  "schemaVersion": 1,
  "provider": "provider implementation",
  "providerVersion": "observed version or release",
  "destination": {
    "endpoint": "https://s3.example.net",
    "region": "region",
    "bucket": "destination-bucket",
    "pathStyle": false
  },
  "identityFingerprint": "sha256-of-access-key-id",
  "observedAt": "2026-09-13T12:00:00Z",
  "expiresAt": "2026-09-14T12:00:00Z",
  "transcriptSha256": "64-lowercase-hex-characters",
  "capabilities": {"ifNoneMatchCreate": true, "ifMatchUpdate": true}
}
```

The tool validates the schema, exact destination tuple, identity fingerprint,
and a validity window of at most 48 hours before any destination write. It
records the proof digest and
`providerEnforcementValidated:false`: custody and validation of the probe
transcript remain conductor responsibilities. Missing, expired or mismatched
evidence is a `missingProof` and prevents every PUT.

The inventory covers current objects returned by `ListObjectsV2`. It does not
migrate source version history or delete markers; that boundary requires owner
acceptance before a real copy.

## Rollback

`rollback-release.sh` rolls the **image** back. A migration that must also be
undone is restored from the pre-migration **backup** taken by the `backup` stage
of that release (see the sequence above) — which is exactly why backup precedes
migrate. Retention prune orders candidates by **S3 object date** (chronological),
not by key name (a name sort of `<env>-<sha>-<ts>` is dominated by the random
`<sha>`, so it is not time-ordered), and it excludes the current key — so the
freshly-created pre-migration backup can never be pruned in the same run that
made it.

**Count contract:** `BACKUP_RETAIN_COUNT` is the number of **prior** backups
kept; the current (pre-migration) backup is **always** kept in addition, so the
store holds up to **N+1** objects per env at the peak (default `14` → up to `15`).
The current backup is categorically the rollback point of the release being cut,
so it is never counted against the retention budget — a deliberate one-object
safety bias.
# Déploiement du rafraîchissement Gemini low puis Astra low

Le CronJob PV utilise Gemini 3.8 Flash low avec deux essais maximum sur refus de qualité du contrat v9, puis Astra low comme repli. Les incidents transport, quota/429, délai et flux vide basculent immédiatement vers Astra. `REFRESH_FORCE_FALLBACK=1` est réservé aux recettes. Les deux comptes doivent être enrôlés sous le même owner scope du Secret runtime dans le PVC keyring inscriptible. L’owner enrôle les comptes localement (`make enroll-cloud-code` et `make enroll-codex`); pour un PVC déjà initialisé, la lane k8s rend puis applique le Job éphémère `make import-keyring-account`, sans remplacer l’autre compte. Pour un PVC neuf, le Secret bootstrap contient les deux comptes avant le premier bootstrap. La validation préproduction (purge `refresh/018/*`, cycle complet, mesures par document et liens B′) et la promotion par variable GitHub puis tag `v*` sont documentées dans [`production-acceptance.md`](../../docs/reviews/refresh-cascade/production-acceptance.md). Une fusion déploie la préproduction; la production reste protégée par `REFRESH_CRONJOB_PROD_ENABLED=true`.
## Scheduled data backup and restore rehearsal (#698)

The immo-owned [joint plan](../../docs/spec/reports/PLAN_BACKUP_PRA_2026-09-17.md)
covers PG, immo documents/graph/keyring and geo, consistency fencing, recovery
order and paired acceptance. This executable path verifies **PostgreSQL only**.
The separate pre-release runner above keeps its existing identity and contract.

The image in `deploy/k8s/db-backup/Dockerfile` contains PG16/PostGIS 3.4 and the
backup program. Every 12 hours, sequential stages export a snapshot, count exact
rows within it, dump that same snapshot, upload, restore into an ephemeral local
server, publish a verification receipt, then prune. No source read is required
for restoration. A manifest is the last uploaded commit marker; restore checks
its checksum/schema/identity and the dump checksum/size before starting PG.
Verification receipts bind S3 object, manifest hash, snapshot time and Job UID.
SHA-256 is corruption detection, not authentication against a compromised writer.

Keep latest verified points for 7 represented UTC days, 4 represented ISO weeks,
1 represented month (overlaps share one copy). A missing day does not expire old
points. No extra weekly/monthly upload. Failed uploads/verification never publish
a verified receipt. Lifecycle cleans abandoned multipart, deleted noncurrent
versions and old exercise receipts; it does not expire current complete sets.

**Provisioning — owner, before activation:** dedicated private buckets
`radar-immobilier-backups-preprod` / `radar-immobilier-backups`, versioning enabled,
public access denied, SSE AES256 observed on uploaded objects. Check the configured
endpoint/region and actual DB name (`EXPECTED_DATABASE=radar`). Provision separate
identities in EACH namespace using `backup-common/secrets.example.yaml`:

| Secret | Required scope in that environment's bucket |
|---|---|
| `radar-pra-writer` | Scoped ListBucket; PutObject, AbortMultipartUpload, ListMultipartUploadParts under `postgres/<env>/`; uploads sets and verification receipts; no deletion |
| `radar-pra-reader` | Scoped ListBucket; GetObject, GetObjectVersion under the prefix; GetBucketLocation, GetBucketVersioning, GetBucketPublicAccessBlock, GetBucketAcl, GetLifecycleConfiguration on this bucket; no writes |
| `radar-pra-retainer` | Scoped ListBucket; GetObject, DeleteObject under the prefix; DeleteObjectVersion only under `exercises/_provision/` to remove its probe; no writes |

Use `env=preprod` or `production`, not the overlay shorthand `prod`. Never reuse
the pre-release `radar-backup-s3-credentials` identity. Deny other buckets/envs,
ACL/public changes and lifecycle changes to scheduled identities; only retainer
can delete, and none can delete versions of retained sets. The explicit denies
also restrict inherited S3 grants from the OpenStack objectstore role.
There are three S3 users per environment, six total. The old reporter's **read**
duties belong to reader; its receipt **writes** use writer. The former settings
resource is a non-secret ConfigMap, still named `radar-pra-settings`; reader receives
bucket-configuration read permissions, not configuration-write permissions.
The names `radar-pra-backup`, `radar-pra-restore`, `radar-pra-postgres` and
`radar-pra-egress` remain unchanged.

**One owner command per environment.** Run from this checkout, with Docker and
kubectl installed. The command builds the local backup image if absent; Docker
must then be able to pull its base images and install its pinned dependencies.
Export these variables in the owner's shell using their normal secret manager;
never place values in Make arguments, repository files or shell traces:

- `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY`:
  OVH API credentials authorized to list/create project users, import/export their
  storage policies, list/create S3 credentials and retrieve their existing secret.
- `OVH_PROJECT_ID`: the Public Cloud project ID (32 hexadecimal characters).
  `OVH_ENDPOINT=ovh-eu` (default) or `ovh-ca`, matching the account's API region.
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optionally `AWS_SESSION_TOKEN`:
  existing S3 administrator credentials for that project/region, with bucket
  creation, ACL, public-block, versioning and lifecycle configuration permissions.
  The OVH API application key is **not** an S3 administrator key.
- `KUBECONFIG`: explicit owner configuration for the target cluster; namespaces
  must already exist, with get/create/patch Secret permissions. Server defaults
  to `https://hlhedx.c1.bhs5.k8s.ovh.net`; `PRA_EXPECTED_SERVER` is an explicit
  override when the owner targets a different cluster.

Preproduction, then production (separate owner authorization):

```sh
make -f deploy/ci/backup-pra.mk backup-provision BACKUP_IMAGE=radar-backup:test PRA_PROVISION_GO=1 BACKUP_ENV=preprod ENV=preprod
make -f deploy/ci/backup-pra.mk backup-provision BACKUP_IMAGE=radar-backup:test PRA_PROVISION_GO=1 PRA_PRODUCTION_GO=1 BACKUP_ENV=production ENV=prod
```

The target checks cluster identity and Secret permissions, creates/reuses the
private bucket, blocks public access, enables versioning, applies and reads back
policies, and creates/reuses users named `radar-pra-<env>-writer|reader|retainer`.
It matches the exact OVH user **description** (OVH chooses the actual username),
rejects duplicates or unexpected roles, and reuses the single existing S3 key.
An interrupted Secret apply can be retried: OVH's secret-retrieval API recovers
the same key without rotation. Run one provisioning invocation at a time per
project; cross-host concurrent creation is not protected by a distributed lock.
An ambiguous API create failure stops, so rerun only once the OVH user/key list
has converged. Existing enabled, unmanaged lifecycle rules cause a stop for owner
review; they are never silently replaced. Partial cloud configuration remains
available for a later retry; there is no destructive rollback.

Lifecycle installs daily=7 days, weekly=28 days (4 weeks), monthly=31 days (the
explicit approximation of 1 month supported by S3), each under `postgres/<env>/`.
Those tier prefixes are reserved: the current backup runner still writes one
copy under `sets/`, retained by 7 represented days / 4 weeks / 1 month. The new
rules do not claim to create tier copies or implement calendar-month expiration.
They also clean abandoned multipart uploads after 1 day, noncurrent versions
after 35 days, expired delete markers, and exercise receipts after 90 days.

Before installing Secrets, a unique encrypted probe is written by writer, read
by reader and its exact version removed by retainer. The command requires
AccessDenied for writer deletion (including version deletion), reader write and
deletion, and every role listing another prefix. Reader reads back private ACL,
public block, versioning and lifecycle. Any unsupported operation, unexpected
error or successful forbidden operation fails the command. The output is a
secret-free summary; Secret data is piped in memory directly to
`kubectl apply --server-side --field-manager=radar-pra-provision`, with no
`--force-conflicts`, temporary secret file or last-applied annotation. Do not
redirect/tee the internal pipe. Docker receives credentials as environment
variables: the owner's Docker daemon must be trusted. Kubernetes audit/redaction
policy remains the owner's responsibility.

It does **not** activate schedules, apply workloads/network policies, perform a
database backup/restore, copy geo data, migrate/delete legacy users or Secrets,
rotate keys, create namespaces, or prove disaster recovery. The build lane never
runs this command against OVH or Kubernetes.

**OVH support and manual fallback.** The public
[cloud API schema](https://eu.api.ovh.com/1.0/cloud.json), checked 2026-09-18,
declares POST/GET `/cloud/project/{serviceName}/user`, POST/GET
`/user/{userId}/policy` (`policy` is a JSON string), GET/POST
`/user/{userId}/s3Credentials`, and POST
`/user/{userId}/s3Credentials/{access}/secret`. Policy/key endpoints are marked
**BETA**. This verifies the API contract, not this project's entitlement, policy
condition enforcement, propagation delay, BHS public-access-block support, or
S3 versioning/lifecycle compatibility. No live OVH validation was performed.
Failures are explicit; the command never substitutes broad permissions.

If user creation is unavailable to the API token, the owner can use OVH Manager
→ Public Cloud → project → Users & Roles to create the three users with the exact
descriptions above and only ObjectStore operator, then rerun with policy/key API
rights. For policies, use the OVH API console's import/export endpoints above
with the exact document produced by `policy()` in `backup-provision.py`, including
the prefix conditions and explicit denies. If the service itself does not support
these policies, a broad role in Manager is **not** an equivalent: stop and have
OVH enable prefix-scoped policies or select a compatible service. For bucket
settings, use Manager → Object Storage → the dedicated bucket to enable private
access/versioning and the documented lifecycle rules where available. If public
block or a required readback is unavailable, obtain an OVH-supported equivalent
and adapt/retest the provisioning contract before activation; do not bypass a
failed guard or claim a completed provision.

**Branch proof before merge — run by the authorized k8s lane in this worktree.**
Commands require Docker, kubectl and jq, registry login provisioned out-of-band,
and an explicit preproduction KUBECONFIG already set in the lane. The build lane
does not execute publication, lifecycle or cluster actions. First test/build and
publish the exact working-tree image (the command saves its immutable registry
digest in `tmp/backup-pra-image.txt`). Verify the new GHCR package is pullable
by cluster nodes (the existing runtime-image convention is public packages;
otherwise infra must supply a pull identity before the proof):

```sh
make -f deploy/ci/backup-pra.mk backup-test BACKUP_IMAGE=radar-backup:test ENV=test-backup-pra
make -f deploy/ci/backup-pra.mk backup-publish BACKUP_IMAGE=ghcr.io/rhanka/radar-backup:pra-712-v2 PRA_PUBLISH_GO=1 ENV=preprod
make -f deploy/ci/backup-pra.mk backup-render ENV=both
```

After owner provisioning, with preprod secrets/lifecycle/network
and quota capacity checked, execute the branch proof (no main dependency):

```sh
make -f deploy/ci/backup-pra.mk backup-proof PRA_CLUSTER_GO=1 ENV=preprod
```

This renders the branch overlay, server-validates/applies only its settings and
network (no durable schedule before paired activation), creates unique `radar-pra-backup-*` and
`radar-pra-restore-*` Jobs, selects the first Job's exact completed S3 object,
downloads it into the second Job and compares restored counts to the manifest.
It saves receipts and Job metadata under `tmp/backup-pra-render/`, deletes both
Jobs after success and checks restore-pod cleanup. It is repeatable; no fixed
Job name or placeholder survives. A failed wait exits nonzero and preserves the
failed Job until its one-day TTL for diagnosis. Do not accept an old Job success.
Record admission events, CNI DNS/HTTPS reachability, peak RSS/ephemeral bytes and
timings externally: these are not supplied by a successful offline render.
For the joint frozen exercise, the conductor passes the same `CYCLE_ID` and
ISO-8601 `REFERENCE_TIME` as Make arguments to `backup-proof`; these reach only
the dump stage. They label the PG component, without asserting the freeze or
copying immo/geo objects. The final joint marker belongs to the coordinator.

Memory limits: sequential restore 512 MiB, dump 256 MiB, S3 stages 128 MiB;
freshness 128 MiB. Maximum scheduled overlap 640 MiB against ~768 MiB reported
production margin, excluding unrelated Jobs. All containers declare CPU/memory
and ephemeral requests/limits. Source PVC is never mounted. Check actual quota
use and avoid refresh overlap. Pod networking allows cluster DNS, the source PG
for dump, and public HTTPS; standard NetworkPolicy cannot restrict an OVH FQDN.
Restore PG listens only on its local Unix socket. No service-account token mounts.

**Activation on merge:** both overlays have `suspend:false`. Configure
`BACKUP_PRA_ENABLED=true`, production environment approval and `PRA_KUBE_CONFIG`
before merge. The image workflow's `deploy-backup-pra` waits for the new image,
pins its digest, server-validates both overlays and applies both in a single
paired operation. The kubeconfig grants get/create/patch on the two CronJobs,
generated settings ConfigMap and two NetworkPolicies in each namespace; do not
give it secrets or workload-exec rights. Production application is owner-approved.
Authorized manual equivalent, using the same pinned image and a kubeconfig scoped
to both namespaces:

```sh
make -f deploy/ci/backup-pra.mk backup-activate PRA_CLUSTER_GO=1 PRA_PRODUCTION_GO=1 ENV=both
```

Kubernetes has no cross-namespace transaction: inspect both outcomes on any apply
failure and restore the pair under the conductor's owner-approved decision.
Do not activate one environment and call the release complete. Production storage
provisioning, paired geo PR acceptance and the premerge proof are release gates.

**Monitoring:** hourly freshness fails if no verified snapshot is younger than
24h, or receipt/manifest/dump binding fails. Infra installs
`deploy/k8s/backup-common/alerts.yaml` into the actual monitoring namespace with
the Prometheus selector labels and immo on-call route. This is separate from app
overlays because CRD availability is operator-owned. Prove alert delivery before
activation, including a stopped checker; a failed Job alone is not a delivered
page. On failure preserve old points, diagnose quota/S3/scheduling, then rerun the
preprod catch-up proof. The full joint cycle needs its own freshness measurement;
PG health does not establish document/geo freshness.

**Local checks:** `backup-test` uses network-disabled, automatically removed
containers and real PG/PostGIS over private Unix sockets; no Compose stack or
published port. It exercises concurrent source writes, unavailable source during
restore, corruption, wrong/incomplete manifests, S3 failures, retention, freshness
and manifest resource/credential guards, plus the existing pre-release tests.
The isolated PG test verifies counts/extensions/index validity. Business reference
closure, annotation/API-role access and whole-service RTO remain joint proof gates.
