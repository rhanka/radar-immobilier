# Fix: Remove the Signaux date range filter

## Objective
Remove the Signaux date range controls and their client-side filtering pipeline so every otherwise eligible signal remains visible.

## Scope / Guardrails
- Scope limited to the Signaux rail, map projection, and focused UI regressions.
- Development occurs in `tmp/remove-signaux-date-timeline`; tests use `test-remove-signaux-date`.
- No change to subset URL/local-storage persistence, B exclusions, or map routing.

## Branch Scope Boundaries
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/components/maps/SignauxRail*.test.ts`
  - `ui/src/lib/components/maps/SignauxRail*Harness.svelte`
  - `ui/src/lib/components/maps/DateRangeFilter.svelte`
  - `ui/src/lib/signals/signal-date-filter.*`
  - `plan/HOTFIXDATE-BRANCH_fix-remove-signaux-date-timeline.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)

## Feedback Loop
- [x] Root cause confirmed: the default six-month range was the first Signaux display filter.
- [x] Scope confirmed: preserve A/B subsets, B exclusions, URL/deep links, and map behavior.

## Plan / Todo
- [x] **Lot 0 — Baseline and diagnosis**
  - [x] Create isolated worktree from `origin/main`.
  - [x] Reproduce the hidden six-month filter in source and focused test baseline.

- [x] **Lot 1 — Remove the date range feature**
  - [x] Remove date controls and the parent state/filter pipeline.
  - [x] Delete date-only component, utility, harness, and tests.
  - [x] Add regressions for both tabs and dated/undated signals.

- [x] **Lot 2 — Verify and publish**
  - [x] Run focused UI tests, typecheck, and diff check.
  - [x] Commit, push, open a PR, and verify CI.
