# Feature: API skeleton — Hono + Postgres (Drizzle) + S3 abstraction + Zod v1

## Objective
Stand up the first real code of the radar: a Hono API on Node 24 with a Drizzle/Postgres minimal schema (SPEC_EVOL §7.3), an S3-compatible `ObjectStore` abstraction (MinIO local), and the `@radar/domain` package holding entity types and versioned Zod schemas. Delivers a `/health` endpoint that verifies DB + object-store connectivity, plus unit and integration tests, and wires the real `make` quality gates.

## Scope / Guardrails
- Scope limited to `api/**` and `packages/radar-domain/**`, plus the minimal compose/Makefile/CI adjustments required to build and test that code.
- Make-only workflow, no direct npm/docker on host.
- Branch development in worktree `tmp/feat-api-skeleton-hono-postgres-s3/`.
- Branch environment mapping: `ENV=feat-api-skeleton`, `API_PORT=8803`, `UI_PORT=5303`, `MAILDEV_UI_PORT=1103`.
- Tests on `ENV=test-feat-api-skeleton`, never `ENV=dev`.
- One migration file in `api/drizzle/*.sql` (the initial schema). More than one requires a `BR02-EXn`.
- All new text/code in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `api/**`
  - `packages/radar-domain/**`
  - `package-lock.json` (workspace lockfile, updated by installs)
  - `plan/02-BRANCH_feat-api-skeleton-hono-postgres-s3.md`
- **Forbidden Paths**:
  - `ui/**`, `packages/radar-sources/**`, `packages/radar-scoring/**`, `packages/radar-graph/**`, `packages/radar-ui/**`, `e2e/**`
  - `rules/**`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `../poc-k8s/**`
  - `plan/*BRANCH_*.md` (other branches), `plan/done/**`
  - `docs/spec/**`
- **Conditional Paths (require a `BR02-EXn` exception)**:
  - `Makefile` — wire real `typecheck`/`lint`/`test`/`build` targets (currently placeholders). → BR02-EX1.
  - `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.test.yml` — real `api` image + relax service deps so the api can build/test without the Obscura sidecar (only needed from BR-07). → BR02-EX2.
  - `.github/workflows/ci.yml` — boot postgres+minio for integration tests. → BR02-EX3.

## Feedback Loop

### BR02-EX1 — Makefile real gates
- **Reason**: BR-00 left `typecheck`/`lint`/`test`/`build` as placeholders. BR-02 introduces the first workspaces that must actually be checked, so these targets must call the real per-workspace commands.
- **Impact**: `Makefile` (Forbidden by default). Changes limited to the gate targets + a `build-api-image` target.
- **Rollback**: revert the target bodies to the placeholder echoes.
- **Status**: acknowledged.

### BR02-EX2 — Compose api image + relax Obscura dependency
- **Reason**: The base compose makes `api` hard-depend on `obscura: service_healthy`. Obscura is only needed for scraping (BR-07) and its image CLI is not yet correct. BR-02 needs to build/run the api with postgres+minio only.
- **Impact**: `docker-compose.yml` (real `api` build context + drop `obscura`/`maildev` from `api.depends_on`, keep postgres+minio), `docker-compose.dev.yml`, `docker-compose.test.yml`.
- **Rollback**: restore `api.depends_on` to include obscura+maildev.
- **Status**: acknowledged.

### BR02-EX3 — CI integration services
- **Reason**: integration tests need a real Postgres and MinIO.
- **Impact**: `.github/workflows/ci.yml` boots postgres+minio (not obscura) and runs `make test`.
- **Rollback**: revert to compose-validation-only CI.
- **Status**: acknowledged.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — single coherent skeleton; lots are sequential (domain → api → db → s3 → tests).
- [ ] **Multi-branch**
- Rationale: tightly coupled foundational code; no benefit to parallel sub-branches.

## UAT Management
- No UI surface. UAT = manual `make dev` smoke + `curl /health` returning 200 with db+s3 status.

## Plan / Todo (lot-based)

**Status (2026-05-24)** : Lots 0–6 done. Full gate green in worktree — typecheck + lint + build pass; `make test` = 19 tests green (14 @radar/domain unit, 5 api integration against real postgres + MinIO); `/health` smoke returns 200 `{db:ok, objectStore:ok}`. Lot 7 (push/PR/merge) in progress.

- [x] **Lot 0 — Baseline & compose/dep groundwork**
  - [ ] Confirm worktree, ENV slug, ports (8803/5303/1103); no collision in `PLAN.md`.
  - [ ] BR02-EX2: relax `api.depends_on` to postgres+minio; give `api` a real build context (`api/Dockerfile`); keep dev/test surcharges consistent.
  - [ ] Use `--no-deps` for build-time make targets (install/typecheck/lint/build) so they don't boot services.

