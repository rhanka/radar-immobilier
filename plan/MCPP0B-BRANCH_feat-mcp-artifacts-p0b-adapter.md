# Feature: Prepare the IMMO artifacts P0b adapter

## Objective
Prepare the three qualified P0b operations (0.2.5 or 0.3.0) while preserving the current non-CAS, root-result contract. Publication must require only the central version pin and regenerated lockfile.

## Scope / Guardrails
- Work only in the owner-assigned `.worktrees/mcp-p0b` checkout.
- Make-only execution; no Python, environment-file reads, cluster actions, workflow tools or delegated agents.
- Dedicated `ENV=test-mcp-p0b` and `test-mcp-listget-*` qualification projects; standalone compose has no published ports; teardown uses `down -v`.
- English implementation, commits and draft PR; French conductor report outside the checkout.
- No commit trailers; no merge or deployment.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/immo-mcp/**`, `packages/artifacts-host/**`
  - `api/src/artifacts/control-route*`, `api/tests/*p0b*`
  - `api/drizzle/0028_artifacts_p0b.sql`, `api/drizzle/meta/_journal.json`
  - `api/tests/integration/artifacts-mcp-adapter.spec.ts` (owner-requested CI fixture repair)
  - `package.json`, `package-lock.json`, `api/package.json`
  - `tools/mcp-p0b*`, `docs/runbooks/mcp-artifacts-p0b.md`
  - This branch plan.
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`, agent entry points, other branch plans.
- **Conditional Paths**:
  - Sentropic branch `feat/artifacts-parity-p0b`: read-only API reference.

## Feedback Loop
- [x] MCPP0B-EX1: use the assigned worktree instead of `tmp/`; owner instruction; no root checkout mutation; rollback by removing this branch only.
- [x] MCPP0B-EX2: generated dependency lock may exceed the per-commit line limit; centralize existing pins without changing their version; rollback the dependency-only commit.
- [x] Owner instruction supersedes peer/workflow requirements: perform design, implementation and review directly in this session; do not claim peer consensus.
- [x] Upstream delete requires a release snapshot: make the public field optional and resolve it on the host; proof retries reuse their recorded snapshot.
- [x] Keep an existing P0b digest on the same current-release snapshot as links and timestamps; unit coverage rejects mixed snapshots and PostgreSQL checks the stored digest.
- [x] Docker stalls removing the stopped baseline database (state `removing`, no error): continue qualification under isolated `test-mcp-listget-v025` / `test-mcp-listget-v030` only after the previous API container has exited; retain teardown and final inspection for every project.

## Orchestration Mode (AI-selected)
- [x] Single builder, single branch, no background agent.

## UAT Management (in orchestration context)
- [x] No UAT stack or cluster actions authorized; local isolated contract checks only.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read repository rules, harness guidance and converged-r2.
  - [x] Verify clean assigned branch and inspect the upstream 0.3.0 contracts.
- [x] **Lot 1 — Version boundary and profile**
  - [x] Centralize the pin at 0.2.2; enable P0b automatically with 0.3.0.
  - [x] Extend discovery, scopes, annotations and profile metadata.
- [x] **Lot 2 — Trusted host wiring**
  - [x] Implement the shared source ports and account predicate with transaction-time recipient checks.
  - [x] Source ports, approved IdP subjects, transactional deletion confirmation and migration.
  - [x] Trusted cookie-session confirmation page; mutation accounting and quota classification.
- [x] **Lot 3 — Guide and qualification**
  - [x] Document edit, delete and named-share journeys and publication commands.
  - [x] Verify 0.2.2 baseline and locally packed 0.3.0 candidate; typecheck and lint.
  - [x] Baseline: 511 MCP + 223 host tests pass (8 + 5 profile-dependent skips); three workspace typechecks and scoped lint pass.
  - [x] Candidate: 522 MCP + 228 host tests pass; three workspace typechecks and scoped lint pass, including real PostgreSQL confirmation/rollback and reader cutoff.
  - [x] Upstream reference: `8b5b1f7793e433938de64f068dc2116e6f084ff6`; tarball SHA-256 `b6a13f19f218e5a433581cf395c9fcc4ed4ca1ee07485e67507b37069b75c4cf`.
- [x] **Lot 4 — Delivery**
  - [x] Review diff, push, open English draft PR #979, write the French conductor report.
- [x] **Lot 5 — P0b publication version flexibility**
  - [x] Qualify 0.2.5 and 0.3.0 through one exported version list, keeping 0.2.2 legacy.
  - [x] Parameterize registry/candidate and resolve IMMO's actual dependency graph.
  - [x] Local 0.2.5 candidate: 522 MCP + 234 host tests pass, no skips; three typechecks and lint pass. IMMO pins cluster-mesh 0.22.1; full npm resolution accepts the candidate without ERESOLVE.
  - [x] 0.2.2 baseline: 511 MCP + 229 host tests pass (8 + 5 profile skips); three typechecks and lint pass; explicit down -v completed.
  - [x] Local 0.3.0 fallback: 522 MCP + 234 host tests pass, no skips; typechecks, lint and full graph resolution pass with the existing root override.
  - [x] Update publication steps; registry default selects 0.2.5 (E404 at 18:42 Montreal on 2026-11-01).
  - [x] Remove disposable dependencies; explicit down -v and inspection confirm no remaining project containers, volumes or networks.
- [x] **Lot 6 — Discoverable artifact metadata**
  - [x] Add shared IMMO get/list metadata and publication ordering without changing the upstream contract.
  - [x] Publish additive output schemas and preserve read annotations.
  - [x] Bump the authoring guide revision and document discovery metadata.
  - [x] Cover current-release timestamps, drafts, ordering and pagination with unit and real PostgreSQL tests.
  - [x] 0.2.2 baseline: 515 MCP + 234 host tests pass (8 + 5 profile skips), including the shared PostgreSQL scenario; three typechecks and lint pass.
  - [x] Local 0.2.5 and 0.3.0 candidates each pass 526 MCP + 239 host tests, no skips, including six PostgreSQL scenarios; three typechecks and lint pass.
  - [x] Verify 0.2.2 and both P0b candidates, tear down volumes, push and write the French report.
  - [x] Remove disposable dependencies; explicit down -v and inspection confirm zero resources for all three qualification projects. PR #979 remains draft; French report: `mcp-listget-report.md` in the conductor reviews directory.
- [x] **Lot 7 — Merge main after PR #978**
  - [x] Merge `origin/main` at `4a6c15b2091641c10d89a70fc2a33aeca130bef2`; retain the twelve-tool annotations, P0b operations and list/get discovery fields and ordering.
  - [x] Resolve the guide/provider conflicts and reconcile both profiles' transport and guide assertions; deletion remains destructive, source retrieval read-only and access changes non-destructive.
  - [x] Advance the baseline guide to `2026-11-01-r5` and P0b to `2026-11-01-p0b-r3`, with profile-specific lifecycle availability.
  - [x] 0.2.2 baseline: 518 MCP + 234 host tests pass (8 + 5 profile skips); three workspace typechecks and scoped lint pass.
  - [x] Local 0.2.5 candidate: 529 MCP + 239 host tests pass, no skips, including six PostgreSQL scenarios; three typechecks, lint and npm dependency resolution pass.
  - [x] Qualify an immutable upstream package snapshot at `3be782f4a64ed1def72b0e2cacb803a828f23e05` after the live checkout moved during preparation; its package tree matches the initial `a922c8bb4f07718f36b0e587a7811600a4840ddc` snapshot.
  - [x] Remove disposable dependencies; explicit `down -v` and inspection confirm zero remaining project containers, volumes or networks.
- [x] **Lot 8 — Review #979 authority and expiry races**
  - [x] Reproduce both defects with five failing PostgreSQL regression cases before applying the fixes.
  - [x] Reread source admission after all blob reads and preserve existing typed refusals.
  - [x] Check confirmation expiry with the DB wall clock after the consuming transaction locks its row.
  - [x] 0.2.2 baseline: 518 MCP + 234 host tests pass (8 + 10 profile skips); three workspace typechecks and scoped lint pass.
  - [x] Local 0.2.5 candidate: 529 MCP + 244 host tests pass, no skips, including eleven PostgreSQL cases; three typechecks, lint and dependency resolution pass.
  - [x] Remove disposable dependencies; explicit `down -v` and inspection confirm zero remaining project containers, volumes or networks.
- [x] **Lot 9 — Requalify sentropic PR #878 after its rebase**
  - [x] Archive the immutable upstream package at `708f15d1a6ee40224b2a572be5581bfc6e092130` into this checkout's scratch directory; keep sentropic read-only.
  - [x] Compare with `8b5b1f77`: package/provider version 0.2.5, an authorization fixture, the APP-P1 manifest pin and rebased CI tooling change; API, exports, dispatched tool names and transport-profile validation stay unchanged. No adapter change is needed.
  - [x] Local 0.2.5 candidate: 529 MCP + 244 host tests pass, no skips, including eleven PostgreSQL cases; three typechecks, lint and full dependency resolution pass.
  - [x] Tarball SHA-256: `5dc60bd499d5ba0b0974fca8ecc1ef8a4468bc8712f446a87a8d2c5e5bb0525f`; update the runbook's upstream reference.
  - [x] 0.2.2 baseline: 518 MCP + 234 host tests pass (8 + 10 profile skips); three workspace typechecks and scoped lint pass; dependency pin and lockfile stay unchanged.
  - [x] Remove disposable dependencies; explicit `down -v` and inspection confirm zero remaining project containers, volumes or networks.
- [x] **Lot 10 — Recheck source authority on the MCP transport**
  - [x] Route MCP source retrieval through the shared HTTP facade and use the storage scope in every admission check.
  - [x] Reproduce source leakage over authenticated MCP, then pass four scoped PostgreSQL/blob regressions covering account, activation, membership and authority outage after the final blob read.
  - [x] 0.2.2 baseline: 518 MCP + 234 host tests pass (12 + 10 profile skips); three workspace typechecks and scoped lint pass.
  - [x] 0.2.5 candidate at `708f15d1a6ee40224b2a572be5581bfc6e092130`: 533 MCP + 244 host tests pass, no skips; three typechecks, lint and full dependency resolution pass; tarball SHA-256 unchanged at `5dc60bd499d5ba0b0974fca8ecc1ef8a4468bc8712f446a87a8d2c5e5bb0525f`.
  - [x] Remove disposable dependencies; explicit `down -v` and inspection confirm zero remaining project containers, volumes or networks.
- [x] **Lot 11 — Repair PR #979 CI failures**
  - [x] Reproduce the six failing tests in the three API files using CI's PostGIS/S3 stack without environment-file reads.
  - [x] Use disposable PGDATA on tmpfs after disk sync stalls caused local startup/cleanup failures; keep the CI images and test timeouts unchanged.
  - [x] Make all five 0028 triggers and its confirmation table replayable; hashes are derived from SQL bytes, so no journal or pinned package hash update is needed.
  - [x] Correct the outage fixture's scope and quotas; prove one authority failure, a retryable 503, one ledger entry and no durable success. The existing facade mapping is correct.
  - [x] Full API gate: 3,899 tests pass, 978 existing skips; all eleven tests in the three failing files pass.
  - [x] 0.2.2 verification: 518 MCP + 234 host tests pass (12 + 10 profile skips); three workspace typechecks and scoped lint pass.
  - [x] Remove disposable dependencies; explicit `down -v` and inspection confirm zero remaining containers, volumes or networks for both test projects.
