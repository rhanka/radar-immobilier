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
  - [ ] Reproduce local URL and exclusion behavior before edits.
  - [ ] Capture failing real-click tests, then apply the smallest evidenced fix.
  - [ ] Verify reload, reopened links, history and selected city/zone.
  - [ ] Verify exact exclusion deltas, faceting and map membership without heavy calls.
- [ ] **Lot 2 — Gates and delivery**
  - [ ] Run typecheck, lint, test-ui and combined existing/new browser regressions.
  - [ ] Review scope and diff; clean isolated stacks with down -v.
  - [ ] Commit without trailers, push and open PR to main. Do not merge.
