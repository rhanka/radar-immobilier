# Feature: Dedicated Backup CD Path (`feat/backup-cd-path`)

## Objective
Add a dedicated, fail-closed GitHub Actions CD workflow (`.github/workflows/backup-cd.yml`) to reconcile ConfigMap `radar-backup-daily-script` and CronJobs `radar-backup-daily`, `radar-backup-freshness`, and dormant `radar-db-backup-prod` without re-arming `BASCULE_BUNDLE_CD_ENABLED`.

## Scope / Guardrails
- Scope limited to backup CD workflow decoupling, hermetic workflow tests, and CI test pattern registration.
- Make-only workflow / explicit `node` and `bash deploy/ci/` verification; no direct Docker commands.
- Root checkout `~/src/radar-immobilier` remains untouched; work runs in `./tmp/backup-cd-path`.
- Automated tests run strictly offline/hermetically with zero cluster mutation and zero manual backup job trigger.
- `BASCULE_BUNDLE_CD_ENABLED` remains `false`; `bascule-bundle-cd.yml` stays untouched so `backup-daily.selftest.mjs` invariants remain intact.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/BACKUPCD-BRANCH_feat-backup-cd-path.md`
  - `tools/make/cutover-workflows.test.mjs`
  - `tools/make/git-artifact-workflows.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**` (requires `BACKUPCD-EX1`)
- **Exception process**:
  - `BACKUPCD-EX1` declared below in `## Feedback Loop` before modifying `.github/workflows/**`.

## Feedback Loop
- **BACKUPCD-EX1 (`clarification` / pre-authorized by brief)**:
  - Scope: `.github/workflows/backup-cd.yml` (new dedicated CD workflow) and `.github/workflows/ci.yml` (`TEST_PATTERN` addition for hermetic workflow test).
  - Reason: Decouple daily backup + dormant `radar-db-backup-prod` CD application from `bascule-bundle-cd.yml` (`BASCULE_BUNDLE_CD_ENABLED == 'false'`) with an independent `vars.BACKUP_CD_ENABLED == 'true'` guard and register the hermetic test in CI.
  - Impact: Bounded to `radar-backup-daily-script`, `radar-backup-daily`, `radar-backup-freshness`, and `radar-db-backup-prod` (reusing `KUBE_CONFIG_DATA_PROD` + `lock-action`), dormant unless `BACKUP_CD_ENABLED == 'true'`, zero manual backup execution.
  - Rollback strategy: Disable `BACKUP_CD_ENABLED` (`false` or unset) and revert the workflow commit.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**
- Rationale: Independent lot workstream alongside drift-check, manual-operations-log, and cd-only-guard PRs toward `main`.

## UAT Management (in orchestration context)
- Not applicable (CI/CD workflow and hermetic Node tests only; zero UI/API runtime impact; zero cluster writes from branch tests).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, and `rules/security.md`.
  - [x] Confirm isolated worktree `./tmp/backup-cd-path` off `origin/main`.
  - [x] Audit `radar-ci-bascule-prod` RBAC (`can-i.txt` + `roles.yaml`) and `backup-daily.selftest.mjs`.
  - [x] Declare `BACKUPCD-EX1` exception for `.github/workflows/**`.

- [x] **Lot 1 — Dedicated backup CD workflow (`backup-cd.yml`)**
  - [x] Create `.github/workflows/backup-cd.yml` guarded by `vars.BACKUP_CD_ENABLED == 'true'`, positive PROD pre-flight, lock RBAC + target RBAC `auth can-i` check, `lock-action`, ConfigMap + 3 CronJob apply, and post-apply `schedule|suspend|concurrencyPolicy|automountServiceAccountToken` checks without triggering any manual run.

- [ ] **Lot 2 — Hermetic tests & CI wiring**
  - [ ] Add hermetic assertions in `tools/make/cutover-workflows.test.mjs`.
  - [ ] Register `backup-cd.yml/apply` in `tools/make/git-artifact-workflows.test.mjs` tag-ancestry check.
  - [ ] Extend `.github/workflows/ci.yml` `TEST_PATTERN` to execute the new test.
  - [ ] Run hermetic test suites and static guards locally.

- [ ] **Lot 3 — PR & CI verification**
  - [ ] Push `feat/backup-cd-path` and open PR targeting `main`.
  - [ ] Verify all PR CI checks pass green (no merge).
