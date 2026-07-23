# Fix: DS date-range filter

## Objective

Finish the date-range filter migration to native design-system controls without changing its filtering or routing behaviour.

## Scope / Guardrails

- Scope limited to the date-range UI component and its focused UI test.
- Worktree: `tmp/fix-ds-date-range-filter`; test environment: `test-ds-date-filter`.
- No deployment, graph, geo, source-coverage, consistency, or consensus-document work.

## Branch Scope Boundaries

- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/DateRangeFilter.svelte`
  - `ui/src/lib/components/maps/SignauxRailDateFilter.test.ts`
  - `plan/13-BRANCH_fix-ds-date-range-filter.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `docs/reports/consensus/**`
  - `api/**`, `packages/**`, `.graphify/**`
- **Conditional Paths**: none.

## Feedback Loop

- [x] `review_date_behavior` — accepted: the date range remains session-only; existing URL and local-storage persistence continues to cover only the Vivier subset.
- [x] `review_date_accessibility` — resolved: the focused test scopes preset buttons through the labelled design-system group.

## Plan / Todo

- [x] **Lot 0 — Constraints**
  - [x] Confirm the active component, mount, design-system primitives, and current URL/state ownership.
  - [x] Create the isolated worktree from `origin/main`.
  - [ ] Run the focused UI test baseline on `test-ds-date-filter` (blocked: Docker address pools are exhausted).

- [ ] **Lot 1 — Native DS migration**
  - [x] Remove internal design-system overrides while preserving the layout wrapper and DS `ButtonGroup`, `Button`, and `DatePicker` primitives.
  - [x] Cover accessible controls and an open date range restored through a preset.
  - [ ] Run focused UI test, typecheck, and build (blocked: Docker address pools are exhausted).

- [ ] **Lot 2 — Commit**
  - [x] Review the scoped diff and reconcile two independent reviews.
  - [x] Commit only these paths.
