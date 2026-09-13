# Feature: Promote Graphify 0.18 refresh to production

## Objective
- [ ] Promote the accepted Graphify 0.18 PV-to-Signal CronJob to OVH production with one causal schedule, immutable image, enrolled-account runtime, and no MinIO or SCW storage dependency.

## Scope / Guardrails
- [x] Worktree `tmp/refresh-prod-018`, branch `feat/refresh-prod-018`, base `74c63afbeb49b6b97ab71c87b82326089d878841`.
- [x] Make-only, Docker-first; preserve the root checkout and all other worktrees.
- [x] Test environment `test-refresh-prod-018`; API_PORT=8884 UI_PORT=5384 MAILDEV_UI_PORT=1184.
- [x] Use only image `ghcr.io/rhanka/radar-api@sha256:d4a46b5615a7510fd5bf3384f65dea8b881cb75ae3226a3dc3751a7f9271119e`.
- [x] Never print or commit credentials, tokens, keyring material, Secret data, prompts, or model output.
- [x] Do not activate production before the T2 OVH DOCS/RAW bindings are merged and proved live; retain SCW TEM only.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths:
  - `plan/R018P-BRANCH_feat-refresh-prod-018.md`
  - `deploy/k8s/refresh-cronjobs/refresh-018.mk`
  - `deploy/k8s/refresh-cronjobs-prod/kustomization.yaml`
  - `docs/reviews/refresh-018/production-acceptance.md`
- [x] Forbidden Paths: root `Makefile`, `docker-compose*.yml`, `rules/**`, agent entrypoints, `.track/**`, other branch plans, other repositories.
- [x] Conditional Paths: `deploy/k8s/34-refresh-cronjob.yaml` is owned by the T2 rebase and remains read-only here.
- [x] Rollback: suspend `radar-refresh-pv`, keep both legacy refresh CronJobs suspended, and retain canonical OVH objects plus Postgres state.

## Feedback Loop
- [x] T2 must rebase on current `origin/main`, preserve `radar-refresh-pv`, and merge complete provider-neutral OVH bindings before production activation.
- [ ] Record any hard live prerequisite as a blocker; never bypass it.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; T2 remains an independent prerequisite branch with no concurrent writes to this branch.

## UAT Management
- [x] No UI surface and no root UAT checkout change.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Production audit and fail-closed contract**
  - [x] Read project rules and create the isolated worktree.
  - [x] Add a read-only inventory for live production CronJobs, S3 binding names, MinIO absence, keyring PVC, runtime/bootstrap Secret presence, and storage Jobs without reading Secret values.
  - [ ] Render the production overlay and prove one active causal CronJob, two suspended legacy CronJobs, immutable image, and OVH-only storage references.
- [ ] **Lot 1 — Make-only production controls**
  - [ ] Add namespace/API-server guards, read-only inspection, server dry-run, seed, apply, scheduled observation, status, logs, and rollback targets.
  - [ ] Require explicit production confirmation and exact immutable image on every mutating target.
  - [ ] Fail closed unless OVH DOCS coordinates, dedicated scrape credentials, keyring/runtime resources, MinIO absence, and zero active storage migration Jobs are proved.
- [ ] **Lot 2 — Production activation and acceptance**
  - [ ] Rebase onto the merged T2 transition and rerun offline gates.
  - [ ] Seed the already-enrolled account route without per-token API keys.
  - [ ] Server dry-run, apply, observe one controller-created bounded execution, and record redacted evidence.
  - [ ] Confirm `radar-refresh-pv` active at `17 5 * * *`; legacy scrape/projection suspended.
- [ ] **Lot 3 — Review, PR, and merge readiness**
  - [ ] Run focused tests and manifest validation through Make targets.
  - [ ] Obtain independent post-build review and reconcile all P0/P1 findings.
  - [ ] Commit atomically, push, open PR, and require green CI before merge.

## Merge / Close
- [ ] Integrate by merge commit only and preserve the source branch.
