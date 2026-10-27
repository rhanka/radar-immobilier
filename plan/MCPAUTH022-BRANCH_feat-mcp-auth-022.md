# Feature: MCP auth 022 lot 1 baseline net (0.1.0)

## Objective
Capture the 0.1.0 behavior net (plan, isolated runner, group 1 and 2 tests) with zero production or dependency change.

## Scope / Guardrails
- Scope limited to lot 1 filet 0.1.0 (base 7a474439): plan, runner, group 1-2 tests, report.
- No production code change, no dependency change; the 0.2.2 upgrade lives in lot 2b-MCP.
- Make-only workflow; `ENV` passed last; tests run on `ENV=test-*` only.
- Fixture SHAs unchanged (`31487e8f…d998`, `eb984665…ab8f`); existing suites stay green.
- API port 18861 stays reserved for 861-a; this lot publishes no ports.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/MCPAUTH022-BRANCH_feat-mcp-auth-022.md`
  - `tools/immo-mcp-test.mk` (via BR022-EX1)
  - `packages/immo-mcp/src/http-401-golden.test.ts`
  - `packages/immo-mcp/src/http-discovery-routes.test.ts`
  - `packages/immo-mcp/src/http-session-egress.test.ts`
  - `RAPPORT-FILET.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `package.json`, `**/package.json`, `package-lock.json`, `**/package-lock.json`
  - `packages/immo-mcp/src/server-http.ts`
  - `packages/immo-mcp/src/fixtures/**`
  - `deploy/k8s/41-immo-mcp-ingress.yaml`
  - `.github/workflows/**`
  - `api/**`
  - `docs/spec/SPEC_EVOL_MCP_AUTH_022.md`, `SYNTHESE-MCP-AUTH-022.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `BR022-EX1` (runner): reason — lot 1 needs a versioned isolated runner without touching the root `Makefile` (it reads `.env`); impact — one new file `tools/immo-mcp-test.mk`, standalone test compose only; rollback — delete that file.
- Runner preflight scans the whole worktree; only regular, non-symlink, tracked and unchanged `.env.example` files are exempt. Every check installs locked MCP/root dependencies and tears down; guarded cleanup preserves UI dependencies, while `down` remains available if preflight fails.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (existing owner-provided worktree; no history transfer)
- [ ] **Multi-branch**
- Rationale: lot 1 is one baseline net with no dependencies between files beyond the plan.

## UAT Management (in orchestration context)
- No UAT: no UI surface impacted; proof is in-process Vitest only on `ENV=test-mcp-auth-022`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `_ref/LOT-1-FILET.md`, `packages/immo-mcp` tests, `Makefile:200`, `docker-compose.test.yml`.
  - [x] Confirm base `7a474439`, branch `feat/mcp-auth-022`, forbidden paths, fixture SHAs.
- [x] **Lot 1 — filet 0.1.0 (this lot)**
  - [x] Plan + isolated runner (`BR022-EX1`).
  - [x] Group 1a: full 401 golden (status, challenge, body) on POST, GET, DELETE.
  - [x] Group 1b: exact GET discovery route table; identical JSON and Cache-Control on both discovery URLs and the bare route.
  - [x] Group 2: client-mismatch rejection (`azp` over `client_id`), simulated restart, egress spy (Bearer only to graph-signals, none to raw data).
  - [x] Lot gate:
    - [x] `typecheck` + `lint` via the runner
    - [x] scoped `test-immo-mcp`, then full `test-immo-mcp`, `ENV=test-mcp-auth-022`
    - [x] `down -v --remove-orphans` teardown via trap
- [x] **Opus review corrections — points 1–9**
  - [x] Points 2–4, 9: standalone compose, shell-secret canary, recursive preflight, guarded cleanup, scope globs and exception ID.
  - [x] Points 1, 6, 8: exact discovery surface/documents and literal 401 golden.
  - [x] Points 5, 7: complete raw-data egress invariant, labelled 0.1.0 passthrough and exact stale-session rejection.
  - [x] Final runner gates: 114 tests in 10 files, typecheck and lint passed; fixture SHAs unchanged; dependencies, containers, volumes and networks removed.
- [x] **Astra review corrections — PR 877**
  - [x] P2: incomplete file traversal refuses Docker; four `test-guard` cases, old-guard mutation, 114 MCP tests, typecheck and lint pass.
  - [x] Minor: session client binding also rejects a changed `client_id` without `azp`; mutation detects the missing fallback.
  - [x] Final gates: five session tests, 115 MCP tests in 10 files, typecheck and lint pass.
- [ ] **Lot N — Merge & close**
  - [ ] Push branch.
  - [ ] Open PR (or merge directly if solo dev).
  - [ ] Verify CI green.
  - [ ] Merge commit (NO squash, NO rebase merge).
  - [ ] Preserve branch (do NOT delete on merge).
  - [ ] Move this file to `plan/done/MCPAUTH022-BRANCH_feat-mcp-auth-022.md`.
