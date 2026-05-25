---
description: "Consolidated AI development rules for radar-immobilier — loaded in every conversation"
alwaysApply: true
paths: ["**/*"]
globs: ["**/*"]
tags: [master]
---

# MASTER RULES — `radar-immobilier`

These rules apply to any AI coding agent operating in this repo (Claude Code,
Codex CLI, Gemini CLI, Aider, OpenCode, Copilot CLI, Kimi Code, etc.). They are
intentionally neutral — wherever a behavior is required, the rule says "the
agent" rather than naming a specific tool.

Agent-specific entry points (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) point to
this file and only add tooling glue on top of it.

## Make-Only (MANDATORY)
- ALL commands go through `make` targets — no direct `npm` / `node` / `python` / `docker` from the agent or user shell.
- Install libs: `make install LIB=<name>`, `make install-dev LIB=<name>`, `make install-api LIB=<name>`, `make install-ui LIB=<name>`.
- Build/quality: `make build`, `make typecheck`, `make lint`, `make format`.
- Testing: `make test`, `make test-e2e`, `make test-smoke`.
- DB: `make db-init`, `make db-migrate`, `make db-backup`, `make db-restore`, `make db-seed`, `make db-query QUERY="..."`.
- Object storage: `make s3-init`, `make s3-status`.

## Docker-First (MANDATORY)
- NO native `node`/`python`/`pip` on the host. All execution runs in containers managed by docker-compose.
- Same `make` commands run locally and in CI — no drift.
- No `node_modules`, no `.venv`, no global packages on the host.

## Compose Isolation (MANDATORY)
- Use `ENV=<branch-slug>` as a short alias for the compose project name.
- Always pass `ENV=...` as the **LAST** argument to any `make` command. `ENV=... make ...` is FORBIDDEN.
- Before starting services, verify ports are free or owned by the same project.
- Override ports per branch **for test / branch stacks only** (`ENV=test-*`,
  `ENV=feat-*`, …): `API_PORT`, `UI_PORT`, `MAILDEV_UI_PORT` — keep
  `VITE_API_BASE_URL` aligned. These per-branch ports MUST NOT collide with the
  fixed root UAT ports below, and sub-agents MUST NOT use the root UAT ports.
- Example: `make dev API_PORT=8802 UI_PORT=5302 MAILDEV_UI_PORT=1102 ENV=feat-vertical-slice`.

## UAT Environment (MANDATORY — fixed ports, stable data)
- UAT always happens on the **root checkout** with `ENV=dev` at **fixed ports**:
  API `8801`, UI `5301`, Maildev UI `1101`, Postgres `5532`, S3 `9100/9101`,
  Obscura `9222` (the Makefile defaults). The UAT **URL is stable**:
  `http://localhost:5301`. Do not invent a new UAT port per branch.
- Data is **stable** across UAT sessions: never run `make clean` / `-v` on the
  `dev` volumes without explicit user confirmation.
- To UAT a branch: push the branch, then point the root checkout at it
  (`git -C <root> checkout <branch>` or merge), run `make dev … ENV=dev` on the
  fixed ports, UAT, then return the root to its prior state. The *code* under
  UAT changes; the *ports and data* never do.
- Worktrees are for development and automated test/branch stacks only; they
  never host the UAT the user reviews.

## Branch Scope Control (MANDATORY)
- Every branch declares `Allowed Paths`, `Forbidden Paths`, `Conditional Paths` in its `plan/NN-BRANCH_<slug>.md`.
- Default forbidden in every branch: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `plan/NN-BRANCH_*.md` (other branches).
- Scope exceptions require `BRxx-EXn` with rationale + impact + rollback in the branch file.
- Use `plan/BRANCH_TEMPLATE.md` to author `plan/NN-BRANCH_<slug>.md`.
- For complex branches, add a `docs/spec/SPEC_EVOL_<topic>.md` (consolidate before tests, then finalize as `SPEC_<topic>.md`).

## Worktree Discipline (MANDATORY from BR-01 onward)
- Branch development happens in repository-local `./tmp/<slug>/` worktrees,
  never in system `/tmp` and never on the root checkout.
- The root checkout is reserved for the user's dev / UAT (`ENV=dev`) and must remain stable.
- BR-00 (this branch) is exempt: bootstrap exception `BR00-EX1`.

## Test Isolation (MANDATORY)
- Tests run on `ENV=test-*` or `ENV=e2e-*` environments — NEVER `ENV=dev`. Past incidents on sister projects show `afterEach` hooks purging real data when tests run on `dev`.
- Each branch defines its own `ENV` slug and port mapping.

