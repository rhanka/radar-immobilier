# Feature: Clickable signal period options

## Objective
Restore real mouse selection in the signal period picker after PR #1084.

## Scope / Guardrails
- Make-only execution. No environment files, Python, or Kubernetes access.
- Dedicated worktree `tmp/period-click`, based on `origin/main`.
- CDP only at `127.0.0.1:9333`; fresh tabs closed after each run.
- Isolated `ENV=test-period-click`, UI port 15938, API 18938, Maildev 11938.
- Synthetic UI harness; no backend or data mutation. Always tear down with `down -v`.
- No merge. No generated commit or PR trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/e2e-qa/signals-period-click.harness.spec.ts`
  - `ui/e2e-qa/harness/RailFilterHarness.svelte`
  - `plan/PERIODCLICK-BRANCH_fix-signals-period-menu-click.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans
- **Conditional Paths**:
  - None

## Feedback Loop
- [x] Owner authorizes the correction, real mouse regression test and PR.

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
- [ ] **Lot 2 — Review and delivery**
  - [x] Record root cause and validation evidence.
  - [ ] Push and open PR against main.
  - [ ] Check CI and preserve branch without merging.
  - [ ] Remove isolated stack and volumes.

## Evidence
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
