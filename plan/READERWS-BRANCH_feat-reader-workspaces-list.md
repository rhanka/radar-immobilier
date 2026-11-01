# Feature: Reader workspace discovery

## Objective
Let a published page discover the verified reader's active workspaces and select one before reading baskets.

## Scope / Guardrails
- Read-only H5 discovery; reuse workspace membership and facet availability services.
- No publisher authority, membership details, new storage, dependencies or migrations.
- Make only, ENV last; no Python, .env reads, cluster actions or background orchestration.
- Commits contain no trailers; preserve the root development environment.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/artifacts/reader-*.ts`
  - `api/src/artifacts/content-serve.ts`
  - `api/tests/integration/artifacts-starter-browser.spec.ts`
  - `api/tests/integration/artifacts-reader-workspaces.spec.ts`
  - `packages/immo-mcp/src/registry/artifact-authoring-guide*.ts`
  - `packages/immo-mcp/src/registry/starter-*.ts`
  - `plan/READERWS-BRANCH_feat-reader-workspaces-list.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans, `.github/workflows/**`, `api/drizzle/**`
- **Conditional Paths**:
  - None.
- **Exception process**:
  - Record READERWS-EXn with rationale, impact and rollback before expanding scope.

## Feedback Loop
- [x] READERWS-EX1: Use the owner-provided `.worktrees/reader-ws` worktree; isolated from root UAT, no relocation needed. Rollback: remove the branch worktree after delivery.
- [x] Execute and review in this session without delegation, as explicitly requested.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; no delegated work or commit transfers.
- [ ] Multi-branch.

## UAT Management (in orchestration context)
- [x] Automated verification only in this worktree; no root UAT or cluster action requested.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read repository rules and harness instructions; confirm clean feature branch.
  - [x] Test project `test-reader-ws`; no published ports for the test compose overlay.
  - [x] Reserve branch ports API 18861, UI 15361, Maildev 11161 if required.
  - [x] Use Make targets with ENV last; omit .env includes and Compose dotenv loading.
- [x] **Lot 1 — Reader contract and operation**
  - [x] Add strict parameter and response contracts and H5 dispatch.
  - [x] Verify operation, authorization, availability and reader isolation against the real PostgreSQL services.
  - [x] Add unit proofs for the discovery contract, isolation, typed failures and H5 grant renewal.
  - [x] Add explicit H5 refusal and authorization-race coverage.
  - [x] Add PostgreSQL coverage for active memberships, availability and account/ACL revocation.
  - [x] Reproduce cross-workspace membership revocation during discovery and include all reader memberships in the final H5 freshness check.
  - [x] Validate the P1 fix with 76 reader unit/integration tests, API typecheck and scoped ESLint; PostgreSQL regression fails before the fix and passes after it.
- [x] **Lot 2 — Authoring starter and guide**
  - [x] Populate a labelled workspace selector; preselect a sole workspace, use manual entry only for an empty list.
  - [x] Document the discovery operation and bump the guide revision to r3 (starter 1.1.0).
  - [x] Verify the reader client and real Chromium flow under the release CSP, including grant recovery and revoked access.
  - [x] Extend browser acceptance for one, several and zero workspaces without an initial UUID.
- [x] **Lot 3 — Delivery**
  - [x] Run gates: 39 API unit/integration tests, 115 MCP registry tests and 1 Chromium acceptance pass; workspace typechecks and ESLint pass.
  - [x] Review the diff for scope, reader identity, strict contracts and absence of PII.
  - [x] Diagnose disposable PostgreSQL initialization/IO contention; sequential integration passes without longer timeouts. Disable fsync/synchronous_commit only in this disposable test database project for remaining checks.
  - [x] Tear down the isolated test stack with `down -v --remove-orphans`.
  - [x] Push, open English PR #977 and write `.lanes/conductor/tmp/reviews/reader-ws-report.md` in French.
