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
  backup and migrate are **skipped** and the deploy proceeds straight to
  set-image. For a release carrying a pending schema change (e.g. drizzle `0011`)
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

- **Preprod (`deploy-preprod`)** — armed by `PREPROD_CD_ENABLED == 'true'`. Every
  push to `main` replays the migrations against preprod, which is the
  test-before-prod check: a migration that would break prod fails here first.
- **Prod (`promote-prod`)** — a `v*` tag promotes the already-built,
  already-preprod-tested artifact to prod **by immutable digest** (the `<sha7>`
  tag may have aged out of the registry). The migrate Job is pinned to that same
  digest, so the migration and the deployed code are byte-identical. The
  `radar-immo-mcp` drift-heal apply (which pins `radar-api:latest` with a
  `Recreate` strategy, so it rolls MCP pods onto new code) runs **after** migrate
  and before set-image, so MCP never serves new code against an un-migrated
  schema.
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
  --ignore-not-found` before `exit 1`, so the in-cluster work is torn down
  immediately even if self-termination lags.

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

## Rollback

`rollback-release.sh` rolls the **image** back. A migration that must also be
undone is restored from the pre-migration **backup** taken by the `backup` stage
of that release (see the sequence above) — which is exactly why backup precedes
migrate. Retention prune orders candidates by **S3 object date** (chronological),
not by key name (a name sort of `<env>-<sha>-<ts>` is dominated by the random
`<sha>`, so it is not time-ordered), and it excludes the current key — so the
freshly-created pre-migration backup can never be pruned in the same run that
made it.
