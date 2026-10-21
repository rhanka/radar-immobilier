# Feature: Paniers 6C — MCP reveal

## Objective

Expose an explicit `showDiscarded` flag on the `search_signals` MCP tool so callers can reveal archived signals through the radar API hiding predicate, with identical permissions and no MCP mutation.

## Scope / Guardrails

- Scope limited to `packages/immo-mcp` (tool schema, data source, contract tests, MCP golden fixture).
- Reuse the existing API `showDiscarded=1` query flag (lot 2); zero API change.
- One migration max in `api/drizzle/*.sql`: none (no migration in 6C).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Use the assigned repository-local worktree `.worktrees/paniers-6c`, as required by the execution directive.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English. Discussions with the user may be in French.
- Test environment: `test-paniers-6c-sol`; reserved API/UI/Maildev ports: `18866`/`15366`/`11166`. The isolated runner publishes no ports.
- Do not push. When shared Git metadata is read-only, commit in `tmp/paniers-6c/git` and deliver `tmp/paniers-6c/6c.bundle` from `7c56bb93`.
- Verification scripts, logs, mutation copies and the French integration report are local delivery artifacts, not committed implementation paths.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/immo-mcp/src/data-source.ts`
  - `packages/immo-mcp/src/tools.ts`
  - `packages/immo-mcp/src/data-source.test.ts`
  - `packages/immo-mcp/src/http-session-egress.test.ts`
  - `packages/immo-mcp/src/fixtures/immo-tools.v1.json`
  - `packages/immo-mcp/src/fixtures/immo-deployed-baseline.v1.json` (sha anchor only)
  - `packages/immo-mcp/src/deployed-baseline.test.ts` (sha anchor only)
  - `plan/PANIERS6C-BRANCH_feat-paniers-6c-mcp-reveal.md` (this file)
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `ui/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `../poc-k8s/**` (cross-repo work)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

No exception declared: no conditional or forbidden path is touched.

## Feedback Loop

No blockage. No exception.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: 6C is a single orthogonal read-only seam (MCP tool argument plus forwarding); one branch and one test cycle cover it.

## UAT Management (in orchestration context)

- UAT is always presented on the **root checkout**, `ENV=dev`, at the fixed
  ports (stable URL `http://localhost:5301`). Do NOT define a per-branch UAT
  port. See `rules/MASTER.md` → *UAT Environment* and `rules/conductor.md`.
- **Mono-branch**: UAT after each lot if UI surface impacted; present it by
  pointing the root checkout at this branch, then return root to its prior state.
- No UI surface is impacted by 6C (MCP tool argument only); no UAT checkpoint.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read the 6C contract in `conception-lot6-v2.md` (§ 6C) and the lot-2 API flag in `api/src/routes/graph-signals.ts`.
  - [x] Confirm command style: `make -f tools/immo-mcp-test.mk <target> [SCOPE=<file>] ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails; no `BRxx-EXn` exception needed.

- [x] **Lot 1 — `showDiscarded` argument and forwarding**
  - [x] Add `SearchSignalsArgs.showDiscarded?: boolean` in `packages/immo-mcp/src/data-source.ts`.
  - [x] Forward `showDiscarded=1` in `HttpDataSource.searchSignals` only when strictly `true`; absent or `false` keeps the bare URL (default hiding).
  - [x] Keep etape/query filters and `limit` applied client-side after the API result, in that order.
  - [x] Expose `showDiscarded` as an optional boolean in the `search_signals` tool schema in `packages/immo-mcp/src/tools.ts`; no new tool, no mutation.
  - [x] Lot gate:
    - [x] `make -f tools/immo-mcp-test.mk typecheck ENV=test-paniers-6c-sol`
    - [x] `make -f tools/immo-mcp-test.mk lint ENV=test-paniers-6c-sol`
    - [x] `make -f tools/immo-mcp-test.mk test-immo-mcp SCOPE=src/data-source.test.ts ENV=test-paniers-6c-sol`
    - [x] Runner trap executes `docker compose down -v --remove-orphans` after every gate, including failures.

- [x] **Lot 2 — Discriminating tests and golden re-baseline**
  - [x] Default/false/omitted URL shape (no query string); `true` yields `?showDiscarded=1` with the current user token forwarded. Server visibility precedes the client limit.
  - [x] Reveal-before-search-before-limit ordering; 401/403/503 propagation with the flag set; end-to-end egress through the MCP transport.
  - [x] Update the `search_signals` input schema in `src/fixtures/immo-tools.v1.json`; refresh the two `toolFixtureSha256` anchors.
  - [x] Full `packages/immo-mcp` suite stays green: 127 tests across 10 files, including 12 added tests relative to the base.
  - [x] Current credentials, two-user session isolation, current search scope and invalid flag types are qualified through the transport.
  - [x] Existing API graph-signals contract: 48 tests pass without API changes.
  - [x] Lot gate: typecheck, lint and full `test-immo-mcp` without `SCOPE` pass.

- [x] **Lot N-1 — Delivery evidence**
  - [x] Record a failing forwarding mutation: 8 failures among 31 tests; restoration yields 31 passes and both `cmp` checks pass.
  - [x] Write the uncommitted French integration report with results and commit accounting.
  - [x] Record locally verified state; CI, deployment, workspace authorization and independent review consensus remain outside the verified claim.

- [ ] **Lot N — Merge & close**
  - [ ] Deferred to the conductor: push, CI, PR, merge and roadmap consolidation are outside this assignment.
  - [ ] Push branch.
  - [ ] Open PR (or merge directly if solo dev).
  - [ ] Verify CI green.
  - [ ] Merge commit (NO squash, NO rebase merge).
  - [ ] Preserve branch (do NOT delete on merge).
  - [ ] Move this file to `plan/done/NN-BRANCH_<slug>.md`.
