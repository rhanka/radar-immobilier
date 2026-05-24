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
_None at branch start. Populate as issues arise._

## Orchestration Mode
- [x] **Mono-branch + cherry-pick** — single delivery, no parallel work yet.
- [ ] **Multi-branch**
- Rationale: foundational branch, single scope, executed before any parallel work.

## UAT Management
- **Mono-branch**: minimal manual UAT (only `make dev` smoke-check) before merge. No UI surface yet.

## Plan / Todo (lot-based)

### Lot 0 — Bootstrap repo & git
- [ ] `git init` at repo root.
- [ ] Create `.gitignore` (node_modules, dist, build, .env, .DS_Store, tmp/, *.log, .turbo, .cache).
- [ ] Create `.gitattributes` (text=auto, LF line endings for *.sh, *.yml).
- [ ] Initial commit adding `docs/spec/input/*` (VISION, PROMPT, PROCESS) — already present.
- [ ] Initial commit adding `docs/spec/SPEC_INTENT_SCAFFOLDING.md`, `docs/spec/SPEC_EVOL_SCAFFOLDING.md`, `PLAN.md`, `plan/BRANCH_TEMPLATE.md`, this branch file — already drafted at brainstorming stage.
- [ ] Create empty subdir placeholders: `api/.gitkeep`, `ui/.gitkeep`, `packages/.gitkeep`, `e2e/.gitkeep`.
- [ ] Create worktree `tmp/chore-scaffolding-base` and continue work there.

### Lot 1 — Multi-agent rules
- [ ] Create `rules/MASTER.md` (neutral, agent-agnostic):
  - Make-only / Docker-first mandates
  - Compose isolation by `ENV=<slug>` (last argument)
  - Branch scope control
  - Commit discipline (atomic, selective staging, `make commit MSG=`)
  - No squash merge, no branch deletion on merge
  - Language policy (English code / French discussion)
  - References to subordinate rule files
- [ ] Create `rules/workflow.md` — branching, commits, PR, orchestration.
- [ ] Create `rules/subagents.md` — sub-agent contract, neutral terminology.
- [ ] Create `rules/testing.md` — test pyramid, CI, env isolation.
- [ ] Create `rules/security.md` — secrets, SAST, container scanning.
- [ ] Create `rules/sources.md` — scraping etiquette (robots.txt, rate limits, anti-detect best practices).
- [ ] Create `rules/scoring.md` — scoring transparency (evidence required, weights from PROCESS §3).
- [ ] Create pointer files at root:
  - `CLAUDE.md` → `@rules/MASTER.md` + Claude-specific (`.claude/skills/`).
  - `AGENTS.md` → `@rules/MASTER.md` + canonical reading order (general & Codex).
  - `GEMINI.md` → `@rules/MASTER.md` + Gemini-specific.
- [ ] Audit `rules/**` for Claude-only terminology — replace by "the agent".

### Lot 2 — Skills bootstrap
- [ ] Copy/adapt from `../sentropic/.claude/skills/`:
  - `branch-init/`
  - `branch-close/`
  - `scope-check/`
  - `lot-gate/`
  - `post-branch-update/`
- [ ] Create radar-specific skills:
  - `.claude/skills/source-spike/` — template for source feasibility investigation (used in BR-05).
  - `.claude/skills/ingest-test/` — quick test of a source adapter against fixture data.
- [ ] Adapt scripts inside skills to radar paths (Makefile targets, ENV slugs).

### Lot 3 — npm workspace & TypeScript baseline
- [ ] `package.json` at root (private, workspaces: `api`, `ui`, `packages/*`, `e2e`).
- [ ] `package-lock.json` generated by `npm install` (empty workspaces).
- [ ] `tsconfig.base.json` shared config (target ES2022, module ESNext, strict).
- [ ] Add `overrides` for Svelte / Vitest peer-dep alignment if needed.

### Lot 4 — Docker compose stack
- [ ] `docker-compose.yml` base:
  - `api` (image placeholder `node:24-bookworm-slim`, command `sleep infinity` until BR-02)
  - `postgres` (image `postgis/postgis:16-3.4`, dev creds via `.env`)
  - `obscura` (image to confirm — likely `ghcr.io/h4ckf0r0day/obscura:latest`, CDP exposed on internal port)
  - `maildev` (image `maildev/maildev:latest`)
  - `minio` (image `minio/minio:latest`, dev S3 substitute)
- [ ] `docker-compose.dev.yml` — surcharge dev (hot reload api/ui, volumes mounts).
- [ ] `docker-compose.test.yml` — surcharge test (ephemeral DB, no maildev UI).
- [ ] `docker-compose.e2e.yml` — surcharge e2e (build images, no hot reload).

### Lot 5 — Makefile
- [ ] Targets : `help`, `dev`, `down`, `ps`, `logs`, `logs-<svc>`, `sh-api`, `sh-ui`.
- [ ] Targets : `build`, `typecheck`, `lint`, `format`, `test`, `test-e2e`, `clean`.
- [ ] Targets : `db-init`, `db-migrate`, `db-query QUERY=...`, `db-status`.
- [ ] Targets : `s3-init` (creates MinIO bucket locally), `s3-status`.
- [ ] Targets : `install LIB=<name>`, `install-dev LIB=<name>`, `install-api LIB=<name>`, `install-ui LIB=<name>`.
- [ ] Target : `commit MSG="..."` (calls `git commit -m "$(MSG)" --trailer "Co-Authored-By: ..."`).
- [ ] Target : `deploy-gh-pages`, `deploy-k8s ENV=poc` (placeholders, fail clean until BR-03 / BR-04).
- [ ] Each target enforces `ENV=<slug>` as last variable.

### Lot 6 — CI baseline (.github/workflows)
- [ ] `ci.yml` — on PR / push : `make typecheck`, `make lint`, `make test`, `make build` (no-op for now, but the pipeline exists).
- [ ] `branch-policy.yml` — enforce no-squash merge label / check.
- [ ] (placeholder) `deploy-gh-pages.yml` and `deploy-k8s.yml` — created in BR-03 / BR-04.

### Lot 7 — Docs & finalization
- [ ] `README.md` — pitch projet, lien VISION.md, quickstart (`make help`, `make dev`).
- [ ] `LICENSE` — to confirm with user (default: proprietary / All Rights Reserved during demo phase).
- [ ] Update `PLAN.md` — BR-00 status `merged`.
- [ ] Lot gate:
  - [ ] `make typecheck` (no errors, even if empty)
  - [ ] `make lint` (no errors)
  - [ ] `make build` (succeeds vacuously)
  - [ ] `make dev` smoke: containers up, healthcheck OK, no crash loop
  - [ ] CI green on the branch push

### Lot 8 — Merge & close
- [ ] Push branch `chore/scaffolding-base`.
- [ ] Open PR (or merge directly).
- [ ] Verify CI green.
- [ ] Merge commit (NO squash, NO rebase merge).
- [ ] Preserve branch.
- [ ] Move this file to `plan/done/00-BRANCH_chore-scaffolding-base.md`.

## Open questions (to resolve during execution)
- [ ] License : proprietary (All Rights Reserved) ou autre ? À confirmer avec utilisateur avant Lot 7.
- [ ] Image obscura disponible publiquement sur ghcr.io ou doit-on builder localement ? Vérifier en Lot 4.
- [ ] Politique CI sur branche `main` vs PR feature : enforcer protection branche `main` dès BR-00 ou attendre ?
