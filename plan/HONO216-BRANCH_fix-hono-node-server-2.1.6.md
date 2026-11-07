# Fix: @hono/node-server 2.1.6 hoisted at the workspace root

## Objective
Upgrade `@hono/node-server` to `^2.1.6` (fixes GHSA-jpvv-r467-5p4w: a backslash in the request path was normalised to `/`, bypassing path-based access control at a reverse proxy) as a single copy hoisted at the root of `node_modules`, so the api runtime image (which copies the root `node_modules` and keeps npm deps external) actually serves the fixed version. Supersedes Dependabot PR #943, whose lock left 1.19.17 at the root and nested 2.1.3 under `api/` and `packages/immo-mcp/`.

## Scope / Guardrails
- Scope limited to the `@hono/node-server` range, its lockfile entries and one listener unit test.
- No DB migration.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in `./tmp/hono-node-server-216`.
- Automated tests run on `ENV=test-hono216`, never on `dev`.
- In every `make` command, `ENV=<env>` is the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package-lock.json`
  - `api/package.json`, `packages/immo-mcp/package.json`
  - `api/src/node-server-request-target.test.ts`
  - `plan/HONO216-BRANCH_fix-hono-node-server-2.1.6.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `.github/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/Dockerfile` (none in this branch)
- **Exception process**:
  - Declare exception ID `HONO216-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `attention`: the lock is regenerated with targeted commands only (`npm install --package-lock-only`, `npm update @hono/node-server --package-lock-only`, then removal of the stale nested `@sentropic/geo/node_modules/@hono/node-server` 2.1.1 entry, re-validated by `npm install --package-lock-only`). A global `npm dedupe` is avoided (it churns ~530 unrelated lines).
- `attention`: 2.x breaking changes are Node >= 20 and the removal of `@hono/node-server/vercel`; the repo uses only `serve` and `getRequestListener`. The `./package.json` subpath is no longer exported in 2.x.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one dependency bump.

## UAT Management (in orchestration context)
- No UI surface change; UAT not required for this branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Create worktree `./tmp/hono-node-server-216` from `origin/main`.
  - [x] Read the #943 review (root 1.19.17 kept, nested 2.1.3 not shipped by the runtime image).

- [x] **Lot 1 — Hoisted 2.1.6**
  - [x] Set `@hono/node-server` to `^2.1.6` in `api` and `packages/immo-mcp`.
  - [x] Lock: single `node_modules/@hono/node-server` 2.1.6 (integrity `sha512-p/KH9Mnf…hLKjQ==`), no nested copy.
  - [x] Unit test: a backslash in the request path is rejected (400) by `getRequestListener` instead of being routed.

- [ ] **Lot N — Final validation**
  - [x] Lot gate: typecheck, lint, api (414 files / 4338 tests) and immo-mcp (72 files / 592 tests) suites (`tools/artifact-host.mk`, `ENV=test-hono216`, stack removed with `down -v`).
  - [ ] Push branch and open the PR to `main`.
