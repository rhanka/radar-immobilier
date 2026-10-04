# Feature: Graph city key `(city_slug, id)` and per-city repair from S3 (#812)

## Objective
Give every city its own node and edge id space in Postgres (`graph_nodes` PK `(city_slug, id)`, `graph_edges.city_slug`), bind the city on every read by id, then repair every contaminated or drifted city from its own S3 `graph/<city>/latest.json` and re-run the document-date recovery, preprod first then prod. Spec: `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md` (owner decision D2 option C of 2026-10-04).

## Scope / Guardrails
- Scope limited to the graph store, its readers listed in the spec inventory (§5), the measurement job, the repair script, their CD jobs and `run-job.yaml` targeting.
- One migration max in `api/drizzle/*.sql`: `0013_graph_city_key.sql` (BR812-EX1), plus a non-journal down script (BR812-EX2).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in repository-local isolated worktrees `./tmp/feat-graph-drift-measure` and `./tmp/fix-graph-city-key`. Do not use system `/tmp`.
- Automated test campaigns must run on dedicated environments (`ENV=test-feat-graph-drift-measure` for PR-1; `ENV=test-fix-graph-city-key` / `ENV=e2e-fix-graph-city-key` for PR-2), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English. Discussions with the user may be in French.
- 0 Python (scripts and jobs in Node/TS only).
- No manual cluster, database or bucket access: every measure, repair, recovery and rollback runs through `run-job.yaml` or the CD.
- Runs outside refresh windows (05:17, 11:17, 17:17, 23:17 UTC, 1 h 30–2 h) and outside 02:23 UTC, one job at a time; never `--heal` on G1, G2, G3, G4, G5c, G6.
- No commit or PR attribution lines of any kind.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - PR-1 `feat/graph-drift-measure` (test ENV `test-feat-graph-drift-measure`):
    - `api/src/scripts/measure-graph-drift.ts`
    - `api/src/scripts/measure-graph-drift.test.ts`
    - `api/tests/integration/graph-drift-measure*.spec.ts`
    - `deploy/k8s/43-graph-drift-measure-job.yaml`
    - `deploy/k8s/graph-drift-measure/**`
    - `deploy/k8s/graph-projection-preprod/**`
    - `deploy/k8s/geo-mapper-preprod/**`
    - `deploy/k8s/consistency-snapshot-preprod/**`
    - `deploy/ci/check-object-storage-bindings.sh`
    - `plan/812-BRANCH_fix-graph-city-key.md`
  - PR-2 `fix/graph-city-key` (test ENV `test-fix-graph-city-key`, e2e ENV `e2e-fix-graph-city-key`):
    - `api/src/db/schema.ts`
    - `api/src/services/graph/**`
    - `api/src/services/data-quality/summary.ts`
    - `api/src/services/geo/geo-features.ts`
    - `api/src/services/geo/resolve-refs.ts`
    - `api/src/services/geo/*.test.ts`
    - `api/src/services/sources/exploitation.ts`
    - `api/src/services/sources/live-scrape.test.ts`
    - `api/src/routes/graph.ts`
    - `api/src/routes/graph.test.ts`
    - `api/src/routes/graph-signals*.test.ts`
    - `api/src/scripts/repair-graph-city-key.ts`
    - `api/src/scripts/measure-graph-drift.ts` (switch to the shared `prepareCityProjection`)
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
    - `deploy/k8s/44-graph-schema-down-job.yaml`
    - `deploy/k8s/graph-city-key-repair/**`
    - `deploy/k8s/graph-schema-down/**`
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
  - `graph/<city>/latest.json` objects in any bucket (the repair never writes them)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file: `0013_graph_city_key.sql`, BR812-EX1)
  - `api/drizzle/meta/_journal.json` (BR812-EX1)
  - `api/drizzle/rollback/**` (BR812-EX2)
  - `.github/workflows/run-job.yaml` (BR812-EX3)
  - `.github/workflows/build-push-images.yml` (BR812-EX4)
  - `deploy/k8s/refresh-cronjobs/**`, `deploy/k8s/refresh-cronjobs-prod/**` (not expected: suspension goes through `run-job.yaml`, never through the overlay, spec K6)
  - `../poc-k8s/**` (cross-repo work)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [ ] `attention` BR812-EX1 — `api/drizzle/0013_graph_city_key.sql` + journal entry; reason: K1–K5 and geo key (spec §4); impact: composite PK, edge city, geo key; rollback: BR812-EX2 down script before the first graph write, forward-fix after (K16).
