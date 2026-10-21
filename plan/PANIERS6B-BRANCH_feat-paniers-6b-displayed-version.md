# Feature: Paniers 6B — Displayed signal-version verification

## Objective
Require the displayed signal fingerprint on every new personal facet command. Verify it under the city graph lock without mutation on conflict; preserve exact receipt recovery and all 6A UI corrections.

## Scope / Guardrails
- Base: `43af2941246caceed52edc8cba7d6bbb467900b3`; reference: supplied `conception-lot6-v2.md` §3.1–§3.3 and §6B.
- No migration, workspace activation, lot facets, MCP or secondary surfaces.
- Preserve parent refusal notices and target/viewer context captured at command launch.
- Fingerprints certify graph-node content; PDF bytes and native identity continuity remain separate.
- Make-only execution in containers; use standalone `tmp/paniers-6b/Makefile`, no environment files.
- ENV `test-paniers-sol6b`, reserved API/UI/mail ports 18887/15387/11187; zero published ports.
- `ENV` always last; cleanup uses the same project with `down -v`, including failures.
- Root checkout and `ENV=dev` stay reserved for UAT; work remains in this authorized workspace.
- Local Git metadata/bundle live under `tmp/paniers-6b`; shared metadata stays read-only.
- Every indexed commit passes workspace typecheck; maximum 150 changed lines and 15 files.
- English Conventional Commit subjects at most 72 characters, no body/trailer (explicit assignment).
- French reports remain uncommitted; no push or remote integration is authorized.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/PANIERS6B-BRANCH_feat-paniers-6b-displayed-version.md`
  - `api/src/routes/{graph-signals,signal-facets}.ts`
  - `api/src/routes/legacy-filter-a-transport-golden.test.ts`
  - `api/src/services/facets/{target,commands,writer}.ts`
  - `api/tests/integration/facets-6b-displayed-version.spec.ts`
  - `api/tests/integration/facets-fixture.ts` (additive helper)
  - `api/tests/integration/facets-*.spec.ts` (contract adaptations, EX1/EX2)
  - `ui/src/lib/signals/{graph-signal-detail-client,signal-facets-client}.ts`
  - `ui/src/lib/signals/signal-facets-client.test.ts`
  - `ui/src/lib/components/maps/{SignalFacetControls,SignauxSelPanel,SignauxMapView}.svelte`
  - `ui/src/lib/components/maps/SignalFacetControls.test.ts`
  - `ui/src/lib/components/maps/SignauxSelPanel.facets.test.ts`
  - `ui/src/lib/components/maps/SignauxMapView.{facets.fixtures,facets.test,6b-version.test}.ts`
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
  - Other branch plans, `api/drizzle/**`, `api/src/db/schema.ts`, `packages/**`
  - Facet readers, response/codebook services, frozen fixtures and lot surfaces
- **Conditional Paths**:
  - `ui/src/lib/components/maps/SignalFacetControls.viewer.test.ts` (EX4)
- **Exception process**: declare `BR6b-EXn` with reason, impact and rollback before widening scope.

## Feedback Loop
- `BR6b-EX1`: adapt eight integration-suite imports to the additive displayed-version fixture. Reason: required field. Impact: test inputs only. Rollback: revert helper/imports.
- `BR6b-EX2`: adapt HTTP bodies/expectations while preserving frozen receipts. Reason: strict command schema and pre-6B recovery. Impact: test contract only. Rollback: revert bodies/assertions.
- `BR6b-EX3`: add fingerprints to the undo expectation and synthetic map nodes. Reason: versioned undo. Impact: fixtures/assertion only. Rollback: revert these hunks.
- `BR6b-EX4`: supply fingerprints in viewer-control fixtures and qualify capture/retry/undo after card removal. Reason: disabled controls without a version and exact retry semantics. Impact: UI capture/tests. Rollback: revert capture/fixtures.
- Recovery accepts pre-6A and 6A payloads only for an exact existing authorized receipt; no historical payload executes a new transition.
- Initial checks exposed a golden-test type error and an outdated pending-receipt expectation; corrections preserve immutable receipts.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + local bundle** (single dependency; no shared Git writes)
- [ ] **Multi-branch**
- Rationale: one stacked sublot and one isolated qualification campaign.

## UAT Management (in orchestration context)
- UAT uses the root checkout, `ENV=dev`, fixed URL `http://localhost:5301`.
- Browser UAT, remote CI, push and merge are outside this assignment.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and isolation**
  - [x] Read rules/contract, preserve Muse's patch/stash, and rebase locally onto `43af2941`.
  - [x] Resolve the controls conflict with 6A context/notice behavior and 6B version conflicts.
  - [x] Establish standalone Make, synthetic configuration and private volumes without published ports.
- [ ] **Lot 1 — Source version and writer**
  - [x] Serve the exact stored-node fingerprint, including degraded cards; preserve golden bytes.
  - [x] Verify versions under the city lock, bind digests and preserve historical recovery.
  - [x] Adapt existing API integration contracts.
- [ ] **Lot 2 — Captured UI intentions**
  - [ ] Capture fingerprints in commands/undo; retain parent notices and launch context.
  - [ ] Qualify client/control/viewer/panel behavior and exact network retries.
  - [ ] Qualify undo after card removal and version-conflict reloads.
  - [ ] Browser UAT (not covered).
- [ ] **Lot 3 — Discriminating qualification**
  - [ ] Cover stale/matching/community-only versions and malformed commands.
  - [ ] Cover exact replay, deletion, privacy and parallel stale writes.
  - [ ] Cover 6A receipts, fingerprint-bound keys and lock retention through receipt commit.
  - [ ] Workspace typecheck, full lint, API facets/graph routes and UI maps/signals.
  - [ ] Remove verification in a copy; observe failure, restore, compare bytes and rerun.
- [ ] **Lot N-1 — Delivery**
  - [ ] Audit commits/typecheck logs and verify bundle prerequisite `43af2941`.
  - [ ] Write uncommitted French `RAPPORT-SOL-6B.md` with counts, evidence and limits.
  - [ ] Verify final source identity and `down -v` cleanup.
- [ ] **Lot N — Remote integration (not covered)**
  - [ ] Push, PR, remote CI and merge commit; preserve the branch.
