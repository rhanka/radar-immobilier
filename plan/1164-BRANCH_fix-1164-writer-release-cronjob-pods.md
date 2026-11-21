# Fix: Exclude CronJob-managed Job Pods in writer_release (#1164)

## Objective
Apply the same CronJob-managed Job exclusion already used by the Jobs check in `writer_release()` (`tools/make/cutover-cluster.sh`) to the Pods check, so a scheduled refresh pod (`radar-refresh-pv-*`) running during a failed writer recovery does not block lock release. Refs #1164.

## Scope / Guardrails
- Keep unscheduled writer Job Pods and orphan Job Pods (missing parent Job) strictly blocking `writer_release()`.
- Branch development in repository-local isolated worktree `./tmp/fix-1164-writer-pods`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `tools/make/cutover-cluster.sh`
  - `tools/make/cutover-lock.test.mjs`
  - `plan/1164-BRANCH_fix-1164-writer-release-cronjob-pods.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`

## Feedback Loop
- Owner request (2026-11-21): exclude Pods of CronJob-managed Jobs in `writer_release()` (`tools/make/cutover-cluster.sh:128-132`) and add a regression test to the cutover test suite.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single focused fix + test)
- [ ] **Multi-branch**
- Rationale: Tightly scoped 2-file fix + test targeting one PR.

## UAT Management (in orchestration context)
- UAT, if requested, happens on the root checkout (`ENV=dev`).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Create isolated repository-local worktree `./tmp/fix-1164-writer-pods` from `origin/main`.
  - [x] Inspect `tools/make/cutover-cluster.sh` and `tools/make/cutover-lock.test.mjs`.

- [x] **Lot 1 — Fix & regression test**
  - [x] Exclude Pods owned by CronJob-managed Jobs in `writer_release()` (`tools/make/cutover-cluster.sh`).
  - [x] Add regression test in `tools/make/cutover-lock.test.mjs` covering scheduled `radar-refresh-pv-*` Pods, active unscheduled writer Pods, and orphan Job Pods.

- [ ] **Lot 2 — Verification, PR & report**
  - [x] Verify bash syntax and cutover lock test.
  - [ ] Push branch, open PR (`Refs #1164`), and verify green CI.
  - [ ] Write summary report.
