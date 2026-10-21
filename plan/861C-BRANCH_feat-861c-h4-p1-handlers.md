# Feature: 861C H4 P1 — reusable twelve-tool handlers on immutable invocation context

## Objective
Extract the twelve immo-mcp tool handlers behind an immutable per-request context so the current SDK registrar and the future cluster-mesh bridge consume one implementation, with no second dispatcher and no token exchange yet (exchange arrives in P4).

## Scope / Guardrails
- Scope limited to `packages/immo-mcp` sources, its `package.json` export map, the P1 tests, this branch file and the P1 handoff report.
- Depends on P0 (stacked branch, base `f547fbfa`): P0 fixtures and filets must stay green; schemas, descriptions, responses and errors stay byte-identical.
- No added dependency (only `node:async_hooks` from the runtime).
- No root `Makefile` or root `docker-compose*.yml` change.
- All new text in English. Discussions with the user may be in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/immo-mcp/src/invocation-context.ts`
  - `packages/immo-mcp/src/tool-definitions.ts`
  - `packages/immo-mcp/src/tool-handlers.ts`
  - `packages/immo-mcp/src/tools.ts`
  - `packages/immo-mcp/src/auth-context.ts`
  - `packages/immo-mcp/src/server-http.ts`
  - `packages/immo-mcp/src/invocation-context.test.ts`
  - `packages/immo-mcp/src/request-isolation.test.ts`
  - `packages/immo-mcp/src/tool-fixture-provenance.test.ts`
  - `packages/immo-mcp/package.json`
  - `plan/861C-BRANCH_feat-861c-h4-p1-handlers.md`
  - `RAPPORT-MUSE-H4-P1.md`
  - `RAPPORT-SOL-H4-P1.md` (uncommitted)
  - `tools/h4-mcp.mk` (BR861C-EX1 only)
  - `tools/test-mcp-e2e-exclusion.sh` (BR861C-EX1 only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `tools/immo-mcp-test.mk`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - Any file outside `packages/immo-mcp`, `plan/` and the report
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `../poc-k8s/**` (cross-repo work)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] BR861C-EX1 — Owner execution brief explicitly requests the P0 review's behavioral E2E exclusion canary on both ordinary targets, including inverse controls. Allow the dedicated H4 target, its shell harness and removal of the obsolete textual assertion. Impact: verification only; rollback: revert those changes. Neither ordinary runner recipe changes.
- [x] BR861C-EX2 — Astra review requires bounded compose isolation hardening for the E2E canary: `tools/test-mcp-e2e-exclusion.sh` imposes `test-*` guard plus `env -u` with explicit compose command and isolated project for both sub-makes, with fake-docker coverage for `run` and `down`; `tools/artifact-host.mk` and `tools/immo-mcp-test.mk` pin compose via `override` so the effective project derives only from `ENV`. Impact: test tooling only; rollback: revert the three tooling files.
- [x] Test mapping: `ENV=test-861c-h4-p1`, API `18915`, UI `15915`, Maildev `11915`; no host ports published. Canary and mutation copies use separate test project suffixes.
Actions with the following status should be included around tasks only if really required:
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single cohesive refactor inside one package; no independent validation stream.

## UAT Management (in orchestration context)
- UAT is always presented on the **root checkout**, `ENV=dev`, at the fixed
  ports (stable URL `http://localhost:5301`). Do NOT define a per-branch UAT
  port. See `rules/MASTER.md` → *UAT Environment* and `rules/conductor.md`.
- **Mono-branch**: UAT after each lot if UI surface impacted. P1 has no UI surface: no UAT checkpoint.

## Plan / Todo (lot-based)
- [x] Current commit unit: docs(h4): record verified astra review corrections.
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `conception-h4-v3.md` P1 section and the P0 filets (`deployed-baseline.test.ts`, `tool-fixture-provenance.test.ts`).
  - [x] Confirm scope and guardrails; apply BR861C-EX1.
  - [x] Verification style: `make -f tools/immo-mcp-test.mk <target> ENV=test-861c-h4-p1` with `ENV` last; the H4 runner owns the behavioral canary only.
- [x] **Lot 1 — Immutable invocation context**
  - [x] Add `src/invocation-context.ts`: frozen `InvocationContext` + `AuthorizedEgress` snapshot, `captureInvocationContext`, `authorizedCallContext`, `AsyncLocalStorage` run/get.
  - [x] Expose `./invocation-context` in `package.json` exports.
  - [x] Lot gate:
    - [x] `make -f tools/immo-mcp-test.mk typecheck ENV=test-861c-h4-p1`
    - [x] `make -f tools/immo-mcp-test.mk lint ENV=test-861c-h4-p1`
- [x] **Lot 2 — Tool definitions (single contract source)**
  - [x] Add `src/tool-definitions.ts`: the twelve contracts verbatim (titles, descriptions, zod schemas, bounds, defaults) + per-tool scope + scope map.
  - [x] Expose `./tool-definitions` in `package.json` exports.
  - [x] Lot gate: typecheck + lint + `make -f tools/immo-mcp-test.mk test-immo-mcp ENV=test-861c-h4-p1` (P0 filets must stay green).
- [x] **Lot 3 — Tool handlers (single implementation)**
  - [x] Add `src/tool-handlers.ts`: the twelve handlers on `InvocationContext` with identical logic, errors and redaction; frozen `TOOL_HANDLERS` map (lookup table, not a dispatcher).
  - [x] Expose `./tool-handlers` in `package.json` exports.
  - [x] Lot gate: typecheck + lint + `test-immo-mcp`.
- [x] **Lot 4 — Registrar and HTTP rewiring**
  - [x] Rewrite `src/tools.ts` as the single SDK registrar over definitions + handlers with per-call snapshot resolution.
  - [x] Widen `assertScope` to readonly snapshots in `src/auth-context.ts`.
  - [x] Capture the immutable snapshot at HTTP entry in `src/server-http.ts`; remove shared-holder rebinding.
  - [x] Lot gate: typecheck + lint + `test-immo-mcp` (twelve-tool parity, five `not_wired_yet`, session/egress suites).
- [x] **Lot 5 — Discriminant isolation tests**
  - [x] Add `src/invocation-context.test.ts`: frozen snapshot, concurrent `AsyncLocalStorage` isolation, definition/handler/registrar parity.
  - [x] Add `src/request-isolation.test.ts`: out-of-order completion on one session, zero protected egress on missing scope, requesting-human `showDiscarded` semantics.
  - [x] Lot gate: typecheck + lint + `test-immo-mcp` full file run.
- [x] **Lot 6 — Astra review corrections**
  - [x] Pin both ordinary runners and canary sub-makes to the ENV-derived project (BR861C-EX2).
  - [x] Prove four hostile fake-Docker cases, one -p per call, down -v and zero Docker calls for e2e-*.
  - [x] Compare eight ordinary recipes against ff7d8529; retain payload, command order and SCOPE (cmp=0).
  - [x] Reject inherited DOCKER_COMPOSE in a copy; restore all three tooling files (cmp=0) and rerun green.
  - [x] Repeat real MCP typecheck, lint, full suite (139 tests / 13 files) and both exclusion canaries with inverse controls.
  - [x] Record results and local commits in the Sol report; verify the fix bundle and project teardown.
- [x] **Lot N-1 — Docs consolidation**
  - [x] Update this `BRANCH.md` with merge-ready state.
  - [x] Hand off `RAPPORT-MUSE-H4-P1.md` (modifications, tests, commit split, remaining `not covered`).
- [ ] **Lot N — Merge & close**
  - [ ] Push branch.
  - [ ] Open PR (or merge directly if solo dev).
  - [ ] Verify CI green.
  - [ ] Merge commit (NO squash, NO rebase merge).
  - [ ] Preserve branch (do NOT delete on merge).
  - [ ] Move this file to `plan/done/861C-BRANCH_feat-861c-h4-p1-handlers.md`.
