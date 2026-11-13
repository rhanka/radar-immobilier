# Feature: Clickable signal periods and perimeter relevance facets

## Objective
Restore real mouse selection in the signal period picker after PR #1084. Count Pertinence over the displayed perimeter with or without selection.

## Scope / Guardrails
- Make-only execution. No environment files, Python, or Kubernetes access.
- Dedicated worktree `tmp/period-click`, based on `origin/main`.
- CDP only at `127.0.0.1:9333`; fresh tabs closed after each run.
- Isolated period harness `ENV=test-period-click`, UI port 15938, API 18938, Maildev 11938.
- Full-view facet campaign: `ENV=test-period-perimeter`, UI port 5399, no API/database/mail services. CDP is unchanged.
- Synthetic UI harness and isolated PostGIS at port 5539 for API tests; no shared data mutation. Always tear down with `down -v`.
- No merge. No generated commit or PR trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/components/maps/SignauxMapView.classement.test.ts`
  - `api/src/services/facets/scoped-by-city.ts`
  - `api/src/services/graph/graph-store{,.test}.ts`
  - `api/tests/integration/base-api-by-city.spec.ts`
  - `docs/spec/SPEC_BASE_API.md`
  - `ui/src/lib/signals/signal-filter-counts{,.test}.ts`
  - `ui/e2e-qa/signals-period-click.harness.spec.ts`
  - `ui/e2e-qa/signals-period-perimeter.spec.ts`
  - `ui/e2e-qa/harness/RailFilterHarness.svelte`
  - `plan/PERIODCLICK-BRANCH_fix-signals-period-menu-click.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans
- **Conditional Paths**:
  - None

## Feedback Loop
- [x] Owner authorizes second review pass: Filtre must match the list; archives stay absent even with Écarté checked. Preserve the full Pertinence archive count and document the API cubes.
- [x] Owner authorizes #1090 review blocker: retain archived relevance across city/zone selections, compatible API class cubes and regression coverage.
- [x] Owner authorizes the correction, real mouse regression test and PR.
- [x] Owner adds perimeter Pertinence counters to the same PR; reuse the city cubes and relevance dimension.

## Orchestration Mode (AI-selected)
- [x] Single dedicated branch; no delegated implementation.

## UAT Management (in orchestration context)
- [x] Served preprod reproduced in a fresh CDP tab with real mouse events.
- [x] Local reproduction uses the real rail and DS in an isolated UI harness.

## Plan / Todo (lot-based)
- [x] **Lot 4 — CI #1090 native-discard regression**
  - [x] Reproduce the unchanged graph-signals route test: 47 pass, all-discarded by-city fails.
  - [x] Skip discarded rows before city creation on legacy reads; retain full class cubes on scoped reads.
  - [x] Run graph-signals, API facets/by-city, archive-count regressions and test-ui; remove isolated stacks with down -v.
  - [x] Prepare the trailer-free fix for push; preserve the open, unmerged PR.
- [x] **Lot 3 — Second review pass**
  - [x] Establish archive-free list semantics from coherent-city filtering and real clicks (6 cards → 6 with Écarté → 0 with only Écarté).
  - [x] Reproduce 12 → 13 → 12 on head 8cd024524, then exclude archive cubes from Filtre only.
  - [x] Add unit and city/zone click regressions; clarify that API class cubes include archives.
  - [x] Run requested gates and remove isolated stacks with down -v; close all fresh CDP tabs.
- [x] **Lot 0 — Baseline and evidence**
  - [x] Read project rules and harness debug/test skills.
  - [x] Verify branch equals `origin/main` before implementation.
  - [x] Capture hit targets, pointer events, inert, stacking and event sequence.
- [x] **Lot 1 — Regression and correction**
  - [x] Prove browser regression red before correction, green after correction.
  - [x] Keep picker bounds stable during interaction.
  - [x] Run typecheck, lint, test-ui and targeted browser regression.
