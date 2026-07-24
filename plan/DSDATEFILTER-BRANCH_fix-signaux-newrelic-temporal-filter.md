# Feature: Design-system temporal filter

## Objective
Replace the generic calendar range picker introduced by PR #409 with the
canonical design-system temporal filter that matches the New Relic interaction.

## Scope / Guardrails
- Scope limited to the Signals rail temporal-filter integration and its tests.
- Make-only workflow; automated tests use an isolated `test-*` environment.
- Root workspace is reserved for UAT at `http://localhost:5301`.
- `ENV` is the final argument of every Make command.

## Branch Scope Boundaries
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/components/maps/SignauxRail.test.ts`
  - `ui/src/lib/signals/**`
  - `plan/DSDATEFILTER-BRANCH_fix-signaux-newrelic-temporal-filter.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths**:
  - `package.json`, `package-lock.json` only if the canonical component is not
    already provided by the installed design system.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one replacement component and one display lens need a single
  coherent state flow.

## Feedback Loop
- **BRDSDATEFILTER-EX1 — design-system patch update**: allowed to update
  `ui/package.json` and `package-lock.json` from `0.34.69` to `0.34.71`, the
  first release exporting the canonical `TimeRangePicker`. Impact is limited
  to the already declared UI dependency; rollback is the prior lockfile and
  version range.

## UAT Management
- UAT is presented on the root checkout, `ENV=dev`, at
  `http://localhost:5301` after the branch is commit-identical.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read project rules and open `harness debug`.
  - [x] Create the isolated worktree and verify scope.
  - [x] Define `ENV=test-signaux-newrelic-temporal-filter` for automated tests.

- [x] **Lot 1 — Diagnose and replace the control**
  - [x] Identify the canonical New Relic-style temporal filter exported by the
    installed design system and its accessibility contract.
  - [x] Delete the generic `DatePicker` integration and install only the
    canonical control in both A and B panels.
  - [x] Preserve the existing temporal display lens and local-date behaviour.
  - [x] Add regression coverage for the control contract.
  - [x] Lot gate:
    - [x] `make test-ui` scoped — 35 tests passed.
    - [x] UI `svelte-check` — 0 errors (the workspace typecheck still has
      pre-existing API/immo-mcp dependency failures outside this branch).
    - [x] `make lint`

## Feedback Loop

- [x] Two independent reviews completed. The second found a stale `max` bound
  after a long-lived page; the bound is now refreshed on picker interaction
  and relative presets are anchored to the selection instant.

- [ ] **Lot 2 — UAT and close**
  - [ ] Verify the New Relic-style control on the root UAT surface.
  - [ ] Verify list, badge, layers, selection/evidence clearing, and A/B
    persistence after applying a period.
  - [ ] Push branch, verify CI, and merge by merge commit.
