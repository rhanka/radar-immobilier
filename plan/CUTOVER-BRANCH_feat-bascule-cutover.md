# Feature: Sequential database cutover

## Objective
- [x] Implement the approved cutover design and overriding addendum, without remote execution.

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
- [x] Allowed Paths: `tools/make/bascule*` for retirement of superseded vehicle-only verifiers and launchers.
- [x] Allowed Paths: `deploy/ci/backup/RESTORE.md` for the existing restoration runbook link.
- [x] Forbidden Paths: root `Makefile`, root `docker-compose*.yml`, `rules/**`, agent entrypoints, other branch plans, `.env*`, domain SQL migrations.
- [x] Conditional Paths: shared domain services only for a demonstrated blocker; declare an exception first.

## Feedback Loop
- [x] Remove the retired `radar-test-api-paniers-pwe` containers and test volumes through the authorized Make cleanup target.
- [x] Validation fix: install Make in the controller test container; first runtime pass exposed 44 `spawn make ENOENT` failures.
- [x] Run typechecking across every workspace and include existing 6H activation/attachment and 6K cutover regressions in the isolated PostgreSQL target.
- [x] Validation fix: synchronously flush Kubernetes fixture JSON before process exit; cover responses larger than the stdout pipe buffer after 18 truncation failures.
- [x] Lint fix: restore the backup self-test's filesystem import and delete the retired reporting name validator.
- [x] Allow focused controller reproductions with `TEST_PATTERN` while retaining the complete default campaign and unconditional backup self-test.
- [x] Explicitly forward `TEST_PATTERN` into the isolated container instead of relying on Compose to inherit host variables.
- [x] Local validation (2026-10-29): syntax, repository ESLint, seven-workspace typecheck, 54 controller tests, 143 backup/reporting checks and 208 unit/PostgreSQL tests in 30 files passed. Seven non-blocking Svelte CSS warnings remain.
- [x] Final cleanup: no Compose containers, volumes or networks remain for the retired PWE or cutover campaigns. Evidence: `tmp/cutover-evidence/validation.md` and its linked logs.
- [x] Existing bundle/backup provisioning also mutates captured schedules; apply the approved shared-lock mechanism there and retain its namespace boundary.
- [x] CUTOVER-EX1: allow `api/Dockerfile` solely to bundle the required migration entrypoint; no runtime base change; rollback by reverting that entry.
- [x] CUTOVER-EX2: allow `deploy/ci/check-image-entrypoints.test.sh` to expect the 25 entrypoints required by CUTOVER-EX1; assertion and label only; rollback by reverting this test update.
- [x] PR #942 CI fix: reproduce the stale count, update count/comment/labels, and pass the complete offline `k8s-validate` gate with `ENV=test-cutover`, dotenv inclusion removed from a temporary Makefile, and cluster validation disabled.
- [ ] Lot 0 (owner/infrastructure): repair only `radar-bascule/KUBE_CONFIG_DATA_BASCULE_PREPROD`, verify dedicated identity and reads, complete old restoration before replacement installation. Remote actions excluded by owner instruction.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential implementation and one isolated Docker campaign at a time.

## UAT Management (in orchestration context)
- [x] No remote UAT; operational acceptance remains an owner action after installation.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Standalone entry and release**
  - [x] Read rules, design and addendum; confirm clean feature branch.
  - [x] Fixed environment mapping, strict manifest, generated build artifact.
  - [x] Standalone `syntax` gate: Bash/POSIX shell parsing, jq filter compilation and Git whitespace checks.
  - [x] Isolated validation tests; no dotenv loading.
- [x] **Lot 2 — Lock and recovery**
  - [x] Atomic lock, sanitized snapshot, checkpoints, liveness and CAS takeover.
  - [x] Lock every competing workflow for its whole mutation interval.
  - [x] Concurrency, stale executor and same-release refusal tests.
- [x] **Lot 3 — Closure and restoration**
  - [x] Fixed inventory, network checks, UID-protected closure and drainage.
  - [x] Pinned additive documents before closure, bounded database restore.
  - [x] Race, interruption, pin and deadline tests.
- [x] **Lot 4 — Schema and data migration**
  - [x] Destination backup in both environments and bounded sanitized Jobs.
  - [x] Validate approved production-subject roster; initialize missing state only; protected resume.
  - [x] PostgreSQL legacy/partial/scoped/revoked/6K regression tests.
- [x] **Lot 5 — Restart and complete reopening**
  - [x] Pin all required services and application CronJobs; require MCP.
  - [x] Private/public smoke; CAS all ingress specs; restore original schedules.
  - [x] Identity, authentication, conflict and reclosure tests.
- [x] **Lot 6 — Caller replacement and removal**
  - [x] Daily deployed release with null data hook; preserve list/restore reporting interfaces.
  - [x] Remove superseded vehicle and orchestration; update runbooks and RBAC.
  - [x] ESLint across the repository, controller tests and migration integration tests green.
  - [x] Review final diff and commit all authorized work; no push.
  - [x] Local delivery validated; infrastructure lot 0 and installed-environment acceptance remain owner-controlled.
