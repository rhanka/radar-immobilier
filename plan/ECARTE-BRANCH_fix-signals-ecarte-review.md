# Feature: Restore discarded signals from the relevance filter

## Objective
Fix #760 P1 while preserving #1090 period selection and perimeter counters. P2 and P3 are outside implementation scope.

## Scope / Guardrails
- Base: fix/signals-period-menu-click at 564971d24; rebase on origin/main after #1090 merges.
- Worktree: tmp/ecarte-review. No environment files or Python. No merge or commit trailers.
- Isolated runtime: test-ecarte, UI 5407, PostGIS 5547. No API or Maildev host listeners.
- CDP: 127.0.0.1:9333 only, disposable tabs closed in finally. Real Playwright mouse clicks.
- Make-only execution through tmp/lane.mk, avoiding the root Makefile environment include. Always down -v.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - api/src/routes/scoped-projection-revisions{,-db.test}.ts
  - ui/src/lib/signals/graph-signal-detail-client{,.test}.ts
  - ui/src/lib/signals/signal-filter-counts{,.test}.ts
  - ui/src/lib/components/maps/SignauxMapView.svelte
  - ui/src/lib/components/maps/SignauxRail.svelte
  - ui/e2e-qa/signals-period-perimeter.spec.ts
  - docs/spec/SPEC_BASE_API.md
  - plan/ECARTE-BRANCH_fix-signals-ecarte-review.md
- **Forbidden Paths (must not change in this branch)**:
  - Makefile, docker-compose*.yml, rules/**
  - AGENTS.md, CLAUDE.md, GEMINI.md
  - Other branch plans
- **Conditional Paths**:
  - None

## Feedback Loop
- [x] Owner replaces #1090 archive-free Filtre rule: include discarded signals when checked.
- [x] P2 analysis belongs to a separate lane. List P3 only in the PR.

## Orchestration Mode (AI-selected)
- [x] Single branch, no delegated implementation.

## UAT Management (in orchestration context)
- [ ] Combined period, counter and restore regression through CDP 9333.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Evidence**
  - [x] Read project rules, harness-debug and harness-test.
  - [x] Confirm clean branch at the required base; #1090 remains open.
  - [x] Trace missing reload and unconditional archive removal in coherent-city and Filtre.
- [ ] **Lot 1 — Regression and correction**
  - [x] Capture red API, unit and browser regression.
  - [x] Add explicit authorized discarded-card reads and reload on relevance visibility change.
  - [x] Align totals and Filtre with the selected relevance classes.
  - [x] Confirm restore and reload persistence.
- [ ] **Lot 2 — Validation and delivery**
  - [ ] Run typecheck, lint, test-ui, concerned API tests and combined browser suite.
  - [ ] Tear down every isolated stack with down -v and close disposable browser tabs.
  - [ ] Check #1090 merge state; rebase when merged.
  - [ ] Push and open PR referencing #760, listing P3 without implementing them.