- [x] **Lot 2 — Review and delivery**
  - [x] Prove no-selection relevance counters fail before correction and pass after.
  - [x] Apply period, axes and exclusions independently of the relevance checkboxes.
  - [x] Record root cause and validation evidence.
  - [x] Push and open PR against main (#1090).
  - [x] Check CI and preserve branch without merging (latest push pending; no merge).
  - [x] Remove isolated stack and volumes (`down -v --remove-orphans`, no remaining project containers).

## Evidence
- [x] CI correction: unchanged graph-signals route suite reproduces 47 passes / 1 all-discarded failure on 4c616a4b7. Legacy aggregation now skips discarded rows before creating cities when class cubes are not requested; scoped class cubes retain archives and exclude them from visible totals.
- [x] Final requested API campaign: 23 files / 291 tests pass, including all 48 graph-signals route tests, graph-store, integration facets, scoped facets/projection routes and by-city. Existing archive/date-window/Pertinence assertions are unchanged. Full UI: 145 files pass, 1894 tests pass, 10 todo. Changed-file ESLint and git diff --check pass.
- [x] Extended 141-file facets campaign was not green: 873 passes, 3 test failures and 41 teardown suite failures. PostgreSQL DROP DATABASE checkpoints exceeded fixture cleanup deadlines; two migration assertions fail on missing admission_source in the historical fixture and a journal tail expecting 0024 instead of 0041. No tests changed. Requested suites rerun green on an isolated tmpfs PostGIS database after migration, without timeout changes.
- [x] Commands: make -f tmp/perimeter.mk test-api API_ARGS='src/routes/graph-signals.test.ts tests/integration/facets src/routes/signal-facets-headers.test.ts src/routes/scoped-signal-facets-db.test.ts src/routes/scoped-lot-facets-db.test.ts src/routes/scoped-projection-revisions-db.test.ts src/services/facets/scoped-db.test.ts by-city' ENV=test-period-perimeter; test-ui with the same runner/ENV. Logs: tmp/ci1090-{red,api,api-final,ui,lint}.log. Both db-down and down ran down -v. No environment files loaded. Peer review selection unavailable: tmp/ci1090-review.md.
- [x] Second pass rule: archived targets never enter coherent-city signals (`scoped-projection-revisions.ts:129-139`); the UI relevance lens does not request archived nodes. Filtre therefore excludes `ecarte` cubes, while Pertinence retains them.
- [x] Identical regression on 8cd024524: unit expects 12 but gets 13 for z/r/p. Browser soft assertions reproduce 12 → 13 → 12, continue through Delson and H-01, and fail only on the three no-selection counts after checking Écarté. List semantics test already passes on that head.
- [x] Second pass green: typecheck 0 errors / 8 warnings; lint 0 errors / 1 warning; test-ui 145 files / 1894 tests passed, 10 todo. API 167 tests passed across graph-store, base-api-by-city and scoped-projection-revisions-db on isolated PostGIS port 5539.
- [x] Full-view CDP suite: 5 passed, including unchanged archived Pertinence, all period presets, Filtre city/zone invariance and list visibility. API responses are mocked in the browser fixture; real API contracts are covered separately by the PostGIS tests.
- [x] Second pass commands use `make -f tmp/perimeter.mk {typecheck,lint,test-ui,test-api,run} ENV=test-period-perimeter`; API adds `API_ARGS=src/routes/scoped-projection-revisions-db.test.ts` before ENV. Browser run uses `QA_CDP_URL=http://127.0.0.1:9333 npx playwright test --config playwright.period.config.ts` in the container.
- [x] Evidence: `tmp/runtime/tmp/pass2-{red-unit,red-final-e2e,green-e2e}.log`, `tmp/pass2-{typecheck,lint,test-ui}.log`. All tracked UI/API/package sources match the tested runtime. No lane-origin browser tab or lane container remains after db-down/down (both down -v).
- [x] Review regression against pre-correction sources: selected-city archive pill is 0 instead of 1; API archive cube is empty instead of one signal. Corrected identical tests pass.
- [x] Final gates: typecheck passes (8 warnings), lint passes (1 warning), test-ui passes (145 files / 1893 tests, 10 todo), targeted API passes (164 tests, real PostGIS).
- [x] Final CDP 9333: full-view 3 passed (city then zone, axes, unbounded period, exact API calendar bounds); rail harness 2 passed (all presets and renewed max after closure). Every fresh tab closed by fixture cleanup.
- [x] Review correction: full class cubes precede archive exclusion; visible counters retain their contract. Pertinence always reads every city cube, never incomplete coherent-city nodes.
- [x] Red unit reproduction loses selected city's archive contribution (5 vs 10). Corrected UI unit passes. API archive/date-window coverage passes: 164 tests, including real isolated PostGIS integration.
- [x] Chrome 157 CDP at port 9333; real mousePressed/mouseReleased on served preprod and local UI.
- [x] Preprod entry `/#/carte-signaux` resolves to `/geo/region/quebec?mode=signal`; authenticated existing browser context, no API mocks.
- [x] Each preset centre hits its own content span. Pointer events are auto, no inert ancestor, popover z-index 80. All pointer/click events arrive and the panel stays open.
- [x] Root cause: `SignauxRail.svelte:224` refreshed `timeRangeMax` on every picker pointerdown/keydown, including options inside the open panel.
- [x] DS 0.37.2 `TimeRangePicker.svelte:148` rebuilds resolved presets when max changes. Row registration effects rerun; instrumented `SelectableList.activate` sees only `[all]`, so `valueOf` returns undefined for `6mo` and exits before `onPresetSelect`.
- [x] Diagnostic control with stable max retains `[7d,1mo,3mo,6mo,12mo,all]` and calls `onPresetSelect(6mo)`. Instrumentation is absent from shipped changes.
- [x] Fix refreshes max only on the closed trigger, for pointer activation or Enter/Space. No max change during panel interaction.
- [x] Identical final browser test, old rail: expected `6mo`, received `7d`, failed after 1800 ms. Fixed rail: all six options pass in 1.2 s.
- [x] `make -f /tmp/period-click.mk typecheck ENV=test-period-click`: exit 0, eight warnings.
- [x] `make -f /tmp/period-click.mk lint ENV=test-period-click`: exit 0, one warning.
- [x] `make -f /tmp/period-click.mk test-ui ENV=test-period-click`: 145 files / 1890 tests pass, 10 todo.
- [x] Browser command inside isolated container: `SIGNALS_PERIOD_CDP=1 npx playwright test --config period.config.ts`; standalone config serves the harness at port 15938 without launching a browser.
- [x] Raw evidence preserved under ignored `tmp/period-evidence/`. Standalone Make runner loads no environment files and uses compose `--env-file /dev/null`.
- [x] Consensus review unavailable: no h2a_run MCP tool or exact author model/effort metadata. Selection failure recorded in `tmp/period-evidence/review.md`; no peer consensus claimed.
- [x] Whole-app browser regression on the old rail/view: period stays unchanged; Pertinent is 0 instead of 2 without selection. Both assertions fail within 1800 ms (`tmp/runtime/red-both-e2e.log`).
- [x] Same regression with corrections: all six presets pass; relevance counts cover both cities, ignore their own checkboxes, follow the Precoce axis and refetch on an unbounded period (`tmp/runtime/final-e2e.log`, 2 passed).
- [x] Relevance root cause: `SignauxMapView.svelte` counted only selected-city `filteredDetailNodes`. With no selection the input was empty. Replaced by all-city class cubes; loaded detail replaces only its own city's bulk cube. Missing dimensions mask pills instead of fabricating zeroes.
- [x] Final sources: `make -f tmp/perimeter.mk typecheck ENV=test-period-perimeter` passed (8 warnings); `lint` passed (1 warning); `test-ui` passed (145 files, 1893 tests, 10 todo).
- [x] Final identical full-view browser test against origin/main rail/view: two expected assertion failures (`tmp/runtime/final-red-e2e.log`). Published DS 0.37.2 restored before verification.
- [x] Final corrected full-view run: 2 passed in 6.7 s (`tmp/period-perimeter-evidence/final-green-e2e.log`); all quality logs preserved alongside it.
- [x] Full-view runtime removed with `make -f tmp/perimeter.mk down ENV=test-period-perimeter` (`down -v`). Closed every remaining tab at the lane's dedicated diagnostic origins.
- [x] PR #1090 updated to cover both corrections; no merge. Peer consensus remains unavailable as recorded above.
- [x] Concurrent classification-count edits were preserved in the worktree and excluded from both commits and PR.
- [x] Final regression also passed against a separate `git archive HEAD` snapshot on port 15940; rail SHA-256 matches committed bytes (`b74a8d0acf2ce9a3cc464054676350e60b6cba5c6aa2229523363ac1a757d6f4`).
- [x] PR #1090 is open and unmerged. Branch policy passed; quality and real-stack CI were still running at delivery.
