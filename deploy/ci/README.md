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

Both migrate and backup are gated on the **same** enable var per voie, so migrate
can never run without a fresh pre-migration backup preceding it.

## Voies (jobs in `build-push-images.yml`)

| Job | Trigger | Namespace | Image pin | Migrate | Enable var (backup + migrate) |
|---|---|---|---|---|---|
| `deploy-preprod` | push `main` | `radar-immobilier-preprod` | `<sha7>` tag | ✅ | `BACKUP_BEFORE_RELEASE_ENABLED` |
| `promote-prod` | tag `v*` | `radar-immobilier` | immutable **digest** | ✅ | `BACKUP_BEFORE_RELEASE_PROD_ENABLED` |
| `deploy` *(legacy)* | push `main` | `radar-immobilier` | `<sha7>` tag | ❌ **by design** | — |

- **Preprod (`deploy-preprod`)** — armed by `PREPROD_CD_ENABLED == 'true'`. Every
  push to `main` replays the migrations against preprod, which is the
  test-before-prod check: a migration that would break prod fails here first.
- **Prod (`promote-prod`)** — a `v*` tag promotes the already-built,
  already-preprod-tested artifact to prod **by immutable digest** (the `<sha7>`
  tag may have aged out of the registry). The migrate Job is pinned to that same
  digest, so the migration and the deployed code are byte-identical.
- **Legacy `deploy` (main→prod)** — the pre-cutover direct path. Superseded by
  `deploy-preprod` + `promote-prod` once `PREPROD_CD_ENABLED` is set. It carries
  **no migrate step by design**: it is a void path that must not be the one that
  migrates prod. **Follow-up (separate PR, at cutover): remove the legacy `deploy`
  job.** Until then it stays gated OFF by `PREPROD_CD_ENABLED`.

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

On failure the step also tries `kubectl logs job/<name> --tail=80` for inline
debugging, but this is **best-effort and voie-dependent**:

- **prod** (`promote-prod`) — the prod CI ServiceAccount has `pods/log`, so the
  last 80 lines are dumped inline in the CI output.
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
| `run-db-backup.sh` | Renders + applies the backup Job, polls fail-closed. |
| `db-backup-job.tmpl.yaml` | Backup Job template consumed by `run-db-backup.sh`. |
| `rollback-release.sh` | Roll a Deployment back to a prior image. |
| `reconcile-preprod.sh` | Targeted server-side apply of preprod manifests. |
| `kfilter.py` | Manifest filter used by the reconcile step. |
| `*.test.sh` | Shell tests for the runners above. |

## Rollback

`rollback-release.sh` rolls the **image** back. A migration that must also be
undone is restored from the pre-migration **backup** taken by the `backup` stage
of that release (see the sequence above) — which is exactly why backup precedes
migrate.
