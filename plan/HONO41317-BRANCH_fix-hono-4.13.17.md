# Fix: hono 4.13.17 (RegExpRouter wildcard, mount prefix, csrf text/ping advisories)

## Objective
Upgrade `hono` from 4.13.13 to `^4.13.17` (latest 4.x) as a single copy hoisted at the root of `node_modules`. It fixes the three advisories published 2026-11-01, all fixed in 4.13.16: GHSA-h7mg-cq63-vhpq (RegExpRouter skips wildcard middleware for certain route patterns and for paths with an encoded line terminator), GHSA-4m76-xfj5-7975 (`mount()` forwards a path that bypasses middleware scoped inside the mount prefix) and GHSA-46wx-v44x-9hh2 (`csrf()` ignores hyperlink-auditing `text/ping` requests).

## Scope / Guardrails
- Scope limited to the `hono` range, its lockfile entries and one regression unit test.
- No DB migration.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in `./tmp/hono-framework-41317`.
- Automated tests run on `ENV=test-hono41317`, never on `dev`.
- In every `make` command, `ENV=<env>` is the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package-lock.json`
  - `api/package.json`, `packages/immo-mcp/package.json`
  - `api/src/wildcard-middleware-line-terminator.test.ts`
  - `plan/HONO41317-BRANCH_fix-hono-4.13.17.md`
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
  - Declare exception ID `HONO41317-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `attention`: the lock is regenerated with `npm install --package-lock-only` only; the diff is the two workspace ranges plus the `node_modules/hono` version/resolved/integrity (integrity matches `npm view hono@4.13.17 dist.integrity`). No global `npm dedupe`.
- `attention`: the api app runs on TrieRouter (SmartRouter falls back because its route set is not supported by RegExpRouter), so `app.use("*", protect)` was not skipped. content-deny (1 route) and the reader content app (16 routes) run on RegExpRouter: on 4.13.13 a path with `%0A`/`%0D`/`%E2%80%A8`/`%E2%80%A9` skipped their wildcard gates and got hono's bare 404 (no content served).
- `attention`: no `mount()`, no `hono/csrf`, no explicit `{[^/]+}` parameter pattern, no `/x*` route under a `/x/*` middleware in the repo.
- `attention`: immo-mcp bundles `hono` into `packages/immo-mcp/dist/server-http.js` (esbuild in `api/Dockerfile`); the api keeps it external from the root `node_modules`. Both ship only through a rebuilt image (normal deploy).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one dependency bump.

## UAT Management (in orchestration context)
- No UI surface change; UAT not required for this branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Create worktree `./tmp/hono-framework-41317` from `origin/main`.
  - [x] Exposure assessment of the three advisories against api, immo-mcp, content-deny and content-reader.

- [x] **Lot 1 — Hoisted 4.13.17**
  - [x] Set `hono` to `^4.13.17` in `api` and `packages/immo-mcp`.
  - [x] Lock: single `node_modules/hono` 4.13.17 (integrity `sha512-vZIcbkvj…Fh05kQ==`), no nested copy.
  - [x] Unit test: wildcard middlewares (api `protect`, content-deny denial) still answer a path with an encoded line terminator; the content-deny case fails on 4.13.13.

- [ ] **Lot N — Final validation**
  - [x] Lot gate: typecheck, lint, api (415 files / 4340 tests) and immo-mcp (72 files / 592 tests) suites (`tools/artifact-host.mk`, `ENV=test-hono41317`, stack removed with `down -v`).
  - [ ] Push branch and open the PR to `main`.
