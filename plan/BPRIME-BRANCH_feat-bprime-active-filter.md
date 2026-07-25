# Feature: B-prime active residential filter

## Objective
Restore the B-prime branch typecheck without broadening B-prime classification behavior.

## Scope / Guardrails
- Scope is limited to the CI type error in the B-prime graph-signal projection and its declared PR paths.
- Make-only workflow; no direct Docker commands.
- Development occurs in `./tmp/bprime-pr`; root `ENV=dev` remains reserved for user UAT.
- Automated checks use `ENV=test-bprime-active-filter`, never `ENV=dev`.
- Every Make command passes `ENV=test-bprime-active-filter` last.
- All new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/routes/graph-signals.test.ts`
  - `api/src/routes/graph-signals.ts`
  - `api/src/services/graph/graph-store.test.ts`
  - `api/src/services/graph/graph-store.ts`
  - `packages/radar-domain/src/index.ts`
  - `packages/radar-domain/src/signals/b-prime.test.ts`
  - `packages/radar-domain/src/signals/b-prime.ts`
  - `ui/src/lib/signals/graph-signal-detail-client.ts`
  - `ui/src/lib/signals/graph-signal-filter.test.ts`
  - `ui/src/lib/signals/graph-signal-filter.ts`
  - `plan/BPRIME-BRANCH_feat-bprime-active-filter.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `docs/reports/consensus/**`
  - All other paths
- **Conditional Paths (allowed only with an explicit exception)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `PLAN.md`
- **Exception process**:
  - Declare an exception ID in `## Feedback Loop` with reason, impact, and rollback before touching a conditional or forbidden path.

## Feedback Loop
- CI root cause: GitHub Actions run `30005216162` failed Typecheck at `api/src/services/graph/graph-store.ts:1366` with `TS2379`; the call passes possibly `undefined` optional fields to `BPrimeSignalInput` under `exactOptionalPropertyTypes`.
- Isolated environment: `API_PORT=8815`, `UI_PORT=5315`, `MAILDEV_UI_PORT=1115`, `ENV=test-bprime-active-filter`.
- Local verification: the isolated full typecheck passed with zero TypeScript errors and seven existing Svelte warnings.
- Scoped API-test evidence: the first `make test-api` attempt stopped in `npm ci` with `ENOTEMPTY` while removing `/workspace/ui/node_modules/pdfjs-dist`; it did not reach Vitest, and no Docker or Makefile change is in scope.
- BPRIME-EX1 — permit the B′-to-active-B integration path:
  - Paths: `api/src/services/graph/vivier-v2.ts`, `api/src/services/graph/vivier-v2.test.ts`, and `ui/src/lib/signals/vivier-view-mode.test.ts`.
  - Rationale: the active B detail projection reads the server `vivier_v2` classification and the rail/map bulk counters read its counts. Applying the B′ exclusion in that shared classifier makes both consumers agree without a parallel UI filter; the UI regression test proves that the resulting server exclusion is respected by B's projection and counter.
  - Impact: B excludes B′-identified commercial-regional and explicitly non-residential records from its qualified projection/counts; A's `z|m|p` membership remains calculated by the legacy predicate.
  - Rollback: revert the isolated B′ overlay in `vivier-v2.ts` and its tests; no schema, migration, or client state changes are involved.
