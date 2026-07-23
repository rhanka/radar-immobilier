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
