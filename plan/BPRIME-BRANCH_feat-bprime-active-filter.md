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

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — the correction is one type-safe call-site normalization on the existing PR branch.
- [ ] **Multi-branch**

## UAT Management (in orchestration context)
- UAT is not required: this correction has no observable UI behavior change.

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
  - [ ] Selectively stage only the call-site correction and this plan.
  - [ ] Commit with `make commit`, push the existing branch, and inspect PR #405 checks.
  - [ ] Confirm the Typecheck check is green; do not merge the PR.