## Commit Discipline (MANDATORY)
- Atomic commits: one logical change per commit, max 150 lines / 10–15 files between commits.
- Selective staging: `git add <specific-files>` — NEVER `git add .` or `git add -A` (avoids accidental inclusion of `.env`, credentials, large binaries).
- Commit command: `make commit MSG="type: concise description"` (single line). Never use `git commit` directly (the make target adds the co-author trailer).
- Update `BRANCH.md` checkboxes WITHIN each commit (`git add plan/NN-BRANCH_<slug>.md` alongside work files).

## Merge Policy (MANDATORY)
- Squash merge: **DISABLED**.
- Rebase merge: **DISABLED**.
- Merge commit: **ONLY allowed strategy**.
- `delete_branch_on_merge`: **DISABLED** — source branches MUST be preserved post-merge for history and incident forensics.
- Inherited from sentropic's PR #141 squash incident (2026-05-13).

## No Legacy Fallback (MANDATORY)
- When replacing a system, DELETE the old code in the same change. No dual paths, no temporary shims kept around "just in case".
- Backwards-compatibility hacks (renamed `_var` placeholders, `// removed` comments, re-exports for unused types) are forbidden. Delete and move on.

## Storage Policy
- Raw documents (HTML, PDF, transcripts, captures) → **Object Storage** (Scaleway S3-compatible bucket `radar-immobilier-raw`, MinIO locally).
- Structured metadata & scored entities → **Postgres**.
- Fields not yet stabilized → `jsonb` columns validated by versioned Zod schemas in `packages/radar-domain/src/schemas/`.
- No SQL migration to widen / refactor a `jsonb` field unless a stable pattern emerges through `BR-06` data investigation.

## Scoring Policy
- Every score MUST point to evidence: a source document reference, a page or anchor, a timestamp, an extraction confidence level.
- Pondérations from `docs/spec/input/PROCESS.md` §3: potentiel réglementaire 30 %, risque 20 %, timing 20 %, faisabilité 15 %, valeur marché 15 %.
- A score without evidence is downgraded to "surveillance" automatically.

## Scraping Policy
- Respect `robots.txt` (with documented exceptions if explicitly required for the radar use case).
- Rate-limit aggressively : at most 1 req / 2 s by default per source, more conservative for small municipal sites.
- Identify the user-agent honestly (`radar-immobilier/0.x (+contact)`); anti-detect via Obscura is for reliability, not deception.
- Cache raw payloads in S3 to avoid re-fetching during dev / tests.

## Language Policy
- All code, comments, commits, PR titles, API schemas, error messages: **English**.
- All Markdown / spec / rules files: **English**.
- Discuss with the user in **French** (or English if requested).

## Multi-agent Policy
- This file is the single source of truth. Agent-specific pointers (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) reference it and only add per-tool glue.
- Never introduce agent-specific terminology in `rules/`; refer to "the agent".
- Skill packs (`superpowers`, `impeccable`, `graphifyy`) are multi-agent by design; rely on their cross-agent metadata.

## Other Rules Files
- `rules/workflow.md` — branching, commits, PR, orchestration.
- `rules/conductor.md` — conductor orchestration, fixed UAT ports, multi-agent lane registry, `conductor-report`.
- `rules/subagents.md` — sub-agent contract, execution, reporting.
- `rules/testing.md` — test pyramid, CI, environment isolation.
- `rules/security.md` — secrets, SAST, container scanning, vulnerability register.
- `rules/sources.md` — radar-specific scraping etiquette and source adapter contract.
- `rules/scoring.md` — radar-specific scoring transparency.

## WARNING — Most-Violated Rules (review before any change)
- VERIFY BRANCH before any work: `git branch --show-current` should NOT be `main`.
- Commits MUST stay under 150 lines / 10–15 files.
- `BRANCH.md` MUST follow `plan/BRANCH_TEMPLATE.md` strictly — no `###`, checkbox only, no prose dumps.
- SPLIT `git add` and the commit call into separate commands.
- ALWAYS pass ALL ports (`API_PORT`, `UI_PORT`, `MAILDEV_UI_PORT`) to sub-agents — missing ONE kills the dev environment.
- NEVER run `make clean-all` without confirmation — destroys all Docker volumes including the dev DB.
- NEVER test on `ENV=dev` — `afterEach` purges can destroy real data.
- NEVER increase E2E timeouts to mask bugs; UI waits should be < 2 s except for AI generation.
- CI green on `main` is the baseline — any branch failure IS a branch problem; never claim "pre-existing".
- No legacy fallback — delete old code when replacing.

## Debug & Inspection Make Targets
- State: `make ps`, `make ps-all`.
- Logs: `make logs`, `make logs-<service>` (e.g., `make logs-api`, `make logs-postgres`, `make logs-obscura`).
- Database: `make db-query QUERY="SELECT ..."`, `make db-status`.
- Object storage: `make s3-status`, `make s3-ls PREFIX=raw/`.
- Shell/Exec: `make sh-api`, `make sh-ui`, `make exec-api CMD="..."`.
- Dev: `make dev`, `make down`, `make openapi-json`.
