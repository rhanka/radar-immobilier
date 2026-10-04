# Feature: Graph city key `(city_slug, id)` and per-city repair from S3 (#812)

## Objective
Give every city its own node and edge id space in Postgres (`graph_nodes` PK `(city_slug, id)`, `graph_edges.city_slug`), bind the city on every read by id, then repair the colliding cities from their own S3 `graph/<city>/latest.json` and re-run the document-date recovery. Spec: `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md` (owner decision D2 option C of 2026-10-04).

## Scope / Guardrails
- Scope limited to the graph store, its readers listed in the spec inventory (§5), the repair script, its CD job and the acceptance measurement.
- One migration max in `api/drizzle/*.sql`: `0013_graph_city_key.sql` (plus a non-journal down script under `api/drizzle/rollback/`, exception BR812-EX1).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in repository-local isolated worktree `./tmp/fix-graph-city-key` (even for one active branch). Do not use system `/tmp`.
- Automated test campaigns must run on dedicated environments (`ENV=test-fix-graph-city-key` / `ENV=e2e-fix-graph-city-key`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English. Discussions with the user may be in French.
- 0 Python (scripts and jobs in Node/TS only).
- Repair and recovery run only through `run-job.yaml`, preprod first, outside refresh windows (05:17, 11:17, 17:17, 23:17 UTC, 1 h 30–2 h) and outside 02:23 UTC; never `--heal` on G1, G2, G3, G4, G5c, G6.
- No commit or PR attribution lines of any kind.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/db/schema.ts`
  - `api/src/services/graph/**`
  - `api/src/services/data-quality/summary.ts`
  - `api/src/services/geo/geo-features.ts`
  - `api/src/services/geo/resolve-refs.ts`
  - `api/src/services/geo/*.test.ts`
  - `api/src/services/sources/exploitation.ts`
  - `api/src/routes/graph.ts`
  - `api/src/routes/graph.test.ts`
  - `api/src/routes/graph-signals*.test.ts`
  - `api/src/scripts/repair-graph-city-key.ts`
  - `api/src/scripts/repair-graph-city-key.test.ts`
  - `api/src/scripts/measure-graph-drift.mjs`
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
  - `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md`
  - `plan/812-BRANCH_fix-graph-city-key.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `graph/<city>/latest.json` objects in any bucket (the repair never writes them)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file: `0013_graph_city_key.sql`)
  - `api/drizzle/meta/_journal.json`
  - `api/drizzle/rollback/**` (BR812-EX1)
  - `.github/workflows/run-job.yaml` (BR812-EX2)
  - `deploy/k8s/kustomization.yaml` (not expected: the repair job stays out of it)
  - `../poc-k8s/**` (cross-repo work)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [ ] `attention` BR812-EX1 — `api/drizzle/rollback/0013_graph_city_key.down.sql`: down script outside the drizzle journal, run only by a reviewed one-shot Job; reason: rollback of K1–K4 before any repair; impact: none on forward migrations; rollback: delete the file.
- [ ] `attention` BR812-EX2 — `.github/workflows/run-job.yaml`: new job `graph-city-key-repair` and input `target_env` (preprod|prod) for `projection`, `document-date-recovery`, `graph-city-key-repair`; reason: preprod-first repair through the same jobs (dossier §6.2 a); impact: default stays `prod`, existing dispatches unchanged; rollback: revert the commit.
- [ ] `attention` Q1 (owner) — NULL-city rows in prod, if Lot 0 finds any: delete or attach to a city. Release blocked until answered.
- [ ] `attention` Q2 (owner) — single release with fail-closed window (K6) vs expand/contract in two releases.
- [ ] `attention` Q3 (owner) — G1 cities in the repair job or kept under D1 `projection`.
- [ ] `attention` Q4 (owner) — per-city S3 archive of PG rows without a restore script.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: schema, store, readers and repair script must ship in one image (the key change and every `ON CONFLICT` target are coupled); the operational runs (Lots 6–7) happen after merge through CD and `run-job.yaml`.

## UAT Management (in orchestration context)
- UAT is always presented on the **root checkout**, `ENV=dev`, at the fixed ports (stable URL `http://localhost:5301`). Do NOT define a per-branch UAT port. See `rules/MASTER.md` → *UAT Environment* and `rules/conductor.md`.
- **Mono-branch**: UAT after Lot 3 (MRC graph view, Signals T1, PDF overlay on a city that shares ids); present it by pointing the root checkout at this branch, then return root to its prior state.
- UAT checkpoints listed as checkboxes inside each relevant lot.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints** (size S)
  - [ ] Read `rules/MASTER.md` and pointers (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`).
  - [ ] Create/confirm isolated repository-local worktree `./tmp/fix-graph-city-key` from fresh `origin/main` (after the one-line stop-gap PR is merged).
  - [ ] Capture Makefile targets needed for debug/testing.
  - [ ] Define environment mapping for test/branch stacks only (`test-fix-graph-city-key`, `e2e-fix-graph-city-key`) with a unique port block per `rules/conductor.md`.
  - [ ] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [ ] Confirm scope and guardrails; record BR812-EX1 and BR812-EX2 as acknowledged before touching their paths.
  - [ ] Read-only measures in prod and preprod (SELECT in a `read_only` transaction through the existing read-only measurement path): `count(*) where city_slug is null`, row counts of both tables, dangling-edge count, PK constraint name, table sizes.
  - [ ] Check whether `run-job.yaml` can target preprod with the existing kubeconfig secret (K12), and whether the CD pre-migration backup is present and restorable (spec §11).
  - [ ] Owner answers to Q1–Q4 recorded in Feedback Loop.

- [ ] **Lot 1 — Measurement v2 (acceptance tool first)** (size S)
  - [ ] Version `api/src/scripts/measure-graph-drift.mjs` from the dossier script with only the spec §9 changes.
  - [ ] Equivalence run v1 vs v2 read-only on preprod before migration: identical JSON except `measuredAt`; output archived on #812.
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-fix-graph-city-key`

- [ ] **Lot 2 — Migration 0013 + schema** (size M)
  - [ ] Integration tests first: seeded 0012 database with shared ids, shared edge triples, dangling edges, drifted PK name; NULL-city row must make the migration raise.
  - [ ] `api/drizzle/0013_graph_city_key.sql` per spec §4 (precheck, edge backfill, dangling archive, keys, postcheck) and journal entry.
  - [ ] `api/src/db/schema.ts` aligned (composite PK, `city_slug` NOT NULL, edge `city_slug` and indexes).
  - [ ] `api/drizzle/rollback/0013_graph_city_key.down.sql` with its refusal precheck (BR812-EX1) and its integration test (up → down → up).
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-fix-graph-city-key`

- [ ] **Lot 3 — Store, readers, UI, MCP contract** (size L)
  - [ ] Unit tests first for every behaviour of spec §10 (unit list).
  - [ ] `graph-store.ts`: K7 conflict targets on nodes and edges in `upsertGraph` and `upsertGraphAtomic`, delete the `citySlug === null` branch and the stop-gap `WHERE`, `buildEdgeRow(link, citySlug)`, K8 city-scoped dangling-edge delete.
  - [ ] Readers bound to the city: `queryNeighbors`, `subgraphForCity` edges, `subgraphForMrc`, `data-quality/summary.ts`, `geo/geo-features.ts:181`, `scripts/report-opportunity-proof.ts`.
  - [ ] `geo_resolutions` cross-city test; change `resolve-refs.ts` only if it shows a collision.
  - [ ] MRC response carries `citySlug` on edges; `graph-client.ts` type; `MrcGraphView.svelte` keyed by `(citySlug, id)`.
  - [ ] MCP contract test: `search_signals` items carry `citySlug`.
  - [ ] Update the existing tests listed in spec §5.7.
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-fix-graph-city-key`
    - [ ] `make test-e2e ENV=e2e-fix-graph-city-key`
  - [ ] UAT on root `ENV=dev`: MRC graph view with two cities sharing an id; Signals T1 and PDF overlay unchanged.

- [ ] **Lot 4 — Repair script** (size M)
  - [ ] Unit tests first: `classifyForeignNodes` (clean / foreign / mixed, slug mismatch), `decontaminateCityNodes` (replace, delete, refuse on mixed, idempotence), preview equal to the dossier simulation on gore / barkmere fixtures.
  - [ ] `indexS3DocShas`, `classifyForeignNodes`, `decontaminateCityNodes` in `graph-store.ts`.
  - [ ] `api/src/scripts/repair-graph-city-key.ts` per spec §7.1–7.3 (preconditions, advisory lock, S3 archive read back before writes, pass 1, pass 2, JSON report, exit codes).
  - [ ] Integration test: gore / barkmere end to end (seed, migrate, repair apply, second repair no-op, `recover-document-dates --apply` without HALT).
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-fix-graph-city-key`

- [ ] **Lot 5 — CD job wiring** (size S)
  - [ ] `deploy/k8s/42-graph-city-key-repair-job.yaml` and preprod twin `deploy/k8s/graph-city-key-repair/job.yaml` modelled on the document-date-recovery pair.
  - [ ] `run-job.yaml` (BR812-EX2): job `graph-city-key-repair`, inputs `repair_mode`, `repair_cities`, `target_env`; busy pre-check extended to `projection` and this job.
  - [ ] Lot gate:
    - [ ] `make k8s-validate ENV=ci`
    - [ ] object-storage binding check (`deploy/ci/check-object-storage-bindings.test.sh` through its make/CI path)

- [ ] **Lot 6 — Docs consolidation, PR, merge** (size S)
  - [ ] Update `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md` with final design decisions and any deviation.
  - [ ] Update `PLAN.md` branch status.
  - [ ] Push branch, open PR `Refs #812`, CI green, ≥2-peer review (`harness review --consensus`).
  - [ ] Merge commit (NO squash, NO rebase merge); preserve branch.

- [ ] **Lot 7 — Preprod then prod runs (spec §7.5)** (size M, operational)
  - [ ] Preprod R0 baseline (measurement v2) archived on #812.
  - [ ] Preprod R1 release through CD; migrate Job Complete; served image = merged commit.
  - [ ] Preprod R2 measurement; R3 repair preview on G2+G3+G4 (131) + G5c; verdicts compared with the dossier simulation.
  - [ ] Preprod R4 repair apply; R5 `document-date-recovery` apply without `--heal` on cities whose pass 2 succeeded.
  - [ ] Preprod R6 acceptance: `foreignPg = 0`, G2G4 and G3 at 0, `pgNullCity = 0`, PK `[city_slug, id]`, next refresh pass 0 `postgres-regression-refused` on repaired cities.
  - [ ] Prod R1 tag `vX.Y.Z` (outside refresh windows and 02:23 UTC); R0/R2 measurements.
  - [ ] Prod R3–R5 on 148 cities + G5c, one job at a time.
  - [ ] Prod R6 acceptance with the same criteria; result posted on #812.

- [ ] **Lot 8 — Close**
  - [ ] Drop `graph_edges_dangling_0013` in a later migration only after owner acknowledgement (separate branch).
  - [ ] Move this file to `plan/done/812-BRANCH_fix-graph-city-key.md`.
