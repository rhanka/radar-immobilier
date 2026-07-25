# Fix: B′ residential axis count parity

## Objective
Make the `r` (residential) axis in vivier B actually filter the displayed set
(rail count, map choropleth, and detail list), achieving real rail↔panel parity
for all 8 axis combinations. Currently `r` is a no-op on both sides.

## Root Cause (proven)
1. `countForVivierCity` ignores `axes.r` — rail count uses `stageCounts` which
   combines résidentiel=oui AND résidentiel=indéterminé.
2. `projectComposedVivierB` filters `r` via `residentiel.valeur === "non"`, but
   the DTO invariant (vivierV2Schema:71-82) guarantees every `non` already has
   an `exclusion_reason` → the earlier `exclusion_reason !== null` check already
   excludes them → `r` is redundant.
3. Server `stageCounts` combines oui+indéterminé per stage. No per-stage counter
   exists for résidentiel=oui only.
4. The parity test (vivier-view-mode.test.ts:460-464) passes because both sides
   are consistently wrong (both treat `r` as no-op).

## Scope / Guardrails
- Scope limited to the residential axis filtering chain.
- No reclassification, no fabricated exclusion.
- Indéterminés "EN ATTENTE geo" shown when `r` unchecked, filtered when checked.
- A axis must remain byte-invariant (no changes to A path).
- No UI jargon ("honnête", "pire statut").
- Make-only, ENV=test-bprimeres.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/radar-domain/src/vivier/counts.ts`
  - `packages/radar-domain/src/vivier/counts.test.ts`
  - `ui/src/lib/signals/vivier-view-mode.ts`
  - `ui/src/lib/signals/vivier-view-mode.test.ts`
  - `ui/src/lib/components/maps/SignauxRail.test.ts` (BPRIMERES-EX1)
  - `ui/src/lib/components/maps/SignauxRailFilterHarness.test.ts` (BPRIMERES-EX2)
  - `plan/BPRIMERES-BRANCH_fix-bprime-residentiel-count-parity.md`

## Feedback Loop
- BPRIMERES-EX1: SignauxRail.test.ts — add new VivierV2Counts fields to fixture (TS won't compile without). Mechanical, no logic change.
- BPRIMERES-EX2: SignauxRailFilterHarness.test.ts — same as EX1.
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `packages/radar-domain/src/vivier/vivier-v2.ts` (DTO schema unchanged)
  - `packages/radar-domain/src/signals/b-prime.ts` (classification unchanged)
  - `api/src/services/graph/vivier-v2.ts` (server classification unchanged)
  - `api/src/services/graph/graph-store.ts` (aggregation calls same counter fn)

## Plan / Todo

- [x] **Lot 0 — Root cause evidence**
  - [x] Identify all code paths for `r` axis (rail, panel, server)
  - [x] Confirm DTO invariant makes `r` no-op in both rail and panel
  - [x] Identify PR #419 change that widened `stageCounts` to include indéterminé
  - [x] Document root cause

- [x] **Lot 1 — Server counters (domain)**
  - [x] Add `stageCountsResOui` and `stageCountsResOuiHorsZonage` to schema
  - [x] Populate them in `countVivierClassifications`
  - [x] Update domain tests (5/5 pass)
  - [x] Typecheck passes

- [x] **Lot 2 — Client fix (parity)**
  - [x] Fix `projectComposedVivierB`: `r` checked → require `residentiel.valeur === "oui"`
  - [x] Fix `countForVivierCity`: use new counters when `axes.r` is checked
  - [x] Update parity test — all 8 axis combos now have real `r` filtering
  - [x] Update SignauxRail.test.ts and SignauxRailFilterHarness.test.ts fixtures
  - [x] 21/21 vivier-view-mode tests pass, 5/5 domain tests pass
  - [x] Typecheck clean (only pre-existing errors in unrelated files)

- [x] **Lot 3 — Verification**
  - [x] A axis byte-invariant: all A tests pass unchanged
  - [x] Pre-existing Svelte render failures confirmed NOT caused by this change
