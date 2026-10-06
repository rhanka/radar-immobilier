# Feature: Graph city key `(city_slug, id)` and per-city repair from S3 (#812)

## Objective
Give every city its own node and edge id space in Postgres (`graph_nodes` PK `(city_slug, id)`, `graph_edges.city_slug`), bind the city on every read by id, then repair every contaminated or drifted city from its own S3 `graph/<city>/latest.json` and re-run the document-date recovery, preprod first then prod. Spec: `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md` (owner decision D2 option C and owner decisions Q1–Q5 of 2026-10-04: keep it simple, one PR, forward-fix only, no archive).

## Scope / Guardrails
- Scope limited to the graph store, its readers listed in the spec inventory (§6), the measurement job, the repair script, their CD jobs and `run-job.yaml` targeting.
- One migration max in `api/drizzle/*.sql`: `0013_graph_city_key.sql` (BR812-EX1). No down-migration, no archive, no restore tooling (owner Q4, Q5).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in repository-local isolated worktree `./.worktrees/fix-812-city-scoped-pk` (even for one active branch). Do not use system `/tmp`.
- Automated test campaigns must run on dedicated environments (`ENV=test-fix-graph-city-key` / `ENV=e2e-fix-graph-city-key`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English. Discussions with the user may be in French.
- 0 Python (scripts and jobs in Node/TS only).
- No manual cluster, database or bucket access: every measure, repair and recovery runs through `run-job.yaml` or the CD.
- Runs outside refresh windows (05:17, 11:17, 17:17, 23:17 UTC, 1 h 30–2 h) and outside 02:23 UTC, one job at a time; never `--heal` on G1, G2, G3, G4, G5c, G6; G1 stays under D1.
- No commit or PR attribution lines of any kind.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/db/schema.ts`
  - `api/src/services/graph/**`
  - `api/src/services/data-quality/summary.ts`
  - `api/src/services/geo/geo-features.ts`
  - `api/src/services/geo/resolve-refs.ts`
  - `api/src/services/geo/run-geo-mapper.ts`
  - `api/src/services/geo/*.test.ts`
  - `api/src/services/sources/exploitation.ts`
  - `api/src/services/sources/live-scrape.test.ts`
  - `api/src/routes/graph.ts`
  - `api/src/routes/graph.test.ts`
  - `api/src/routes/graph-signals*.test.ts`
  - `api/src/db/migrate.ts`
  - `api/src/scripts/repair-graph-city-key.ts`
  - `api/src/scripts/project-graph-from-s3.ts`
  - `api/src/scripts/recover-document-dates.ts`
  - `api/src/scripts/report-opportunity-proof.ts`
  - `api/src/scripts/*.test.ts`
  - `api/tests/integration/**`
  - `ui/src/lib/components/reconciliation/MrcGraphView.svelte`
  - `ui/src/lib/components/reconciliation/*.test.ts`
  - `ui/src/lib/graph/graph-client.ts`
  - `ui/src/lib/graph/*.test.ts`
  - `packages/immo-mcp/src/*.test.ts`
  - `e2e/**`
  - `deploy/k8s/42-graph-city-key-repair-job.yaml`
  - `deploy/k8s/graph-city-key-repair/**`
  - `deploy/k8s/35-run-geo-mapper-job.yaml`
  - `deploy/k8s/geo-mapper-preprod/**`
  - `deploy/ci/check-object-storage-bindings.sh`
  - `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md`
  - `PLAN.md`
  - `plan/812-BRANCH_fix-graph-city-key.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `deploy/k8s/refresh-cronjobs/**`, `deploy/k8s/refresh-cronjobs-prod/**` (suspension goes through `run-job.yaml`, spec K6)
  - `graph/<city>/latest.json` objects in any bucket (the repair never writes them)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file: `0013_graph_city_key.sql`, BR812-EX1)
  - `api/drizzle/meta/_journal.json` (BR812-EX1)
  - `.github/workflows/run-job.yaml` (BR812-EX2)
  - `.github/workflows/build-push-images.yml` (BR812-EX3)
  - `../poc-k8s/**` (cross-repo work)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `attention` BR812-EX1 — `api/drizzle/0013_graph_city_key.sql` + journal entry (spec §5); impact: NULL-city rows and dangling edges deleted, composite keys, geo key widened; rollback: forward-fix only (owner Q5).
- [x] `attention` BR812-EX2 — `.github/workflows/run-job.yaml`: reuse the #820 `target` input; options `graph-city-key-repair`, `refresh-suspend`, `refresh-resume`; preprod for them and `mapper`; still 10 inputs (repair reuses `recovery_mode` / `recovery_cities`, mapper reuses `project_cities`); image resolution and busy pre-check extended to repair and mapper; termination-message print; default stays `prod`; rollback: revert the commit.
- [x] `attention` BR812-EX3 — `.github/workflows/build-push-images.yml`: both migrate steps print the migrate termination summary (status + NOTICE counts, A-R5-3); no post-rollout probe (spec §15 R6-6); rollback: revert the commit.
- [ ] `acknowledge` Owner decisions 2026-10-04: Q1 NULL-city rows deleted; Q2 refresh suspended and graph-touching merges frozen during the preprod run; Q3 G1 under D1; Q4 no archive; Q5 forward-fix only.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one PR, one release (owner: keep it simple). The key, every `ON CONFLICT` target, the repair and the measurement ship in the same image; no pre-migration baseline is needed once Q1 is decided.

## UAT Management (in orchestration context)
- UAT is always presented on the **root checkout**, `ENV=dev`, at the fixed ports (stable URL `http://localhost:5301`). Do NOT define a per-branch UAT port. See `rules/MASTER.md` → *UAT Environment* and `rules/conductor.md`.
- **Mono-branch**: UAT after Lot 2 (MRC graph view, Signals T1, PDF overlay on a city that shares ids), by pointing the root checkout at this branch, then returning root to its prior state.
- UAT checkpoints listed as checkboxes inside each relevant lot.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints** (size S)
  - [ ] Read `rules/MASTER.md` and pointers (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`).
  - [x] Create isolated worktree `./.worktrees/fix-812-city-scoped-pk` from fresh `origin/main` `782d20c9` (stop-gap #820 merged).
  - [ ] Define environment mapping for test/branch stacks only (`test-fix-graph-city-key`, `e2e-fix-graph-city-key`) with a unique port block per `rules/conductor.md`; command style `make ... ENV=<env>` with `ENV` last.
  - [ ] Record BR812-EX1 to EX3 as acknowledged before touching their paths.
  - [ ] Read and record `BACKUP_BEFORE_RELEASE_ENABLED`, `BACKUP_BEFORE_RELEASE_PROD_ENABLED`, `PREPROD_CD_ENABLED`, `REFRESH_CRONJOB_PREPROD_ENABLED`, `REFRESH_CRONJOB_PROD_ENABLED`, `ROLLBACK_ON_FAILURE_ENABLED`, `ROLLBACK_ON_FAILURE_PROD_ENABLED`.

- [ ] **Lot 1 — Migration 0013 and store** (size M)
  - [ ] Integration tests first: seeded 0012 database with shared ids, shared edge triples, dangling edges, NULL-city rows, drifted PK name, held lock; geo same node id in two cities on the same lot.
  - [ ] `api/drizzle/0013_graph_city_key.sql` per spec §5 and journal entry (BR812-EX1); `schema.ts` aligned.
  - [ ] Unit tests first for the store (spec §10 unit list: keys, stale and dangling edges, lock, `prepareCityProjection` parity).
  - [ ] `graph-store.ts`: `prepareCityProjection`; conflict targets with the city in `upsertGraph` and `upsertGraphAtomic`; delete the `citySlug === null` branch and the stop-gap `WHERE`; city-scoped dangling and stale edge deletion; per-city lock with guard baseline inside the transaction; `resolve-refs.ts` conflict target.
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-fix-graph-city-key`

- [ ] **Lot 2 — Readers, UI, MCP contract** (size M)
  - [ ] Readers bound to the city: `queryNeighbors`, `subgraphForCity` edges, `subgraphForMrc`, `data-quality/summary.ts`, `geo/geo-features.ts:181`, `scripts/report-opportunity-proof.ts`.
  - [ ] MRC response carries `citySlug` on edges; `graph-client.ts` type; `MrcGraphView.svelte` keyed by `(citySlug, id)`.
  - [ ] MCP contract test: `search_signals` items carry `citySlug`; update the existing tests listed in spec §6.7.
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-fix-graph-city-key`
    - [ ] `make test-e2e ENV=e2e-fix-graph-city-key`
  - [ ] UAT on root `ENV=dev`: MRC graph view with two cities sharing an id; Signals T1 and PDF overlay unchanged.

- [ ] **Lot 3 — Repair, measurement and CD jobs** (size L)
  - [ ] Unit tests first: classifier on full ref objects and property values (same-id foreign docSha also on another id, citation or rawRef lost under an unchanged docSha, changed property value, foreign `sourceRef` or root prop only, legacy-merge local props with foreign refs → unknown, slug mismatch); repair (any `unknown` refuses the city before mutation, baseline minus foreign rows, local completeness, city rolled back whole on any guard refusal, idempotence).
  - [ ] `api/src/scripts/repair-graph-city-key.ts` per spec §7.2 (one all-or-nothing transaction per city, preview in a rolled-back transaction, before/after verdicts, run report to S3, termination message).
  - [ ] `run-geo-mapper.ts` reset mode: per city, purge `geo_resolutions` and `geo_unresolved`, then resolve.
  - [x] Measurement = repair preview `--all` (spec K14, §15 R6-2); no separate script.
  - [ ] Integration tests: gore / barkmere end to end, fortierville-like case, concurrent projection waits on the lock.
  - [x] Job 42 with its preprod twin; geo mapper preprod twin; bindings in `check-object-storage-bindings.sh`; `run-job.yaml` (BR812-EX2); migrate summary print (BR812-EX3).
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-fix-graph-city-key`
    - [ ] `make k8s-validate ENV=ci`

- [ ] **Lot 4 — Docs, PR, merge** (size S)
  - [ ] Update `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md` with any deviation; update `PLAN.md` branch status.
  - [ ] Push, PR `Refs #812`, CI green, `harness review --consensus` (≥2 peers).
  - [ ] Merge commit (NO squash, NO rebase merge); preserve branch — owner only, after review.

- [ ] **Lot 5 — Preprod then prod runs (spec §7.4)** (size M, operational)
  - [ ] Preprod R1: K6 gate (five variables `true`, `ROLLBACK_ON_FAILURE_ENABLED` and `ROLLBACK_ON_FAILURE_PROD_ENABLED` = `false`); release outside windows; migrate Job Complete with NOTICE counts recorded.
  - [ ] Preprod R1b `refresh-suspend` and merge freeze; R2 measurement and list `L`; R3 repair preview reviewed; R4 apply.
  - [ ] Preprod R5 `document-date-recovery` apply without `--heal` on the repaired cities, then `mapper` with `project_cities` = the committed cities (purge + rebuild), then the snapshot (CronJob or `snapshot` job).
  - [ ] Preprod R6 acceptance (spec §9); `refresh-resume`; freeze lifted; first pass 0 `postgres-regression-refused` on repaired cities.
  - [ ] Prod: same steps after preprod R6, tag `vX.Y.Z`; result posted on #812.
  - [ ] Move this file to `plan/done/812-BRANCH_fix-graph-city-key.md`.
