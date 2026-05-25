# Feature: GitHub Pages unsupported-plan guard

## Objective
Keep the GitHub Pages deployment workflow non-blocking when repository Pages is
unavailable for the current GitHub plan, while preserving automatic deployment
once Pages is enabled.

## Scope / Guardrails
- Scope limited to the GitHub Pages workflow and roadmap bookkeeping.
- No application code, API routes, UI components, source adapters, or database
  schema changes.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT
  (`ENV=dev`) and must remain stable.
- Branch development happens in repository-local isolated worktree
  `./tmp/fix-gh-pages-unsupported`; never use system `/tmp`.
- Automated test campaigns use `ENV=test-gh-pages-unsupported`, never `dev`.
- In every `make` command, `ENV=<env>` is the last argument.
- All new text is English. Conversations with the user may be French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/CIFIX2-BRANCH_fix-gh-pages-unsupported.md`
  - `PLAN.md`
  - `.github/workflows/deploy-gh-pages.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` except this file
  - `api/**`
  - `ui/**`
  - `packages/**`
  - `docs/spec/input/**`
- **Conditional Paths**:
  - none
- **Exception process**: declare reason, impact, and rollback here before
  touching any conditional path.

## Feedback Loop
- [x] `attention` GitHub Pages API returned `422` when creating a Pages site:
  "Your current plan does not support GitHub Pages for this repository."

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: this is one workflow guard with no application surface.

## UAT Management
- No UI UAT. This branch changes CI/deployment workflow behavior only.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, and `rules/testing.md`.
  - [x] Create isolated repository-local worktree
    `./tmp/fix-gh-pages-unsupported`.
  - [x] Confirm `tmp/` is ignored.
  - [x] Confirm root `main` is clean before branching.
  - [x] Define environment mapping: `ENV=test-gh-pages-unsupported`.

- [x] **Lot 1 — Pages availability guard**
  - [x] Add a preflight job that checks whether GitHub Pages is enabled.
  - [x] Skip deployment when Pages is not available for the repository plan.
  - [x] Preserve deployment behavior when Pages becomes available.
  - [x] Lot gate: `git diff --check`.

- [x] **Lot 2 — PR and merge**
  - [x] Push branch.
  - [x] Open PR: <https://github.com/rhanka/radar-immobilier/pull/10>.
  - [x] Verify CI green.
  - [x] Merge via merge commit only.
    - Merge commit: `88f31bd`.
  - [x] Preserve source branch.
  - [x] Move this file to `plan/done/CIFIX2-BRANCH_fix-gh-pages-unsupported.md`.
