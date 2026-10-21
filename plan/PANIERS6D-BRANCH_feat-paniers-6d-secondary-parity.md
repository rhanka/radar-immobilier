# Feature: paniers 6D — secondary-surface discard parity

## Objective
Apply the primary reads' discard predicate to every secondary consumer of raw
signal nodes (regulatory enrichment, PDF/evidence, signal-derived lot
indicators) while preserving each consumer's non-basket population.

## Scope / Guardrails
- Scope limited to UI secondary surfaces deriving from authorized signal nodes.
- One logical change per commit; max 150 changed lines and 15 files per commit.
- No new geographic regulation aggregation; no new API route or SQL migration.
- Reuse the predicate in `api/src/services/graph/discarded-signals.ts`; no copy.
- Zero delta: populations, ids, order and counts identical to baseline reference.
- Unknown or unavailable data stays explicit, never counted as zero.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`).
- Branch work stays in this worktree; no system `/tmp` scratch.
- Automated tests run on dedicated envs (`ENV=test-*`), never root `dev`.
- Test mapping: `ENV=test-paniers-6d`, API `18894`, UI `15394`, Maildev `11194`.
- Unit tests publish no host ports; use the isolated `tmp/paniers-6d/Review.mk` entry.
- In every `make` command, `ENV=<env>` is the last argument.
- All new text in English. Discussions with the user may be in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/components/maps/SignalPdfOverlay.svelte` (BR6D-EX1, BR6D-EX2)
  - `ui/src/lib/components/maps/SignauxSelPanel.svelte`
  - `ui/src/lib/components/maps/SignauxSelPanel.test.ts`
  - `ui/src/lib/signals/pdf-overlay-signals.ts`
  - `ui/src/lib/signals/pdf-overlay-signals.test.ts`
  - `ui/src/lib/maps/signaux-reglements.ts`
  - `ui/src/lib/maps/signaux-reglements.test.ts`
  - `ui/src/lib/maps/signaux-map-geo.ts`
  - `ui/src/lib/maps/signaux-map-geo.test.ts`
  - `ui/src/lib/components/maps/SignauxMapView.*.test.ts`
  - `plan/PANIERS6D-BRANCH_feat-paniers-6d-secondary-parity.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `api/**`
  - `packages/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `../poc-k8s/**` (cross-repo work)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- BR6D-EX1: allow `SignalPdfOverlay.svelte` solely to reconcile its retained hover card.
- Reason: two rendered-PDF regressions prove an archived co-signal's hover card remains open and stale citations survive reload.
- Impact: refresh or close the existing card when signal inputs change; no remount, API or geographic change.
- Rollback: revert the isolated hover reconciliation commit; keep its regression tests to expose the gap.
- BR6D-EX2: the astra-fix execution brief authorizes refreshing PDF highlights and badges.
- Reason: the retained current signal ID misses removed co-signals and changed citations on the same page.
- Impact: refresh mounted pages with existing render-token cancellation; no API or geographic change.
- Rollback: revert the isolated PDF refresh commit; retain its rendered regression tests.
- 6D needs no owner decision (reference design, section 6D).
- Local Git metadata and a bundle are authorized by the execution brief; shared Git metadata stays read-only.
- [x] Evidence reconciliation rebuilds current nodes and uses the current visible IDs synchronously.
- [x] PDF regressions cover archives, changed evidence, out-of-filter co-signals and zero delta.
- [x] Regulation/demo/grid and cadastral-indicator regression fixtures are implemented.
- [x] Real detail-route fixtures exercise filtering and explicit reveal through secondary projections.
- [x] BR6D-EX1 closes archived hover cards and refreshes retained evidence; both rendered regressions pass.
- [x] First-reload component regression reproduced the stale filter flag and verifies the corrected current population.
- [x] Predicate discrimination: two new route regressions fail without filtering, all three pass after restoration; both `cmp` checks pass.
- [x] Reference UI: 1,182 tests / 74 files pass; the expanded UI campaign retains every existing test.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: 6D is one orthogonal UI surface with fast unit tests; no independent CI needed.

## UAT Management (in orchestration context)
- UAT is always presented on the **root checkout**, `ENV=dev`, at the fixed
  ports (stable URL `http://localhost:5301`). Do NOT define a per-branch UAT
  port. See `rules/MASTER.md` → *UAT Environment* and `rules/conductor.md`.
- **Mono-branch**: UAT after each lot if UI surface impacted; present it by
  pointing the root checkout at this branch, then return root to its prior state.

## Plan / Todo (lot-based)
- [x] **Lot 6D-0 — Baseline & constraints**
  - [x] Read reference design section 6D and the inspected checkout.
  - [x] Confirm primary reads filter server-side before aggregation.
  - [x] Confirm scope and guardrails; no `BRxx-EXn` exception needed.
- [x] **Lot 6D-1 — Evidence reconciliation helper + MapView wiring**
  - [x] Add pure `rebuildSignalEvidence` in `pdf-overlay-signals.ts`.
  - [x] Rebuild open signal-bound evidence in `reconcileToVisibleNodes`.
  - [x] Preserve independent browsing (`activeSource`/`activeDocument`) and grids.
  - [x] Verify actual detail-route filtering and explicit-reveal parity.
  - [x] Verify first-reload filter flags using the current visible population.
  - [x] Lot gate (isolated Make entry):
    - [x] `typecheck` + `lint`
    - [x] UI tests: `src/lib/signals` (including PDF-overlay helpers).
    - [x] UI tests: `src/lib/components/maps` (including MapView).
- [x] **Lot 6D-2 — Regulation/demo/grid parity tests**
  - [x] Lock panel entries, demo zero-signal entries and grid passthrough.
  - [x] Lock out-of-vivier zone enrichment input population.
  - [x] Lot gate (isolated Make entry):
    - [x] `typecheck` + `lint`
    - [x] UI tests: `src/lib/maps` (including regulation/demo/grid parity).
- [x] **Lot 6D-3 — Lot-indicator parity tests**
  - [x] Lock projection removal without cadastral lot removal.
  - [x] Lock unknown refs producing no projection and no count.
  - [x] Lot gate (isolated Make entry):
    - [x] `typecheck` + `lint`
    - [x] UI tests: `src/lib/maps` (including cadastral-indicator parity).
- [x] **Lot 6D-4 — Docs consolidation**
  - [x] Record locally validated state; CI, operational qualification and merge remain outstanding.
- [ ] **Lot 6D-R — Astra review corrections**
  - [x] Refresh PDF badges/highlights after reload, including an explicitly deferred text read.
  - [ ] Mark unavailable regulatory counts explicitly while preserving demo PDFs and geography.
  - [ ] Discriminate both fixes in a working copy; restore and verify with `cmp`.
  - [ ] Pass indexed typechecks, lint and all three UI directories; remove private test resources.
- [ ] **Lot 6D-5 — Merge & close**
  - [ ] Push branch.
  - [ ] Open PR (or merge directly if solo dev).
  - [ ] Verify CI green.
  - [ ] Merge commit (NO squash, NO rebase merge).
  - [ ] Preserve branch (do NOT delete on merge).
  - [ ] Move this file to `plan/done/6D-BRANCH_feat-paniers-6d-secondary-parity.md`.
