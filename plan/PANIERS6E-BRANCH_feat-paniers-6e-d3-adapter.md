# Feature: Lot 6E — D3 report real-graph adapter (report-only)

## Objective
Run the lot 5 D3 attachment (report only) on real graph shapes through a dedicated adapter, where `cibleReglementNumero` is camelCase and sometimes an array. Report only: no facet writes, no real imports.

## Scope / Guardrails
- Scope limited to `api/src/services/steve-source/d3-report/**` plus this branch plan file.
- Reuse the lot 5 resolver, normalization and report; no matching-logic duplication.
- Report-only adapter: no facet writer, no migration, no network, no filesystem access.
- All new code, tests and identifiers in English.
- Synthetic fixtures only; no client data; never read `.env` or `tmp/steve/**`.
- Make-only workflow, `ENV=<env>` passed as the last argument.
- Branch development happens in this worktree; no system `/tmp` writes.
- Automated tests run on dedicated environments (`ENV=test-*`), never on root `dev`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/steve-source/d3-report/graph-adapter.ts`
  - `api/src/services/steve-source/d3-report/resolve.ts`
  - `api/src/services/steve-source/d3-report/report.ts`
  - `api/src/services/steve-source/d3-report/index.ts`
  - `api/src/services/steve-source/d3-report/SPEC.md`
  - `api/src/services/steve-source/d3-report/graph-adapter.test.ts`
  - `plan/PANIERS6E-BRANCH_feat-paniers-6e-d3-adapter.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/drizzle/*.sql`
  - `api/src/services/facets/**`
  - `api/src/routes/**`
  - `tmp/steve/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `../poc-k8s/**` (cross-repo work)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - No exception declared by this plan.

## Feedback Loop
Actions with the following status should be included around tasks only if really required:
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + local bundle** (isolated validation; no push or merge)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: 6E is one orthogonal report-only adapter with a single scoped verification profile.

## UAT Management (in orchestration context)
- UAT is always presented on the **root checkout**, `ENV=dev`, at the fixed
  ports (stable URL `http://localhost:5301`). Do NOT define a per-branch UAT
  port. See `rules/MASTER.md` → *UAT Environment* and `rules/conductor.md`.
- **Mono-branch**: UAT after each lot if UI surface impacted. 6E has no UI surface: no UAT checkpoint.
- [ ] UAT checkpoint: not applicable (no UI surface in 6E).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `conception-lot6-v2.md` section 6E and the lot 5 `d3-report` sources.
  - [x] Confirm scope and guardrails; no `BRxx-EXn` exception needed.
  - [x] Define isolated `test-paniers-l6e-sol`: API `18886`, UI `15886`, mail `11886`; no published ports.
  - [x] Confirm command style: `make -f tmp/paniers-6e/verify.mk ... ENV=test-paniers-l6e-sol` with `ENV` last.
- [ ] **Lot 1 — Graph adapter (reuse lot 5 normalization)**
  - [x] Add `graph-adapter.ts`: `props` plus nested `props.properties`; keys `reglement_number`, `cible_reglement_numero`, `cibleReglementNumero`.
  - [x] Scalar plus array values through lot 5 normalization; one node yields one token set (aliases deduped).
  - [x] Explicit unsupported-value diagnostics; absent values stay silent.
  - [x] Export `REAL_GRAPH_ADAPTER_VERSION` from `index.ts`.
  - [ ] Lot gate:
    - [x] Isolated Make `check-api` + `lint-lot` on `ENV=test-paniers-l6e-sol`.
    - [x] Isolated Make `test-d3` and `test-steve`, synthetic inputs only.
    - [ ] Cleanup with `down -v`, failure status preserved.
- [ ] **Lot 2 — Resolver and report integration (report only)**
  - [x] Route `candidatesForToken` in `resolve.ts` through the adapter; distinct native nodes stay distinct.
  - [x] Record `adapterVersion` in `report.ts` metadata; snapshot identity and digest pass through unchanged.
  - [x] Update `SPEC.md` adapter contract (keys, nesting, arrays, diagnostics, versions).
  - [x] Five-bucket accounting unchanged; no persistence, no facet writes.
  - [ ] Lot gate (same checklist as Lot 1).
- [ ] **Lot 3 — Synthetic qualification**
  - [x] Qualify every key/location with scalar, numeric and array values; empty, malformed and mixed values; frozen deterministic extraction.
  - [ ] Add `graph-adapter.test.ts`: nested/camelCase values; arrays; repeated aliases; malformed values; competing nodes; municipality/MRC ambiguity; unchanged five-bucket accounting; frozen-input no-mutation check.
  - [ ] Fixtures reproduce real shapes only with synthetic values; no client data.
  - [ ] Lot gate (same checklist as Lot 1).
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate the adapter contract in scoped `d3-report/SPEC.md`.
  - [ ] Record measured results, discrimination and limitations in uncommitted `RAPPORT-SOL-6E.md`.
  - [ ] Update this branch plan with verified state.
- [ ] **Lot N — Local delivery**
  - [ ] Create commits of at most 150 changed lines and 15 files, each passing typecheck.
  - [ ] Produce and verify `tmp/paniers-6e/6e.bundle` from `7c56bb93` using local Git metadata.
  - [ ] Preserve the source branch; no push, PR, CI claim or merge in this assignment.