- [ ] `attention` BR812-EX2 — `api/drizzle/rollback/0013_graph_city_key.down.sql`, outside the drizzle journal, run only by the `graph-schema-down` Job; it also deletes the 0013 row from `drizzle.__drizzle_migrations`; rollback: delete the file.
- [ ] `attention` BR812-EX3 — `.github/workflows/run-job.yaml`: jobs `graph-drift-measure`, `graph-city-key-repair`, `graph-schema-down`; options `refresh-suspend`, `refresh-resume`, `mapper` and `snapshot` with `target_env`; inputs `target_env`, `repair_mode`, `repair_cities`, `mapper_cities`; secret, namespace and pre-flight host selected by `target_env`; mutual busy pre-check; termination-message print; default stays `prod`; rollback: revert the commit.
- [ ] `attention` BR812-EX4 — `.github/workflows/build-push-images.yml`: post-rollout assert adds a graph read check (`/api/graph/<city>`, `/api/graph-signals/<city>`); the promote-prod CronJob assert (`:1438-1448`) is NOT changed (the CronJob is armed at release time, spec K6); rollback: revert the commit.
- [ ] `attention` Q1 (owner) — NULL-city rows in prod, if R0 finds any: delete or attach to a city. Release of PR-2 blocked until answered.
- [ ] `attention` Q2 (owner) — suspension of the refresh CronJob from R1b to R6 per environment and freeze of graph-touching merges to main during the preprod run.
- [ ] `attention` Q3 (owner) — G1 cities in the repair job or kept under D1 `projection`.
- [ ] `attention` Q4 (owner) — per-city S3 archive of PG rows without a restore script.
- [ ] `attention` Q5 (owner) — forward-fix only after the first graph write, or a documented prod restore exercise by the immo operator first.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [x] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: the measurement job and `run-job.yaml` targeting (PR-1, branch `feat/graph-drift-measure`) must be released **before** the migration so that R0 runs on the pre-migration schema with the acceptance tool (spec K13); schema, store, readers and repair (PR-2, branch `fix/graph-city-key`) must ship in one image because the key and every `ON CONFLICT` target are coupled. Operational runs (Lot 7) happen after PR-2 is released.

