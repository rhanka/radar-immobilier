# Feature: Clickable signal periods and perimeter relevance facets

## Objective
Restore real mouse selection in the signal period picker after PR #1084. Count Pertinence over the displayed perimeter with or without selection.

## Scope / Guardrails
- Make-only execution. No environment files, Python, or Kubernetes access.
- Dedicated worktree `tmp/period-click`, based on `origin/main`.
- CDP only at `127.0.0.1:9333`; fresh tabs closed after each run.
- Isolated period harness `ENV=test-period-click`, UI port 15938, API 18938, Maildev 11938.
- Full-view facet campaign: `ENV=test-period-perimeter`, UI port 5399, no API/database/mail services. CDP is unchanged.
- Synthetic UI harness; no backend or data mutation. Always tear down with `down -v`.
- No merge. No generated commit or PR trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/components/maps/SignauxMapView.classement.test.ts`
  - `api/src/services/facets/scoped-by-city.ts`
  - `api/src/services/graph/graph-store{,.test}.ts`
  - `api/tests/integration/base-api-by-city.spec.ts`
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
- [x] Owner authorizes #1090 review blocker: retain archived relevance across city/zone selections, compatible API class cubes and regression coverage.
- [x] Owner authorizes the correction, real mouse regression test and PR.
- [x] Owner adds perimeter Pertinence counters to the same PR; reuse the city cubes and relevance dimension.

## Orchestration Mode (AI-selected)
- [x] Single dedicated branch; no delegated implementation.

## UAT Management (in orchestration context)
- [x] Served preprod reproduced in a fresh CDP tab with real mouse events.
- [x] Local reproduction uses the real rail and DS in an isolated UI harness.

## Plan / Todo (lot-based)
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