- [x] **Lot 1 — `@radar/domain` package (types + Zod v1)**
  - [ ] `packages/radar-domain/package.json`, `tsconfig.json`.
  - [ ] `src/entities/`: `Signal`, `Lot`, `Opportunity`, `Score`, `SourceDocument`, `Constraint` types.
  - [ ] `src/schemas/`: `extracted-doc.v1.ts`, `signal-payload.v1.ts`, `opportunity-fiche.v1.ts` (Zod), each with a `parse`/`safeParse` export and a `SCHEMA_VERSION`.
  - [ ] `src/index.ts` barrel.
  - [ ] Unit tests `tests/schemas.spec.ts` (valid + invalid payloads).
  - [ ] Lot gate: `make typecheck`, `make lint`, `make test-api SCOPE=packages/radar-domain ENV=test-feat-api-skeleton` (or workspace-scoped vitest).

- [x] **Lot 2 — Hono API skeleton**
  - [ ] `api/package.json` (hono, @hono/node-server, pino, drizzle-orm, pg, @aws-sdk/client-s3, zod, @radar/domain; dev: vitest, typescript, drizzle-kit).
  - [ ] `api/tsconfig.json` extends `tsconfig.base.json`.
  - [ ] `api/src/config.ts` (env parsing with zod).
  - [ ] `api/src/logger.ts` (pino).
  - [ ] `api/src/app.ts` (Hono app, routes mounted), `api/src/index.ts` (node-server bootstrap on port 3000).
  - [ ] `api/src/routes/health.ts` (`GET /health` → checks db + object-store, returns JSON status).
  - [ ] `api/Dockerfile` (multi-stage, Node 24, non-root).
  - [ ] Lot gate: `make typecheck`, `make lint`.

- [x] **Lot 3 — Postgres + Drizzle schema (§7.3)**
  - [ ] `api/src/db/schema.ts` — tables: `sources`, `ingestions`, `documents`, `signals`, `opportunities`, `scores`, `links` (jsonb where unstable, per §7).
  - [ ] `api/drizzle.config.ts`.
  - [ ] `api/drizzle/0000_init.sql` — generated initial migration (single file).
  - [ ] `api/src/db/client.ts` — pg pool + drizzle instance + `checkDbHealth()`.
  - [ ] `make db-migrate` wired to drizzle-kit.
  - [ ] Lot gate: `make typecheck`, `make db-migrate ENV=test-feat-api-skeleton` applies cleanly.

- [x] **Lot 4 — `ObjectStore` S3 abstraction**
  - [ ] `api/src/storage/object-store.ts` — `ObjectStore` interface (`put`, `get`, `head`, `keyFor`).
  - [ ] `api/src/storage/s3-object-store.ts` — `@aws-sdk/client-s3` impl (works against MinIO + Scaleway).
  - [ ] `keyFor(source, date, sha256, ext)` implementing the `raw/<source>/<YYYY>/<MM>/<DD>/<sha256>.<ext>` pattern (rules/sources.md).
  - [ ] `checkObjectStoreHealth()` (bucket head).
  - [ ] Wire both health checks into `/health`.
  - [ ] Lot gate: `make typecheck`, `make lint`.

- [x] **Lot 5 — Makefile real gates + CI (BR02-EX1, EX3)**
  - [ ] `make typecheck` → `tsc --noEmit` per workspace (api + radar-domain) via `--no-deps` container.
  - [ ] `make lint` → eslint (flat config) or `tsc` strict; pick lightweight (eslint with @typescript-eslint).
  - [ ] `make test` → vitest unit + integration (boots postgres+minio for integration).
  - [ ] `make build` → `tsc -b` / per-workspace build.
  - [ ] `make build-api-image` → docker build of `api/Dockerfile`.
  - [ ] `.github/workflows/ci.yml` → boot postgres+minio, run `make test ENV=test-ci`.

- [x] **Lot 6 — Tests green**
  - [ ] Unit: `packages/radar-domain/tests/schemas.spec.ts`.
  - [ ] Integration: `api/tests/integration/health.spec.ts` (real PG + MinIO), `api/tests/integration/object-store.spec.ts` (put/get/head round-trip), `api/tests/integration/db.spec.ts` (migration applied, basic insert/select on `sources`).
  - [ ] Lot gate (full): `make typecheck`, `make lint`, `make test ENV=test-feat-api-skeleton` all green.
  - [ ] Manual smoke: `make dev ENV=feat-api-skeleton` then `curl localhost:8803/health` → 200 with `{db: "ok", objectStore: "ok"}`.

- [ ] **Lot 7 — Push, PR, merge**
  - [ ] `scope-check` skill on the full diff.
  - [ ] `git push -u origin feat/api-skeleton-hono-postgres-s3`.
  - [ ] `gh pr create` referencing lots + exceptions.
  - [ ] CI green.
  - [ ] `gh pr merge --merge` (no squash, no rebase merge).
  - [ ] Local main pulled; move this file to `plan/done/`; update `PLAN.md`.

## Open questions
- [ ] Lint tooling: ESLint flat config vs `tsc`-only? Default to ESLint + @typescript-eslint minimal, unless that bloats the skeleton — decide in Lot 5.
- [ ] `@radar/domain` package name: `@radar/domain` (scoped, unpublished) vs `radar-domain` (plain). Default `@radar/domain` workspace-internal. Confirm in Lot 1.
