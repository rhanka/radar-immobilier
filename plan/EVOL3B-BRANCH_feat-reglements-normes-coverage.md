# Feature: Live regulation and zoning-norm coverage

## Objective
Expose live geo regulation references and normative values in Source coverage without conflating them with `effet_densifiant`, following Track item `01KXGYVG85VWDB9ES9XVC0X25T` and the MVP contract in `SPEC_UI_REGLEMENTS_GEO_LIVE.md` §11.

## Scope / Guardrails
- Scope is limited to the lazy Source coverage API contract, its Source Console/scorecard UI, and focused tests.
- Treat `/tmp/handover-immo.md` and the dirty root diff as untrusted recovery input; the specified Track acceptance and spec §11 are authoritative.
- Do not implement the deferred zone-to-lot `zoneReglementNormes` fold in this branch.
- Do not change E2 consistency computation or `effet_densifiant` semantics.
- Make-only workflow; no direct package-manager or Docker commands.
- Root checkout is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens only in `./tmp/reglements-normes-coverage`.
- Automated tests use `ENV=test-reglements-normes`, never `ENV=dev`.
- Reserved branch ports if a stack is required: API `8893`, UI `5393`, Maildev UI `1193`.
- In every `make` command, `ENV=test-reglements-normes` is the last argument.
- All code, comments, specs, plans, and commits are in English; user discussion may be in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docs/spec/SPEC_UI_REGLEMENTS_GEO_LIVE.md`
  - `api/src/routes/source-coverage.ts`
  - `api/src/routes/source-coverage.test.ts`
  - `api/src/services/geo/normes-keys.ts`
  - `api/src/services/geo/normes-keys.test.ts`
  - `ui/src/lib/sources/source-coverage-client.ts`
  - `ui/src/lib/sources/source-coverage-client.test.ts`
  - `ui/src/lib/components/sources-map/SourceConsole.svelte`
  - `ui/src/lib/components/sources-map/SourceConsole.test.ts`
  - `ui/src/lib/components/sources-map/SourceScorecard.svelte`
  - `ui/src/lib/components/sources-map/SourceScorecard.test.ts`
  - `ui/src/lib/components/sources-map/SourceCoverageMap.test.ts`
  - `ui/e2e-qa/sources-coverage.spec.ts`
  - `plan/EVOL3B-BRANCH_feat-reglements-normes-coverage.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `api/src/services/consistency/**`
  - `api/src/services/geo/lot-zone-enrichment.ts`
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` and all other branch plans
- **Conditional Paths (allowed only with an explicit exception)**:
  - `.github/workflows/**`
  - `api/drizzle/*.sql`
  - `../poc-k8s/**`
- **Exception process**:
  - Declare `EVOL3B-EXn` in `## Feedback Loop` before touching a conditional or forbidden path.
  - Record reason, impact, and rollback strategy.

## Feedback Loop
- [x] `attention` — Preserve unrelated dirty root changes; never copy them wholesale into this lane.
- [x] `attention` — Batch any questions; do not interrupt implementation for non-blocking choices already resolved by spec §11.
- [ ] `attention` — Report any need to widen scope before changing an unlisted path.
- [x] `accept` — Apply the consensus corrections: exact allowlists, linear evidence aggregation, normalized completeness/errors, warm bulk counters, and bounded failure caching.
- [x] `accept` — Keep Console and scorecard synchronized through a typed local overlay; expose the existing regulation cell as a keyboard-operable detailed control.
- [x] `accept` — Use generic `Mesure geo incomplète` because the wire exposes zoning `numberMatched` but no auxiliary matched counter.
- [x] `accept` — Invalidate lazy regulation overlays on new bulk response identity or generation and close stale detail state.
- [x] `accept` — Use semantic city activation plus a ≥24px regulation control with Enter/Space, Escape, and blur behavior.
- [x] `accept` — Render zero-zone measurement as `Aucune zone servie` without 0/0 evidence ratios.
- [x] `accept` — Reject in-flight lazy results whose selection epoch, bulk response identity, or generation is stale.
- [x] `defer` — Exhaustive E2E state matrix: `make test-e2e` is a placeholder; focused API/client/component behavior tests are required and complete in this correction lot.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + bounded delegated lots**
- [ ] **Multi-branch**
- Rationale: API and UI share one small wire contract; independent reviewers remain read-only until the implementation lot is ready.

## UAT Management (in orchestration context)
- UAT is presented only from the root checkout on fixed `ENV=dev` ports after the branch is committed and review-ready.
- Branch/lane agents must not start or modify the root UAT stack.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Recovery baseline and contract**
  - [x] Read `rules/MASTER.md`, `rules/testing.md`, this branch file, Track item `01KXGYVG85VWDB9ES9XVC0X25T`, and the spec §11.
  - [x] Verify branch `feat/reglements-normes-coverage` in `./tmp/reglements-normes-coverage`.
  - [x] Audit `/tmp/handover-immo.md` and the root dirty diff without modifying root files.
  - [x] Confirm the API counter matrix, completeness semantics, and unavailable-versus-absent mapping before implementation.

- [x] **Lot 1 — Deterministic API coverage contract**
  - [x] Add one shared allowlist/normalization source for regulation keys and normative value keys.
  - [x] Measure coverage per served zoning feature and join live `qc-zonage-norms-*` evidence only to matching normalized zone codes.
  - [x] Expose `numberMatched`, `complete`, `zonesWithGrille`, `zonesWithReglement`, `zonesWithLegacyNormes`, `zonesWithNormativeValues`, and union `covered`.
  - [x] Keep unavailable/malformed geo distinct from business absence and block `verified` when the measurement is incomplete.
  - [x] Add focused tests for regulation-only, normative values, unmatched codes, truncation, malformed geo, and no `effet_densifiant` fabrication.
  - [x] Lot gate: `make test-api SCOPE=src/routes/source-coverage.test.ts ENV=test-reglements-normes`.
  - [x] Commit only Lot 1 files plus this plan update.

- [x] **Lot 2 — Source Console and scorecard evidence**
  - [x] Rename the existing layer to `Règlements & normes` without adding a separate column.
  - [x] Render understandable evidence for regulation sources, normative values, legacy norms, grids, incompleteness, and geo unavailability.
  - [x] Ensure no `densifie` badge or claim appears from regulation/norm fields alone.
  - [x] Update focused component/client tests and stale QA expectations.
  - [x] Lot gate: `make test-ui SCOPE=src/lib/components/sources-map/SourceScorecard.test.ts ENV=test-reglements-normes`.
  - [x] Lot gate: `make test-ui SCOPE=src/lib/components/sources-map/SourceConsole.test.ts ENV=test-reglements-normes`.
  - [x] Commit only Lot 2 files plus this plan update.

- [x] **Lot 2b — Consensus correction pass**
  - [x] Version the final ≤150-line contract in `SPEC_UI_REGLEMENTS_GEO_LIVE.md` §11.
  - [x] Align exact keys, linear duplicate aggregation, page completeness, and hyphenated wire errors.
  - [x] Propagate warm counters and bound both success and failure cache lanes.
  - [x] Add an accessible regulation control with four counters and the anti-invention disclaimer.
  - [x] Synchronize lazy scorecard resolution into the Console for success and failure.
  - [x] Cover auxiliary truncation with generic incomplete wording and focused transition tests.
  - [x] Run every affected focused make test with `ENV=test-reglements-normes` last.

- [x] **Lot 2c — Refresh and keyboard reconciliation**
  - [x] Invalidate verified/error overlays when a fresher or replaced bulk response arrives.
  - [x] Open city scorecards through a semantic keyboard-operable control and preserve lazy success/failure transitions.
  - [x] Meet the 24px regulation target and close detail on Escape or blur.
  - [x] Keep zero-zone wording consistent without misleading 0/0 counters.
  - [x] Lot gate: `make test-ui SCOPE=src/lib/components/sources-map/SourceConsole.test.ts ENV=test-reglements-normes`.

- [x] **Lot 2d — In-flight lazy refresh guard**
  - [x] Capture the selection epoch, bulk response identity, and generation for each lazy scorecard request.
  - [x] Ignore stale success and failure results after a refreshed bulk payload replaces their generation.
  - [x] Cover both race directions with deferred Promise tests.
  - [x] Lot gate: `make test-ui SCOPE=src/lib/components/sources-map/SourceConsole.test.ts ENV=test-reglements-normes`.

- [ ] **Lot 3 — Branch gates and live acceptance evidence**
  - [ ] Run `make typecheck ENV=test-reglements-normes`.
  - [ ] Run `make lint ENV=test-reglements-normes`.
  - [ ] Run all focused API/UI tests affected by the contract.
  - [ ] Verify live payload behavior for at least one city with `qc-zonage-norms-*` and record exact measured counters without hard-coding them as permanent facts.
  - [ ] Run `harness check scope` and `harness verify` categories required by the profile.

- [ ] **Lot 4 — Consensus review, UAT, and delivery**
  - [ ] Obtain at least two independent review voices and reconcile findings.
  - [ ] Present commit-identical UAT on root `http://localhost:5301` with stable `ENV=dev` data.
  - [ ] Verify the `Règlements & normes` row on a live-covered city and the unavailable/absent distinction.
  - [ ] Push the branch and open a draft PR with Track item and acceptance evidence.
  - [ ] Verify CI green; merge only by merge commit and preserve the branch.