- UI projection/counter regression: `make test-ui SCOPE=src/lib/signals/vivier-view-mode.test.ts API_PORT=8815 UI_PORT=5315 MAILDEV_UI_PORT=1115 ENV=test-bprime-active-filter` passed (18 tests).
- Typecheck: `make typecheck API_PORT=8815 UI_PORT=5315 MAILDEV_UI_PORT=1115 ENV=test-bprime-active-filter` completed without TypeScript errors.
- Focused API-test limitation: `make test-api SCOPE=src/services/graph/graph-store.test.ts API_PORT=8815 UI_PORT=5315 MAILDEV_UI_PORT=1115 ENV=test-bprime-active-filter` reaches the isolated test-stack dependency bootstrap but returns after image setup, before observable `npm ci`, migration, or Vitest output. It is unverified locally; PR Quality gates are authoritative.
- BPRIME-EX2 — permit the B′ acceptance recette, the recomposable server counts, and the B rail/panel parity view (2nd adverse review remediation):
  - Paths (beyond EX1):
    - Recette (real fixtures + executable acceptance): `api/src/services/graph/bprime-recette.fixture.ts`, `api/src/services/graph/bprime-recette.test.ts`, `api/src/services/graph/sutton-legacy.fixture.ts`, `api/src/services/graph/coaticook-legacy.fixture.ts`.
    - Counts (recomposable, all B axes): `packages/radar-domain/src/vivier/counts.ts`, `packages/radar-domain/src/vivier/counts.test.ts`.
    - B view + rail/panel parity: `ui/src/lib/signals/vivier-view-mode.ts`, `ui/src/lib/components/maps/SignauxRail.test.ts`, `ui/src/lib/components/maps/SignauxRailFilterHarness.test.ts`, `ui/e2e-qa/signaux-vivier-b-filters.spec.ts`, `ui/e2e-qa/rail-selected-city-stability.spec.ts`.
    - Contract doc: `docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md`.
  - Rationale: the adverse review required (a) R3 residential-evidence precedence unified in one source (`classifyBPrime` ↔ `vivier-v2`), (b) rail↔panel parity for ALL B axes (z/r/p) — the rail previously only recomposed `p`, so the server counts gained a `stageCountsHorsZonage` breakdown that the rail sums when Zonage is unchecked, matching `projectComposedVivierB`, (c) an exhaustive 30-line partition (real committed source OR explicit QA-prod gap), and (d) a CIBLE/QA-prod contract status. These necessarily touch the counts contract, the B view counter, and the recette assets.
  - Impact: additive `stageCountsHorsZonage` field on `VivierV2Counts` (wire-additive, no invariant change); rail count for B now recomposes z; A's `z|m|p` and `classifyResidentielPertinence` remain byte-invariant (golden-tested). No schema/migration/client-state change.
  - Rollback: revert the counts field + rail recomposition + recette assets; A path is untouched so no legacy risk.
- BPRIME-EX3 — permit the third adverse-review remediation (R3 evidence and DTO parity invariant):
  - Paths: `packages/radar-domain/src/vivier/vivier-v2.ts`, `packages/radar-domain/src/signals/b-prime.ts`, `packages/radar-domain/src/signals/b-prime.test.ts`, `api/src/services/graph/vivier-v2.ts`, `api/src/services/graph/vivier-v2.test.ts`, `packages/radar-domain/src/vivier/counts.ts`, `packages/radar-domain/src/vivier/counts.test.ts`, `ui/src/lib/signals/vivier-view-mode.ts`, and `ui/src/lib/signals/vivier-view-mode.test.ts`.
  - Rationale: the review proved that R3 did not recognize an explicit conversion to residential use, omitted the real Beloeil 1667-128 `Commerce` wording, and left the impossible DTO state `residentiel=non` with a null exclusion reason expressible. The fix passes the shared B′ classifier only the graph evidence already resolved by the server and rejects that state at the domain boundary; it also corrects the comments that describe the `r` axis and recomposable stage counters.
  - Impact: R3 recognizes explicit conversion-to-residential-use phrasing while continuing to ignore provenance-only `props.extrait`; the server and rail/panel contract reject the only state that could split their `r` results. A's `classifyResidentielPertinence` and its markers are untouched.
  - Rollback: revert the local evidence handoff, the domain schema refinement, and their unit tests; no migration, source fixture, or A-path change is involved.
- Lot 5 validation: `make test-ui SCOPE=src/lib/signals/vivier-view-mode.test.ts ... ENV=test-bprimefix` stopped before Vitest because the fresh volume had no binary; `make test ... ENV=test-bprimefix` then stopped in its dependency bootstrap with `npm ci ENOTEMPTY` at `/workspace/node_modules/js-yaml/dist`. The production API image reached a successful `npm run typecheck --workspace=api`; the unit suites remain unverified locally and the scoped Make gate stays open.
- Pre-existing note (NOT in scope, signalled only): `isZonageSignal` still uses annotated `etape` as a zonage fallback (`api/src/services/graph/graph-store.ts:1012`), which the spec discourages (`SPEC_EVOL_FILTRAGE_VIVIER_v2` §1). This fallback predates B′ and is deliberately left untouched here — flagged for a dedicated change, not folded into this branch.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — the correction is one type-safe call-site normalization on the existing PR branch.
- [ ] **Multi-branch**

## UAT Management (in orchestration context)
- B′ has observable active-B behavior: it changes the detail projection, map result, and rail counter for excluded signals.
- Before merge, run focused root-checkout UAT on a city containing a B′-excluded signal (for example, a regional commercial pole): select active B and confirm the signal is absent from the map/detail projection and the rail counter reflects that exclusion.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Confirmed branch `feat/bprime-active-filter` in `./tmp/bprime-pr`.
  - [x] Read mandatory project, workflow, testing, harness-debug, and CI-fix instructions.
  - [x] Captured the failed GitHub Actions run, job, file, line, and compiler error.
  - [x] Confirmed the isolated environment mapping and Make-only command form.

