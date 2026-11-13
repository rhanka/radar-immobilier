# Feature: Share the complete signals rail state and verify exclusions

## Objective
Persist relevance with the existing period URL mechanism. Make exclusions consistent across the list, header, city counters and map using existing cubes.

## Scope / Guardrails
- Base: origin/fix/signals-ecarte-review, rebased onto origin/main after #1092 merged.
- Worktree: tmp/url-exclure. No environment files, Python, merge or commit trailers.
- Make-only execution through tmp/lane.mk; no root Makefile environment include.
- Runtime: test-url-exclusions, UI 5408, no API or Maildev listener. CDP 127.0.0.1:9333 only.
- Disposable browser contexts and stacks closed in finally; compose down -v.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/router/geo-filter-state*.ts`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/src/lib/signals/signal-filter-counts*.ts`
  - `ui/e2e-qa/signals-url-exclusions*.ts`
  - `ui/e2e-qa/signals-period-perimeter.spec.ts`
  - `plan/URLX-BRANCH_fix-signals-url-exclusions.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, other branch plans
- **Conditional Paths**:
  - No exceptions required yet.

## Feedback Loop
- [ ] Preprod proof requires an authorized browser session; login requested while local work continues.

## Orchestration Mode (AI-selected)
- [x] Single branch, no delegated implementation.

## UAT Management (in orchestration context)
- [ ] Prove real clicks via CDP 9333 with screenshots and before/after URLs and counts.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] Read project rules and harness-debug then harness-test.
  - [x] Confirm clean branch, fetch base and rebase after #1092 merged.
  - [x] Inspect shared residential-project evidence and cube contract.
- [x] **Lot 1 — Regression and correction**
  - [x] Reproduce local URL and exclusion behavior before edits.
  - [x] Capture failing real-click tests, then apply the smallest evidenced fix.
  - [x] Verify reload, reopened links, history and selected city/zone.
  - [x] Verify exact exclusion deltas, faceting and map membership without heavy calls.
- [x] **Lot 2 — Gates and delivery**
  - [x] Run typecheck, lint, test-ui and combined existing/new browser regressions.
  - [x] Review scope and diff; clean isolated stacks with down -v.
  - [x] Commit without trailers, push and open PR to main. Do not merge.

## Evidence
- [x] Baseline existing seven CDP regressions pass. New three cases fail: unchanged relevance URL; two avoidable aggregate reads in each exclusion scenario. Logs: tmp/red-e2e.log.
- [x] On merged #1092, exclusions already remove the correct signals: 8 to 6 to 4 globally; 4 to 3 to 2 per city and selected detail. Keep the proven residential PIIA. Do not invent a second business rule.
- [x] Initial correction passes all three CDP cases and 19 router unit tests. Exclusions use existing cubes with zero aggregate reads. Logs: tmp/green-e2e-initial.log, tmp/green-unit.log. Screenshots: test-results/signals-url-exclusions-*/{before,excluded-0,excluded-1}.png.
- [x] Full gates: typecheck 0 errors / 8 Svelte warnings, lint 0 errors / 1 warning, test-ui 1,901 passing / 10 todo. Initial typecheck failed because copied dependencies lacked packages/immo-mcp/node_modules; copying that nested dependency tree resolved it without code changes.
- [x] All 11 combined real-click cases pass, including six periods, relevance, discarded restoration, reload/reopened link and history plus city/zone combinations. Four additional actual MapLibre cases pass: each exclusion removes its polygons and city rows with/without selection. Logs: tmp/combined-e2e.log, tmp/map-e2e.log.
- [x] Scope and branch harness gates pass. Independent consensus unavailable: author exact model/effort not exposed; no h2a_run MCP tool. Record selection-failed in tmp/review.md; do not claim peer consensus.
- [x] Final combined run passes all 15 CDP scenarios (43.9 s), with screenshots and before/after URLs. Exclusions trigger zero by-city or coherent-city reads. Log: tmp/final-e2e.log.
- [x] Stack removed with down -v; docker ps shows no remaining containers. PR #1096 opened to main, unmerged: https://github.com/rhanka/radar-immobilier/pull/1096.
- [ ] Preprod authenticated reproduction remains pending. Real Se connecter click reaches passkey/Google login; no authorized session was supplied. Deployed health SHA: a54f05eaaad1d7dbf69679f94fac12d8bec7b252. Evidence: tmp/preprod-proof.log, tmp/preprod-{entry,login}.png. Do not claim a deployed exclusion root cause from local fixtures.
