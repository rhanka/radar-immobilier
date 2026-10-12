# Feature: Reliable geo layers with a delayed map style (#856)

## Objective
Display zones and lots once data and the MapLibre style are ready, in either arrival order. Prevent style exceptions from turning successful lot responses into unavailable data.

## Scope / Guardrails
- Scope limited to map initialization and regression coverage for issue #856.
- Make-only, Docker-first execution; use ignored `tmp/856-tools.mk` for local container tooling.
- Root checkout and its fixed `ENV=dev` UAT ports remain reserved for the owner.
- Worktree: `tmp/fix-856-style-loading`; branch: `fix/856-style-loading`.
- Automated tests: `ENV=test-856-style-loading`; API 8896, UI 5396, Maildev UI 1196, Postgres 5626, S3 9196, Obscura 9396, SMTP 1126.
- No merge or deployment without owner authorization.
- `ENV` is the last argument of every make command; all new repository text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/GeoCityMapBase.svelte`
  - `ui/src/lib/components/maps/GeoCityMapBase.*.test.ts`
  - `ui/src/lib/components/maps/SignauxMapView.style-loading.test.ts`
  - `ui/src/lib/components/maps/test-stubs/StyleLoadingMapLibre.ts`
  - `plan/856-BRANCH_fix-style-loading.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans, API, geo service, dependency manifests and lockfiles.
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`, `api/drizzle/*.sql`, other repositories.
- **Exception process**:
  - Record `BR856-EXn` with reason, impact and rollback before changing a conditional or forbidden path.

## Feedback Loop
- [x] Evidence: owner browser reports before and after the geo-api restart; issue #856 separates restored geo service from the remaining UI defect.
- [x] Evidence: the six-second fallback sets `mapReady` despite failed base-layer setup; lots pagination then reports the rendering exception as a fetch failure.
- [x] Regression baseline: three new lifecycle cases fail on the original component (premature readiness, missing style-load setup, finalization after unmount); the three original cases pass.
- [x] Lifecycle verification: 27 tests pass across fallback, style-load recovery and basemap modes after the fix; no unhandled errors. MapLibre source confirms `style.load` follows `_loaded=true`, while `isStyleLoaded()` also waits for sources/tiles.
- [x] Integration boundary prepared: the MapLibre double stores painted source data and rejects premature or duplicate sources/layers; the real map and loader components will be mounted together.
- [x] Three integration tests pass: data before delayed style, progressive pages after style, and retry after a real request error. Workspace typecheck passes (zero errors).
- [x] Integration assertions verify stable visible counters (Zones 1 / Lots 2), progressive source updates and both zones/lots arriving after style readiness. Full-workspace lint passes.
- [ ] Attention — harness peer review: automatic approval review rejected the first `h2a_run` for code disclosure to the external model gateway without explicit destination authorization; second leg not launched, no consensus verdict. Evidence: ignored `tmp/856-review/review.md`; owner authorization required for peer review.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: one local map lifecycle correction; regression tests use the real Svelte components and a MapLibre boundary double.
- [ ] **Multi-branch**: not required.

## UAT Management (in orchestration context)
- [ ] Owner UAT on the root checkout at the fixed dev URL after review; no production change in this task.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read master, workflow, testing, conductor and harness instructions.
  - [x] Confirm clean isolated worktree on `fix/856-style-loading`, based on `ea90951c`.
  - [x] Read issue #856 and both owner browser reports.
  - [x] Inspect map lifecycle, loader callbacks and current regression coverage.
  - [x] Reserve isolated test environment; inspect running containers before starting any service.
- [x] **Lot 1 — Reproduce and correct style readiness**
  - [x] Reproduce false readiness with an enforced style-loading MapLibre double.
  - [x] Finalize on style readiness without waiting for raster tiles; keep timeout and recovery safe and idempotent.
  - [x] Cover delayed style, missing map load, concurrent callbacks and teardown during municipal-boundary fetch.
  - [x] Lot gate: scoped map lifecycle tests.
- [ ] **Lot 2 — Verify complete geo loading behavior**
  - [x] Cover both data/style arrival orders using the real SignauxMapView and GeoCityMapBase.
  - [x] Verify pagination, retry, stable counters and no false unavailable messages.
  - [ ] Lot gate: UI suite, typecheck, lint and production UI build.
  - [ ] Harness branch/scope verification and review evidence.
- [ ] **Lot 3 — Reviewable delivery**
  - [ ] Commit selectively in atomic changes, preserving test evidence in this plan.
  - [ ] Push branch and open a draft PR; verify CI.
  - [ ] Present evidence, limitations and remaining owner validation.
- [ ] **Lot 4 — Owner-controlled merge & close**
  - [ ] Owner authorizes merge/deployment.
  - [ ] Merge commit only, preserve source branch, archive plan after merge.
