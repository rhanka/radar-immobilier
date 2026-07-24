# Fix: Time range picker popover placement

## Objective

Make the Signals temporal picker a usable New Relic-style floating overlay: it
must remain inside the viewport, above the rail/map, and all relative presets
must be clickable.

## Scope / Guardrails

- Scope is limited to the Signals temporal-picker integration and focused UI
  regressions.
- Root workspace is reserved for user UAT. Development happens only in this
  isolated worktree.
- The branch dev stack runs without OIDC because no OIDC credentials are
  supplied; it uses API 8833, UI 5333, and Maildev 1133.
- Tests run only on `ENV=test-time-range-picker-popover`.

## Branch Scope Boundaries

- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/src/lib/components/maps/SignauxRail.test.ts`
  - `ui/src/lib/components/maps/SignauxRailFilterHarness.test.ts`
  - `ui/src/lib/signals/signal-date-filter.ts`
  - `ui/src/lib/signals/signal-date-filter.test.ts`
  - `plan/HOTFIXTIMEPOPOVER-BRANCH_fix-time-range-picker-popover.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (explicit exception required)**:
  - `.github/workflows/**`
  - `api/drizzle/*.sql`

## Feedback Loop

- `HOTFIXTIMEPOPOVER-ACK1` — user requested an isolated, authentication-free
  local dev surface before UX acceptance. The server configuration already
  disables OIDC whenever its credentials are absent; no auth code change is
  required.

## Orchestration Mode

- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one component owns both placement and pointer interaction; the
  conductor integrates read-only parallel diagnostics into one minimal change.

## Plan / Todo

- [x] **Lot 0 — Reproduce and constrain**
  - [x] Create isolated worktree and branch.
  - [x] Confirm development ports do not collide with root UAT.
  - [x] Record the reported reproduction: open the picker, then select 3/6/12
    months in the relative tab.
  - [x] Start the authentication-free branch dev surface and provide its URL.

- [x] **Lot 1 — Repair the picker overlay**
  - [x] Prove the clipping and pointer-event root cause from component markup
    and design-system overlay semantics.
  - [x] Apply the smallest placement/integration correction.
  - [x] Add focused regressions for the popover and every relative preset.
  - [x] Run scoped UI tests, lint, and typecheck on the isolated environment.
  - [x] Present the repaired dev URL for user UX acceptance.

- [x] **Lot 1b — Compact trigger follow-up**
  - [x] Keep the trigger full-width with the chevron at its right edge.
  - [x] Restore compact rail typography for the field label.
  - [x] Format custom date ranges as concise, date-only local dates and retain
    single-line overflow protection.

- [ ] **Lot 2 — Review, merge and close**
  - [x] Obtain independent code review after the fix.
  - [ ] Push, verify CI, and merge with a merge commit after user UX approval.
  - [ ] Preserve the source branch and archive this plan after merge.