- [x] **Lot 1 — Normalize B-prime input at the typed call site**
  - [x] Convert only the three possibly undefined fields passed by `isPrecoceSignal` to `null` before `classifyBPrime`.
  - [x] Preserve classification semantics: null and undefined already share the same fallback behavior in `classifyBPrime`.
  - [x] Lot gate: `make typecheck API_PORT=8815 UI_PORT=5315 MAILDEV_UI_PORT=1115 ENV=test-bprime-active-filter` passed.

- [ ] **Lot 2 — Publish and CI verification**
  - [x] Selectively stage only the call-site correction and this plan.
  - [x] Commit with `make commit`, push the existing branch, and inspect PR #405 checks.
  - [ ] Confirm the Typecheck check is green; do not merge the PR.

- [ ] **Lot 3 — Route B′ through the active Vivier B contract**
  - [x] Reproduced the disconnect: `classifyBPrime` is emitted on graph cards and gates only the unused `r` subsets, while active B reads `classification` / `vivierV2Counts`.
  - [x] Declared `BPRIME-EX1` before touching the shared B classifier or its projection/counter test.
  - [x] Apply B′ exclusions at the shared Vivier B classifier so detail projection and bulk counts consume the same result.
  - [x] Restore the pre-B′ legacy `p` predicate and add regression coverage for B projection/counts plus immutable A `z|m|p` membership.
  - [ ] Lot gate: scoped API/UI tests, typecheck, lint, and branch scope verification in `ENV=test-bprime-active-filter`.

- [ ] **Lot 4 — 2nd adverse review remediation (R3 precedence, parity, partition, CIBLE status)**
  - [x] Declared `BPRIME-EX2` before touching counts / B view / recette / contract doc.
  - [x] R3 unified in ONE decision source: residential-strong evidence wins over franc-non-résidentiel (`classifyBPrime` + shared `RESIDENTIEL_FORT_*`), so `applyBPrimeExclusion` no longer over-excludes conversions; Lavaltrie C-8 excluded, `commercial→résidentiel 12 log` + mixte kept (`classifyVivierSignal` tested).
  - [x] Restored `classifyResidentielPertinence` to origin/main byte-for-byte (A path); golden invariance test pins the `commerciaux`/enseigne boundary (R3 lives only in B′).
  - [x] Rail↔panel parity for ALL B axes: server counts recomposable via `stageCountsHorsZonage`; rail sums it when Zonage unchecked; 8-combo parity test on real `countVivierClassifications` output.
  - [x] Exhaustive 30-line partition: `BPRIME_STEVE30_CONTRACT_CITIES` × real source / QA-prod gap (Coaticook ✓1 proven + ✓2 gap); Rosemère/SCB declared ✗0 NON-attainable côté immo → EN ATTENTE geo (no fabricated marker).
  - [x] Contract status → CIBLE / QA prod requise ville par ville (recette doc).
  - [x] Lot gate (local, hors Docker — poppler-utils breaks the container): domain + api graph + ui vivier/rail suites green; typecheck green. See Feedback Loop.

- [ ] **Lot 5 — 3rd adverse review remediation (R3 evidence, DTO parity, comments)**
  - [x] Read the v3 adverse-review report and reproduce its three R3/DTO counterexamples.
  - [x] Recognize explicit commercial-to-residential-use conversions using only resolved decision evidence; keep provenance-only excerpts out of the predicate.
  - [x] Exclude the real Beloeil 1667-128 `Commerce` signal and cover direct `classifyVivierSignal` counterexamples.
  - [x] Enforce `residentiel=non` implies a named exclusion reason and prove that the rail/panel divergence DTO is rejected.
  - [x] Align the `r` and `stageCounts` comments with the enforced invariant.
  - [x] Run the scoped Make gates in `ENV=test-bprimefix`.
  - Gate evidence (local, hors Docker):
    - `vitest run packages/radar-domain/src/vivier/counts.test.ts packages/radar-domain/src/signals/b-prime.test.ts` → 11/11 ✓
    - `vitest run api/src/services/graph/vivier-v2.test.ts api/src/services/graph/bprime-recette.test.ts` → 22/22 ✓
    - `vitest run api/src/services/graph/graph-store.test.ts` → 93/93 ✓ (7 skip)
    - `vitest run ui/.../vivier-view-mode.test.ts` → 21/21 ✓
    - `tsc --noEmit -p api/tsconfig.json` → 0 errors ✓
    - `tsc --noEmit -p packages/radar-domain/tsconfig.json` → 0 errors ✓
    - A legacy path: zero non-comment diff vs `origin/main`, golden passes ✓
