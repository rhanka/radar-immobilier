# Feature: Sequential database cutover

## Objective
- [ ] Implement the approved cutover design and overriding addendum, without remote execution.

## Scope / Guardrails
- [x] Use the existing `tmp/bascule-cutover` worktree on `feat/bascule-cutover`.
- [x] Make only; no Python, dotenv reads, secret output, push, production or preprod actions.
- [x] Preserve `PREPROD_CD_ENABLED` and `BASCULE_SCHEDULE_ENABLED`.
- [x] Test with `ENV=test-cutover`; no published ports (reserved 18961/15961/11961).
- [x] One Docker campaign at a time; remove campaign volumes on exit.
- [x] English artifacts, French owner communication; commits without attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `deploy/cutover/**`, `tools/make/cutover*`, `api/src/scripts/database-cutover*`, `api/tests/**cutover**`, `plan/CUTOVER-BRANCH_feat-bascule-cutover.md`.
- [x] Allowed Paths: `.github/workflows/**`, `deploy/ci/bascule-preprod/**`, `deploy/k8s/11-ci-deployer-preprod-rbac.yaml`, `deploy/ci/db-backup-job.tmpl.yaml`, `deploy/base-preprod/**`, `tools/make/base-preprod*`, `BASE_API_ACTIVATION.md`, `docs/**`.
- [x] Forbidden Paths: root `Makefile`, root `docker-compose*.yml`, `rules/**`, agent entrypoints, other branch plans, `.env*`, domain SQL migrations.
- [x] Conditional Paths: shared domain services only for a demonstrated blocker; declare an exception first.

## Feedback Loop
- [ ] Lot 0 (owner/infrastructure): repair only `radar-bascule/KUBE_CONFIG_DATA_BASCULE_PREPROD`, verify dedicated identity and reads, complete old restoration before replacement installation. Remote actions excluded by owner instruction.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential implementation and one isolated Docker campaign at a time.

## UAT Management (in orchestration context)
- [x] No remote UAT; operational acceptance remains an owner action after installation.

## Plan / Todo (lot-based)
- [ ] **Lot 1 — Standalone entry and release**
  - [x] Read rules, design and addendum; confirm clean feature branch.
  - [ ] Fixed environment mapping, strict manifest, generated build artifact.
  - [ ] Isolated validation tests; no dotenv loading.
- [ ] **Lot 2 — Lock and recovery**
  - [ ] Atomic lock, sanitized snapshot, checkpoints, liveness and CAS takeover.
  - [ ] Lock every competing workflow for its whole mutation interval.
  - [ ] Concurrency, stale executor and same-release refusal tests.
- [ ] **Lot 3 — Closure and restoration**
  - [ ] Fixed inventory, network checks, UID-protected closure and drainage.
  - [ ] Pinned additive documents before closure, bounded database restore.
  - [ ] Race, interruption, pin and deadline tests.
- [ ] **Lot 4 — Schema and data migration**
  - [ ] Destination backup in both environments and bounded sanitized Jobs.
  - [ ] Validate approved production-subject roster; initialize missing state only; protected resume.
  - [ ] PostgreSQL legacy/partial/scoped/revoked/6K regression tests.
- [ ] **Lot 5 — Restart and complete reopening**
  - [ ] Pin all required services and application CronJobs; require MCP.
  - [ ] Private/public smoke; CAS all ingress specs; restore original schedules.
  - [ ] Identity, authentication, conflict and reclosure tests.
- [ ] **Lot 6 — Caller replacement and removal**
  - [ ] Daily deployed release with null data hook; preserve list/restore reporting interfaces.
  - [ ] Remove superseded vehicle and orchestration; update runbooks and RBAC.
  - [ ] ESLint across the repository, controller tests and migration integration tests green.
  - [ ] Review final diff and commit all authorized work; no push.