## UAT Management (in orchestration context)
- UAT is always presented on the **root checkout**, `ENV=dev`, at the fixed ports (stable URL `http://localhost:5301`). Do NOT define a per-branch UAT port. See `rules/MASTER.md` → *UAT Environment* and `rules/conductor.md`.
- **Multi-branch**: no UAT on PR-1 (no UI surface); UAT on PR-2 after Lot 4 (MRC graph view, Signals T1, PDF overlay on a city that shares ids), by pointing the root checkout at the branch, then returning root to its prior state.
- UAT checkpoints listed as checkboxes inside each relevant lot.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints** (size S)
  - [ ] Read `rules/MASTER.md` and pointers (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`).
  - [ ] Create isolated worktrees `./tmp/feat-graph-drift-measure` and `./tmp/fix-graph-city-key` from fresh `origin/main` (after the one-line stop-gap PR is merged).
  - [ ] Capture Makefile targets needed for debug/testing.
  - [ ] Define environment mapping for test/branch stacks only (`test-feat-graph-drift-measure`, `test-fix-graph-city-key`, `e2e-fix-graph-city-key`) with a unique port block per `rules/conductor.md`.
  - [ ] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [ ] Confirm scope and guardrails; record BR812-EX1 to EX4 as acknowledged before touching their paths.
  - [ ] Read the values of `BACKUP_BEFORE_RELEASE_ENABLED`, `BACKUP_BEFORE_RELEASE_PROD_ENABLED`, `PREPROD_CD_ENABLED`, `REFRESH_CRONJOB_PREPROD_ENABLED`, `REFRESH_CRONJOB_PROD_ENABLED`, `ROLLBACK_ON_FAILURE_ENABLED` and record them.
  - [ ] Owner answers to Q1–Q5 recorded in Feedback Loop (Q1 after R0).

- [ ] **Lot 1 — PR-1 `feat/graph-drift-measure`: measurement job and run-job targeting** (size M)
  - [ ] Tests first: v1/v2 equivalence on a seeded database (common fields equal, expected differences listed), content check when id sets agree (fortierville-like fixture), edge drift counts, both schemas (pre and post 0013 fixtures).
  - [ ] `api/src/scripts/measure-graph-drift.ts` per spec §9 (read-only transaction, S3 list/get only, report to S3, ≤ 4 KiB termination message), using `prepareCityProjection` once extracted (Lot 3) or an identical local copy removed in Lot 3.
  - [ ] Jobs `deploy/k8s/43-graph-drift-measure-job.yaml` + `deploy/k8s/graph-drift-measure/job.yaml`; preprod twins for projection, geo mapper and consistency snapshot; bindings in `check-object-storage-bindings.sh`.
  - [ ] `run-job.yaml` (BR812-EX3): `target_env` with secret, namespace and pre-flight host per environment; `graph-drift-measure`; `refresh-suspend` / `refresh-resume`; `mapper_cities`; preprod `mapper` and `snapshot`; termination-message print; mutual busy pre-check.
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-feat-graph-drift-measure`
    - [ ] `make k8s-validate ENV=ci`
  - [ ] PR `Refs #812`, CI green, ≥2-peer review, merge commit, release; R0 in preprod and prod (spec §7.5), reports archived on #812.

- [ ] **Lot 2 — PR-2 `fix/graph-city-key`: migration 0013 + schema** (size M)
  - [ ] Integration tests first: seeded 0012 database with shared ids, shared edge triples, dangling edges, drifted PK name, held lock (`lock_timeout`), NULL-city row (must raise), geo same-node-same-lot in two cities.
  - [ ] `api/drizzle/0013_graph_city_key.sql` per spec §4 steps 0–7 and journal entry (BR812-EX1).
  - [ ] `api/src/db/schema.ts` aligned.
  - [ ] Down script with its prechecks and journal-row deletion (BR812-EX2); up → down → up test with the real drizzle migrator.
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-fix-graph-city-key`

- [ ] **Lot 3 — Store and writers** (size M)
  - [ ] Unit tests first (spec §10 unit list: keys, stale and dangling edges, lock).
  - [ ] `prepareCityProjection` extracted and used by `upsertGraphAtomic` (fixture parity test).
  - [ ] K7 conflict targets in `upsertGraph` and `upsertGraphAtomic`; delete the `citySlug === null` branch and the stop-gap `WHERE`; `buildEdgeRow(link, citySlug)`.
  - [ ] K8 city-scoped dangling-edge delete and stale-edge delete; K15 advisory lock in both writers.
  - [ ] `resolve-refs.ts` conflict target with `city_slug`.
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-fix-graph-city-key`

- [ ] **Lot 4 — Readers, UI, MCP contract** (size M)
  - [ ] Readers bound to the city: `queryNeighbors`, `subgraphForCity` edges, `subgraphForMrc`, `data-quality/summary.ts`, `geo/geo-features.ts:181`, `scripts/report-opportunity-proof.ts`.
  - [ ] MRC response carries `citySlug` on edges; `graph-client.ts` type; `MrcGraphView.svelte` keyed by `(citySlug, id)`.
  - [ ] MCP contract test: `search_signals` items carry `citySlug`.
  - [ ] Update the existing tests listed in spec §5.7.
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-fix-graph-city-key`
    - [ ] `make test-e2e ENV=e2e-fix-graph-city-key`
  - [ ] UAT on root `ENV=dev`: MRC graph view with two cities sharing an id; Signals T1 and PDF overlay unchanged.

- [ ] **Lot 5 — Repair script and jobs** (size L)
  - [ ] Unit tests first: `classifyCityNodes` (same-id foreign docSha also on another id, legacy-merge local props with foreign refs → unknown, property-only contamination, slug mismatch), `repairCityGraph` (unknown refuses pass 1, pass-2 refusal keeps pass 1, idempotence, archive equals replaced state).
  - [ ] `indexS3Nodes`, `classifyCityNodes`, `repairCityGraph` in `graph-store.ts`; `api/src/scripts/repair-graph-city-key.ts` per spec §7.1–7.3 (preview with before/after verdicts, archive under the lock, geo purge, report to S3, termination message).
  - [ ] Integration tests: gore / barkmere end to end, fortierville-like case, concurrent projection waits on the lock.
  - [ ] Jobs `42-graph-city-key-repair-job.yaml` + preprod twin, `44-graph-schema-down-job.yaml` + preprod twin; `run-job.yaml` options `graph-city-key-repair`, `graph-schema-down` (BR812-EX3); graph check in the post-rollout assert (BR812-EX4).
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-fix-graph-city-key`
    - [ ] `make k8s-validate ENV=ci`

- [ ] **Lot 6 — Docs consolidation, PR-2, merge** (size S)
  - [ ] Update `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md` with final design decisions and any deviation.
  - [ ] Update `PLAN.md` branch status.
  - [ ] Push, PR `Refs #812`, CI green, `harness review --consensus` (≥2 peers).
  - [ ] Merge commit (NO squash, NO rebase merge); preserve branch.

- [ ] **Lot 7 — Preprod then prod runs (spec §7.5)** (size M, operational)
  - [ ] Preprod R1: five CD variables checked (spec K6); release PR-2 outside windows; migrate Job Complete; backup object present; CronJob image = release digest.
  - [ ] Preprod R1b: `refresh-suspend` through run-job; graph-touching merges to main frozen until R6.
  - [ ] Preprod R2 structural measurement and authoritative list `L`; R3 repair preview on `L`; before-verdicts compared with `sim.json`, after-verdicts and `unknown` reviewed.
  - [ ] Preprod R4 repair apply; R5 `document-date-recovery` apply without `--heal` on cities whose pass 2 succeeded; R5b `mapper` then `snapshot`.
  - [ ] Preprod R6 acceptance (spec §9); `refresh-resume` through run-job; main unfrozen; first pass 0 `postgres-regression-refused` on repaired cities.
  - [ ] Prod R1 tag `vX.Y.Z` with the same gates (promote assert armed CronJob); R1b–R6 on the prod list `L`, one job at a time; result posted on #812.

- [ ] **Lot 8 — Close**
  - [ ] Drop `graph_edges_dangling_0013` in a later migration only after owner acknowledgement (separate branch).
  - [ ] Move this file to `plan/done/812-BRANCH_fix-graph-city-key.md`.
