# Fix: CI PR Actions trigger verification

## Objective
Resolve the CI-FIX follow-up created after BR-03 by determining why GitHub Actions appeared to produce no PR runs/statuses, then document the correct verification path before the next CI-dependent merge.

## Scope / Guardrails
- Scope limited to GitHub Actions verification rules and roadmap status.
- No workflow YAML changes unless evidence shows the workflows are actually broken.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in repository-local worktree `./tmp/fix-ci-pr-actions-trigger`, never in system `/tmp` and never on the root checkout.
- Automated test campaigns run on dedicated environments (`ENV=test-fix-ci-pr-actions-trigger` / `ENV=e2e-fix-ci-pr-actions-trigger`) if code changes become necessary.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- Code, commits, PR titles, specs, rules, and Markdown stay in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `rules/workflow.md`
  - `PLAN.md`
  - `plan/CIFIX-BRANCH_fix-ci-pr-actions-trigger.md`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `ui/**`
  - `packages/**`
  - `e2e/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `docs/spec/input/**`
  - `plan/done/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**` -> CIFIX-EX1 only if root-cause evidence shows workflow definitions are broken.
- **Exception process**:
  - Declare exception ID `CIFIX-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `acknowledge` CI-FIX root cause.
  - Evidence: GitHub Actions UI shows successful CI and Branch policy runs for PR #5 head branch.
  - Evidence: connector `_fetch_commit_workflow_runs` returns PR runs when given the full 40-character head SHA `3a8cedcd61ff7e811943e0a1ae2a3cee68d22171`.
  - Root cause: earlier verification used short SHAs (`3a8cedc`, `fbe34e8`) and treated an empty connector result as no CI; the connector also filters to pull-request-triggered runs and does not prove push-run absence on `main`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: the fix is a small workflow-rule clarification plus roadmap cleanup.

## UAT Management (in orchestration context)
- No UI UAT required.

## Plan / Todo (lot-based)
- [x] **Lot 0 - Baseline and evidence**
  - [x] Confirm branch: `fix/ci-pr-actions-trigger`.
  - [x] Confirm worktree: `./tmp/fix-ci-pr-actions-trigger`.
  - [x] Confirm `tmp/` is ignored by `.gitignore`.
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Verify `gh` local auth state.
  - [x] Inspect GitHub Actions UI via Playwright.
  - [x] Verify PR #5 full SHA through the GitHub connector.

- [x] **Lot 1 - Document CI verification rule**
  - [x] Update `rules/workflow.md` with the full-SHA verification rule.
  - [x] Update `PLAN.md` so CI-FIX records the actual root cause.
  - [x] Lot gate: documentation-only diff review.

- [x] **Lot 2 - Push, PR, merge, and close**
  - [x] Push branch `fix/ci-pr-actions-trigger`.
  - [x] Open PR with root-cause evidence.
    - PR: https://github.com/rhanka/radar-immobilier/pull/7
  - [x] Verify CI green using the full 40-character head SHA.
    - Branch policy run `26380792183`: success.
    - CI run `26380792196`: success.
  - [x] Merge via merge commit only; do not squash or rebase.
    - Merge commit: `c86d699`.
  - [x] Preserve source branch.
  - [x] Pull/update local main.
  - [x] Move this file to `plan/done/CIFIX-BRANCH_fix-ci-pr-actions-trigger.md`.
  - [x] Update `PLAN.md` status.
