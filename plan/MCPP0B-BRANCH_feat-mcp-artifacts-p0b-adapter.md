# Feature: Prepare the IMMO artifacts P0b adapter

## Objective
Prepare the three qualified 0.3.0 operations while preserving the current non-CAS, root-result contract. Publication must require only the central version pin and regenerated lockfile.

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
  - `tools/mcp-p0b.mk`, `docs/runbooks/mcp-artifacts-p0b.md`
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
- [ ] **Lot 1 — Version boundary and profile**
  - [x] Centralize the pin at 0.2.2; enable P0b automatically with 0.3.0.
  - [x] Extend discovery, scopes, annotations and profile metadata.
- [ ] **Lot 2 — Trusted host wiring**
  - [ ] Source ports, approved IdP subjects, transactional deletion confirmation and migration.
  - [ ] Trusted cookie-session confirmation page; mutation accounting and quota classification.
- [ ] **Lot 3 — Guide and qualification**
  - [ ] Document edit, delete and named-share journeys and publication commands.
  - [ ] Verify 0.2.2 baseline and locally packed 0.3.0 candidate; typecheck and lint.
- [ ] **Lot 4 — Delivery**
  - [ ] Review diff, push, open English draft PR, write French report.
