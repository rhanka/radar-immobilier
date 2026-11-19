# Production promotion by tag

Short runbook. No manual image roll in production: a version tag promotes
the exact images already built from `main`.

## No manual production apply outside CD

Every production Kubernetes manifest under `deploy/` MUST be applied through a
declared GitHub Actions CD workflow (mapped in `deploy/ci/prod-cd-paths.json`
and enforced by `deploy/ci/check-prod-cd-paths.mjs`).

- Manual `kubectl apply` / `kubectl patch` / `kubectl edit` against production
  outside a declared CD path is **forbidden**.
- If a CD path is broken or missing, fix or add the workflow in git and promote
  via PR rather than patching live state.
- Break-glass exception: requires explicit Product Owner GO beforehand,
  read-only `kubectl diff` before applying, zero Secret leaks, and same-day
  recording with the planned CD return in
  `docs/operator/manual-operations-log.md`.

## Owner prerequisites (once)

Install both RBAC files with a cluster-admin identity. Nothing in CI can
install them.

```bash
kubectl -n radar-immobilier apply -f deploy/cutover/rbac-prod.yaml
kubectl -n radar-immobilier apply -f deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml
```

`radar-ci-bascule-prod` is not a subject of the `radar-cutover` Role: its
lock verbs live, name-scoped, in its own Role. The `radar-cutover` Role
stays bound to `radar-ci-deployer` only.

Then check the rights (read-only, every answer must be `yes`):

```bash
# Lock, bascule SA (release must always be possible):
kubectl -n radar-immobilier auth can-i create configmaps --as=system:serviceaccount:radar-immobilier:radar-ci-bascule-prod
kubectl -n radar-immobilier auth can-i get configmaps/radar-change-lock --as=system:serviceaccount:radar-immobilier:radar-ci-bascule-prod
kubectl -n radar-immobilier auth can-i update configmaps/radar-change-lock --as=system:serviceaccount:radar-immobilier:radar-ci-bascule-prod
kubectl -n radar-immobilier auth can-i delete configmaps/radar-change-lock --as=system:serviceaccount:radar-immobilier:radar-ci-bascule-prod
# Cutover + legacy main->prod deploy, deployer SA (KUBE_CONFIG_DATA):
kubectl -n radar-immobilier auth can-i get deployments --as=system:serviceaccount:radar-immobilier:radar-ci-deployer
kubectl -n radar-immobilier auth can-i patch deployments --as=system:serviceaccount:radar-immobilier:radar-ci-deployer
kubectl -n radar-immobilier auth can-i create jobs --as=system:serviceaccount:radar-immobilier:radar-ci-deployer
kubectl -n radar-immobilier auth can-i get pods/log --as=system:serviceaccount:radar-immobilier:radar-ci-deployer
```

Renew these GitHub secrets from namespace-scoped tokens, then verify the
checks above before arming anything:

| Secret | ServiceAccount | Used by |
| --- | --- | --- |
| `KUBE_CONFIG_DATA` | `radar-ci-deployer` | `promote-prod`, cutover `prepare`/`run`, and the legacy `main` -> prod deploy job (same rights: deployments get/patch, Jobs, ConfigMaps, pods/log) |
| `KUBE_CONFIG_DATA_PROD` | `radar-ci-bascule-prod` | `bascule-bundle-cd` (bundle apply + change lock only) |

Keep both flags at `false` until the applies and the checks are done:

- `BASCULE_BUNDLE_CD_ENABLED=false`
- `PROMOTE_PROD_ENABLED=false` (absent counts as `false`)

Arm one at a time: `gh variable set PROMOTE_PROD_ENABLED --body true` only
after the first successful rehearsed promotion is reviewed.

## Promote a release

1. Merge to `main`. Wait for the `build-push-images` run to succeed. It
   uploads `cutover-release-<sha>` (`release.json`, `dataMigration: null`).
   CI also refuses any destructive migration newer than `0044`
   (`deploy/ci/check-migration-destructive.sh`).
2. Tag that exact commit: `git tag vX.Y.Z <sha>` then push the tag.
3. The `promote-prod` job (only when `PROMOTE_PROD_ENABLED == 'true'`) runs:
   - resolve the successful `main` build and check `release.json`;
   - `prepare`: change lock, recovery backup, writer drain, then the
     release DDL on the live database (`run_job ddl`, release digest),
     then the destination schema verification;
   - `run` (sequential cutover, same manifest as the preprod rehearsal).
4. Check the job summary and `https://immo.sent-tech.ca/health`.

## Roll back

- Cutover in progress or failed before the switch: use the recorded run id.
  `make -f deploy/cutover/operator.mk rollback RUN=<uuid> ENV=prod`
  (from a checkout with the production kubeconfig, explicit namespace in
  every `kubectl` call).
- Release already switched and faulty: push the previous version tag
  (`v<previous>`) only if it points at a `main` commit with a successful
  build. Its `release.json` is promoted again by the same job.
- Breaking migration: image rollback alone is not enough. Restore the
  recovery backup written by `prepare`. This step stays owner-run.

## Manual migration (break-glass only)

```bash
make deploy-db-migrate-k8s MIGRATE_IMAGE=ghcr.io/rhanka/radar-api@sha256:<64-hex> K8S_DEPLOY_CONFIRM=1 ENV=prod
```

The target refuses any non-digest image. The manifest
`deploy/k8s/36-db-migrate-job.yaml` carries a zero digest placeholder:
never commit a dated tag there again.
