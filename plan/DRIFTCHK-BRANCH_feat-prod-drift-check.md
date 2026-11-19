# Feature: Production Non-Deployment Drift Check (`feat/prod-drift-check`)

## Objective
Add a read-only production drift check script and workflow (`.github/workflows/prod-drift-check.yml`, plus a post-promotion step in `promote-prod`) that renders the 8 non-Deployment production objects from `main`, runs `kubectl diff`, verifies pinned digests vs the served release, never reads Secret values, and fails loudly with a clear `(object, field)` summary.

## Scope / Guardrails
- Scope limited to `deploy/ci/check-prod-drift*`, `.github/workflows/prod-drift-check.yml`, `.github/workflows/build-push-images.yml` (`promote-prod` tail step), `.github/workflows/ci.yml`, `tools/make/cutover-workflows.test.mjs`, and this branch file.
- Zero Python anywhere under `deploy/`.
- Strictly read-only cluster access (`get`, `diff`, `auth can-i`, `config view`); zero cluster mutations, zero Secret data reads.
- Pure Node 22 built-ins in `deploy/ci/check-prod-drift-summary.mjs` (no `npm ci` dependency required in `prod-drift-check` or `promote-prod`; explicit `node:*` imports for ESLint).
- Work isolated in `./tmp/prod-drift-check`; root checkout untouched.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/DRIFTCHK-BRANCH_feat-prod-drift-check.md`
  - `deploy/ci/check-prod-drift.sh`
  - `deploy/ci/check-prod-drift-summary.mjs`
  - `deploy/ci/check-prod-drift.test.sh`
  - `tools/make/cutover-workflows.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**` (requires `DRIFTCHK-EX1`)
- **Exception process**:
  - `DRIFTCHK-EX1` declared below in `## Feedback Loop` before modifying `.github/workflows/**`.

## Feedback Loop
- **DRIFTCHK-EX1 (`clarification` / pre-authorized by brief)**:
  - Scope: `.github/workflows/prod-drift-check.yml` (new scheduled/dispatch workflow), `.github/workflows/build-push-images.yml` (end of `promote-prod` read-only drift step), and `.github/workflows/ci.yml` (run `check-prod-drift.test.sh`).
  - Reason: Automate daily/manual drift detection on `main` and post-cutover drift verification at the end of `promote-prod`, and wire hermetic unit tests into CI.
  - Impact: Strictly read-only checks against `radar-immobilier` using `KUBE_CONFIG_DATA`; zero write steps, zero Secret value reads.
  - Rollback strategy: Remove the workflow/step and revert commits.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**
- Rationale: Independent lot PR targeting `main` with its own CI validation.

## UAT Management (in orchestration context)
- Not applicable (CI/CD drift verification tooling + hermetic fake-`kubectl` tests only; zero UI/API runtime impact).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/security.md`, `prod-snapshot/`, and `eslint.config.js`.
  - [x] Confirm isolated worktree `./tmp/prod-drift-check` off `origin/main`.
  - [x] Declare `DRIFTCHK-EX1` exception for `.github/workflows/**`.

- [ ] **Lot 1 — Drift checker scripts (`deploy/ci/check-prod-drift*`)**
  - [ ] Implement `deploy/ci/check-prod-drift-summary.mjs` (render validation, unified diff `(object, field)` summarizer, pinned image digest verifier).
  - [ ] Implement `deploy/ci/check-prod-drift.sh` (positive pre-flight, render 8 non-Deployment objects from `main`, `kubectl diff`, image verification, conditional `secrets:get` name-only existence check, loud summary).

- [ ] **Lot 2 — Workflow & `promote-prod` integration + hermetic tests**
  - [ ] Create `.github/workflows/prod-drift-check.yml` (`schedule` + `workflow_dispatch`, `main`-only).
  - [ ] Append read-only drift-check step at the end of `promote-prod` in `.github/workflows/build-push-images.yml`.
  - [ ] Create `deploy/ci/check-prod-drift.test.sh`, add assertions in `tools/make/cutover-workflows.test.mjs`, and wire into `.github/workflows/ci.yml`.
  - [ ] Run hermetic tests locally.

- [ ] **Lot 3 — PR & CI verification**
  - [ ] Push `feat/prod-drift-check` and open PR targeting `main`.
  - [ ] Verify all PR CI checks pass green (no merge).
