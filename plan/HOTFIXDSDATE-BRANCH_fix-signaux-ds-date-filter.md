# Hotfix: design-system temporal filter for signals

## Objective
Restore a functional temporal lens in the Signaux rail using the canonical
`DatePicker` from `@sentropic/design-system-svelte`, without restoring the
removed bespoke date-range wrapper or preset buttons.

## Scope / Guardrails
- Scope is limited to the Signaux temporal-filter pipeline and its UI regression
  coverage.
- Make-only workflow; no direct Docker commands.
- Development occurs in `./tmp/fix-signaux-ds-date-filter`.
- Automated checks use `ENV=test-signaux-ds-date-filter`, never `ENV=dev`.
- Test ports: API `8816`, UI `5316`, Maildev UI `1116`.
- Every Make command passes `ENV=test-signaux-ds-date-filter` last.
- All new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/src/lib/components/maps/SignauxRail.test.ts`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/signals/signal-date-filter.ts`
  - `ui/src/lib/signals/signal-date-filter.test.ts`
  - `plan/HOTFIXDSDATE-BRANCH_fix-signaux-ds-date-filter.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `docs/reports/consensus/**`
  - all other paths
- **Conditional Paths (allowed only with an explicit exception)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `PLAN.md`
- **Exception process**:
  - Declare an exception ID in `## Feedback Loop` before touching a conditional
    or forbidden path.

## Feedback Loop
- Root cause: PR #408 removed `DateRangeFilter`, its parent-held date range,
  and the display lens, leaving no temporal control in either rail tab.
- Product clarification: the removed bespoke control must be replaced by the
  design-system `DatePicker`, not restored verbatim.
- Minimal design: render one `DatePicker mode="range"` directly in both tab
  panels; retain a small parent-owned display-only date lens. No presets,
  wrapper component, server reclassification, or API changes.
- Review P2: automated DatePicker interaction coverage is deferred to a
  follow-up; this hotfix closes the gap with the explicit functional UAT
  checklist below.
- Rollback: revert this branch; #408 remains independently reversible.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — one UI/pipeline correction with one
  regression cycle.
- [ ] **Multi-branch**

## UAT Management (in orchestration context)
- Before merge, present the commit-identical branch on the root checkout at
  `http://localhost:5301` with `ENV=dev` and choose a range on a city with
  dated signals.
- Verify that the detail list, selected-city badge, and map layers narrow; a
  selected signal or open evidence outside the range is cleared; and the same
  selected range remains visible after switching between `Référence A` and
  `Nouveau B`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Evidence and constraints**
  - [x] Confirmed #408 removed the temporal UI and display lens.
  - [x] Confirmed the requested replacement is the canonical DS `DatePicker`.
  - [x] Created isolated worktree and environment mapping.

- [x] **Lot 1 — Restore the design-system temporal lens**
  - [x] Reintroduce the parent-owned date-range display lens.
  - [x] Render `DatePicker mode="range"` directly in both rail tabs.
  - [x] Keep the date lens display-only and retain undated signals.
  - [x] Add regression coverage for visible controls and narrowing behavior.
  - [x] Lot gate: scoped UI tests and typecheck in the isolated environment.

- [ ] **Lot 2 — UAT, review, and merge**
  - [ ] Run root-checkout UAT at the fixed dev URL, including date selection,
    narrowed detail/badge/layers, cleared hidden selection/evidence, and A/B
    range persistence.
  - [ ] Run consensus review and CI.
  - [ ] Merge with a merge commit after all gates are green.
