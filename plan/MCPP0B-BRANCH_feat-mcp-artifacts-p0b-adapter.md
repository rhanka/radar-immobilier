# Feature: Prepare the IMMO artifacts P0b adapter

## Objective
Prepare the three qualified P0b operations (0.2.5 or 0.3.0) while preserving the current non-CAS, root-result contract. Publication must require only the central version pin and regenerated lockfile.

## Scope / Guardrails
- Work only in the owner-assigned `.worktrees/mcp-p0b` checkout.
- Make-only execution; no Python, environment-file reads, cluster actions, workflow tools or delegated agents.
- Dedicated `ENV=test-mcp-p0b`; standalone compose has no published ports; teardown uses `down -v`.
- English implementation, commits and draft PR; French conductor report outside the checkout.
- No commit trailers; no merge or deployment.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/immo-mcp/**`, `packages/artifacts-host/**`
  - `api/src/artifacts/control-route*`, `api/tests/*p0b*`
  - `api/drizzle/0028_artifacts_p0b.sql`, `api/drizzle/meta/_journal.json`
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
- [ ] **Lot 6 — Discoverable artifact metadata**
  - [x] Add shared IMMO get/list metadata and publication ordering without changing the upstream contract.
  - [x] Publish additive output schemas and preserve read annotations.
  - [x] Bump the authoring guide revision and document discovery metadata.
  - [x] Cover current-release timestamps, drafts, ordering and pagination with unit and real PostgreSQL tests.
  - [x] 0.2.2 baseline: 515 MCP + 234 host tests pass (8 + 5 profile skips), including the shared PostgreSQL scenario; three typechecks and lint pass.
  - [ ] Verify 0.2.2 and both P0b candidates, tear down volumes, push and write the French report.
