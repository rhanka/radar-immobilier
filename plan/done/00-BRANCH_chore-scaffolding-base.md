# Feature: Scaffolding base (BR-00)

## Objective
Bootstrap the `radar-immobilier` repository conventions: git init, Makefile, docker-compose, multi-agent rules and pointers, npm workspace, CI baseline, plan template. After this branch, the repo is operable by any agent (Claude / Codex / Gemini CLI) following `AGENTS.md`.

## Scope / Guardrails
- Scope limited to repo-level infrastructure: build/test pipeline, dev workflow, multi-agent rule set, plan structure.
- No application code (no `api/src`, no `ui/src`, no `packages/**` content beyond empty placeholders).
- No K8s changes (handled by BR-04).
- Make-only workflow, no direct Docker commands.
- Branch development must happen in isolated worktree `tmp/chore-scaffolding-base` once git is initialized.
- Branch environment mapping: `ENV=chore-scaffolding-base`, `API_PORT=8801`, `UI_PORT=5301`, `MAILDEV_UI_PORT=1101`.
- All new text in English; discussions with user may be in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `.gitignore`, `.gitattributes`
  - `Makefile`
  - `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.test.yml`, `docker-compose.e2e.yml`
  - `rules/**`
  - `.claude/skills/**`
  - `.gemini/**`, `.codex/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `package.json`, `package-lock.json`, `tsconfig.base.json`
  - `.github/workflows/**`
  - `README.md`, `LICENSE`
  - `PLAN.md`, `plan/BRANCH_TEMPLATE.md`, `plan/00-BRANCH_chore-scaffolding-base.md`
  - Empty placeholders: `api/.gitkeep`, `ui/.gitkeep`, `packages/.gitkeep`, `e2e/.gitkeep`
- **Forbidden Paths**:
  - `api/src/**`, `api/drizzle/**`, `api/Dockerfile`, `api/package.json`
  - `ui/src/**`, `ui/vite.config.*`, `ui/svelte.config.*`, `ui/package.json`
  - `packages/*/src/**`, `packages/*/package.json`
  - `../poc-k8s/**`
  - `docs/spec/SPEC_INTENT_*.md` and `docs/spec/SPEC_EVOL_*.md` (handled by BR-01)
- **Conditional Paths**:
  - `docs/spec/input/**` — only allowed for read; must not be modified in this branch.
  - `docs/spec/SPEC_INTENT_SCAFFOLDING.md` and `docs/spec/SPEC_EVOL_SCAFFOLDING.md` — already exist from the brainstorming stage; this branch may add them to the initial git commit but must not modify their content (changes go through BR-01).
- **Exception process**:
  - Declare `BR00-EXn` in `## Feedback Loop` if any forbidden path must be touched. None expected.

## Feedback Loop

### BR00-EX1 — Bootstrap exception: work directly on branch (no worktree)
- **Reason**: BR-00 establishes the worktree discipline itself. Creating a `tmp/chore-scaffolding-base` worktree before the Makefile / rules / skills exist would be a chicken-and-egg situation (no `make` target to manage worktrees, no rules to enforce the policy).
- **Impact**: only BR-00. From BR-01 onward, work is strictly in `tmp/<slug>`.
- **Rollback**: none needed. The exception is non-destructive.
- **Status**: acknowledged.

## Orchestration Mode
- [x] **Mono-branch + cherry-pick** — single delivery, no parallel work yet.
- [ ] **Multi-branch**
- Rationale: foundational branch, single scope, executed before any parallel work.

## UAT Management
- **Mono-branch**: minimal manual UAT (only `make dev` smoke-check) before merge. No UI surface yet.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Bootstrap repo & git**
  - [x] `git init` at repo root.
  - [x] Create `.gitignore` (node_modules, dist, build, .env, .DS_Store, tmp/, *.log, .turbo, .cache).
  - [x] Create `.gitattributes` (text=auto, LF line endings for *.sh, *.yml).
  - [x] Initial commit adding `docs/spec/input/*` (VISION, PROMPT, PROCESS).
  - [x] Initial commit adding `docs/spec/SPEC_INTENT_SCAFFOLDING.md`, `docs/spec/SPEC_EVOL_SCAFFOLDING.md`, `PLAN.md`, `plan/BRANCH_TEMPLATE.md`, this branch file.
  - [x] Create empty subdir placeholders: `api/.gitkeep`, `ui/.gitkeep`, `packages/.gitkeep`, `e2e/.gitkeep`.
  - [x] Create worktree `tmp/chore-scaffolding-base` and continue work there — superseded by BR00-EX1 (work performed directly on `chore/scaffolding-base`).

- [x] **Lot 1 — Multi-agent rules**
  - [x] Create `rules/MASTER.md` (neutral, agent-agnostic).
  - [x] Create `rules/workflow.md` — branching, commits, PR, orchestration.
  - [x] Create `rules/subagents.md` — sub-agent contract, neutral terminology.
  - [x] Create `rules/testing.md` — test pyramid, CI, env isolation.
  - [x] Create `rules/security.md` — secrets, SAST, container scanning.
  - [x] Create `rules/sources.md` — scraping etiquette (robots.txt, rate limits, anti-detect best practices).
  - [x] Create `rules/scoring.md` — scoring transparency (evidence required, weights from PROCESS §3).
  - [x] Create pointer files at root: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` referencing `rules/MASTER.md`.
  - [x] Audit `rules/**` for Claude-only terminology — replaced by "the agent".

- [x] **Lot 2 — Skills bootstrap**
  - [x] Adapt from `../sentropic/.claude/skills/`: `branch-init`, `branch-close`, `scope-check`, `lot-gate`, `post-branch-update`.
  - [x] Create radar-specific skills: `.claude/skills/source-spike`, `.claude/skills/ingest-test`.
  - [x] Adapt scripts inside skills to radar paths (Makefile targets, ENV slugs).

- [x] **Lot 3 — npm workspace & TypeScript baseline**
  - [x] `package.json` at root (private, workspaces: `api`, `ui`, `packages/*`, `e2e`).
  - [x] `package-lock.json` deferred to BR-02 when first deps land.
  - [x] `tsconfig.base.json` shared config (target ES2022, module ESNext, strict).
  - [x] `overrides` for Svelte 5 declared in root package.json.
  - [x] `.env.example` documenting required keys.

- [x] **Lot 4 — Docker compose stack**
  - [x] `docker-compose.yml` base with postgres-postgis, MinIO, obscura, maildev, api placeholder.
  - [x] `docker-compose.dev.yml` — surcharge dev (host ports, source mounts, ui dev container).
  - [x] `docker-compose.test.yml` — surcharge test (test isolation via per-ENV project name).
  - [x] `docker-compose.e2e.yml` — surcharge e2e (built images, Playwright runner).
  - [x] `obscura/Dockerfile` wraps the upstream Rust binary v0.1.5.

- [x] **Lot 5 — Makefile**
  - [x] Targets: lifecycle (`help`, `dev`, `down`, `clean`, `ps`, `logs`, `logs-<svc>`, `sh-<svc>`, `exec-<svc>`).
  - [x] Targets: quality gates (`build`, `typecheck`, `lint`, `format`).
  - [x] Targets: tests (`test`, `test-api`, `test-ui`, `test-e2e`, `test-smoke`).
  - [x] Targets: DB (`db-init`, `db-migrate`, `db-backup`, `db-restore`, `db-seed`, `db-query`, `db-status`).
  - [x] Targets: object storage (`s3-init`, `s3-status`, `s3-ls`).
  - [x] Targets: deps (`install`, `install-api`, `install-ui`, `install-dev`).
  - [x] Target: `commit MSG="..."` WITHOUT co-author trailer (project policy).
  - [x] Targets: `deploy-gh-pages`, `deploy-k8s`, `security-scan` (placeholders, fail clean until BR-03 / BR-04).
  - [x] All targets enforce `ENV=<slug>` as last variable.

- [x] **Lot 6 — CI baseline (.github/workflows)**
  - [x] `ci.yml` — compose validation + placeholder gates (typecheck, lint, test, build).
  - [x] `branch-policy.yml` — enforce merge-commit-only policy, warn on missing plan file.

- [x] **Lot 7 — Docs & finalization**
  - [x] `README.md` — pitch projet, lien VISION.md, quickstart (`make help`, `make dev`).
  - [x] `LICENSE` — UNLICENSED / All Rights Reserved during demo phase.
  - [x] Update `PLAN.md` — BR-00 status section.
  - [x] Lot gate: `make typecheck`, `make lint`, `make test`, `make build` (placeholders, pass clean). `docker compose config -q` on all three compose surcharges, exit 0.

- [x] **Lot 8 — Merge & close**
  - [x] Push branch `chore/scaffolding-base` to `origin`.
  - [x] PR #1 opened against `main`.
  - [x] CI green (after 2 fixes: drop stack boot for placeholders, drop tmpfs override in test compose).
  - [x] Merged via merge commit `f139ee8` (NO squash, NO rebase merge).
  - [x] Source branch preserved (no auto-delete).
  - [x] This file moved to `plan/done/00-BRANCH_chore-scaffolding-base.md` (in BR-01).

## Open questions (resolved during execution)
- [x] License : proprietary (All Rights Reserved) retained for the demo phase ; revisited at client transition. See `LICENSE`.
- [x] Obscura : no public docker image, only release tarballs. Custom `obscura/Dockerfile` wraps the upstream Linux x86_64 binary (v0.1.5).
- [x] Branch protection on `main` : deferred until a remote is set up. `branch-policy.yml` workflow already documents the policy (merge-commit only).

## Resolved during execution
- **Commit identity**: `rhanka <fabien.antoine@m4x.org>` (saved in memory). All BR-00 commits use this identity after a one-time `git filter-branch`.
- **No co-author trailer** in commits (user preference, saved in memory). Removed from messages and the `make commit` target.
