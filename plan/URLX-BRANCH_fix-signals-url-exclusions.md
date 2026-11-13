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
- [ ] **Lot 1 — Regression and correction**
  - [x] Reproduce local URL and exclusion behavior before edits.
  - [x] Capture failing real-click tests, then apply the smallest evidenced fix.
  - [ ] Verify reload, reopened links, history and selected city/zone.
  - [ ] Verify exact exclusion deltas, faceting and map membership without heavy calls.
- [ ] **Lot 2 — Gates and delivery**
  - [ ] Run typecheck, lint, test-ui and combined existing/new browser regressions.
  - [ ] Review scope and diff; clean isolated stacks with down -v.
  - [ ] Commit without trailers, push and open PR to main. Do not merge.

## Evidence
- [x] Baseline existing seven CDP regressions pass. New three cases fail: unchanged relevance URL; two avoidable aggregate reads in each exclusion scenario. Logs: tmp/red-e2e.log.
- [x] On merged #1092, exclusions already remove the correct signals: 8 to 6 to 4 globally; 4 to 3 to 2 per city and selected detail. Keep the proven residential PIIA. Do not invent a second business rule.
- [x] Initial correction passes all three CDP cases and 19 router unit tests. Exclusions use existing cubes with zero aggregate reads. Logs: tmp/green-e2e-initial.log, tmp/green-unit.log. Screenshots: test-results/signals-url-exclusions-*/{before,excluded-0,excluded-1}.png.
