# Production promotion by tag

Short runbook. No manual image roll in production: a version tag promotes
the exact images already built from `main`.

## Owner prerequisites (once)

Install both RBAC files with a cluster-admin identity. Nothing in CI can
install them.

```bash
kubectl -n radar-immobilier apply -f deploy/cutover/rbac-prod.yaml
kubectl -n radar-immobilier apply -f deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml
```

Then check the lock rights (read-only):

```bash
kubectl -n radar-immobilier auth can-i get configmaps/radar-change-lock --as=system:serviceaccount:radar-immobilier:radar-ci-bascule-prod
kubectl -n radar-immobilier auth can-i update configmaps/radar-change-lock --as=system:serviceaccount:radar-immobilier:radar-ci-bascule-prod
kubectl -n radar-immobilier auth can-i delete configmaps/radar-change-lock --as=system:serviceaccount:radar-immobilier:radar-ci-bascule-prod
```

Create or rotate these GitHub secrets from namespace-scoped tokens:

| Secret | ServiceAccount | Used by |
| --- | --- | --- |
| `KUBE_CONFIG_DATA` | `radar-ci-deployer` | `promote-prod` |
| `KUBE_CONFIG_DATA_PROD` | `radar-ci-bascule-prod` | `bascule-bundle-cd` |

Keep the GitHub Environment `production` on version tags. Keep
`BASCULE_BUNDLE_CD_ENABLED=false` until the second RBAC file is applied and
the checks above return `yes`.

## Promote a release

1. Merge to `main`. Wait for the `build-push-images` run to succeed. It
   uploads `cutover-release-<sha>` (`release.json`, `dataMigration: null`).
2. Tag that exact commit: `git tag vX.Y.Z <sha>` then push the tag.
3. The `promote-prod` job runs in order:
   - resolve the successful `main` build and check `release.json`;
   - migrate Job `radar-db-migrate-<sha7>`, pinned to `.apiImage` digest,
     logs shown, failure or timeout stops the run;
   - `prepare` (recovery backup, then live-schema verification);
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
