# Feature: General artifact admission, host and MCP

## Objective
Qualify L1/L2 general admission for approved accounts while preserving actor
isolation, current authorization, transactional quotas and replay safety.

## Scope / Guardrails
- Integrate main at `17f439c8` before qualification; artifacts version 0.2.2.
- Worktree: `tmp/artefacts-ouv-l12`; root UAT remains untouched.
- Make-only execution; never read environment files; no Python or push.
- Test ENV `test-artefacts-ouv-l12`; API/UI/Maildev ports 18937/15937/11937.
- Wait for other test stacks; clean only this project with volume/orphan removal.
- Preserve Muse's implementation; correct failures without weakening ACLs.
- Commits contain at most 150 changed lines and an English subject only.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts-host/src/**`
  - `packages/immo-mcp/src/**`
  - `api/tests/integration/artifacts-ouverture*`
  - `api/drizzle/0025_artifacts_actor_quotas.sql`
  - `api/drizzle/meta/_journal.json`
  - `plan/OUVL12-BRANCH_feat-artefacts-ouverture-l12.md`
  - `RAPPORT-SOL-OUV-L12.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans, reader/content implementation, `api/src/index.ts`
- **Conditional Paths (allowed only with explicit exception)**:
  - Existing API tests directly blocked by the new migration/quotas.
  - Additional test runner files under `tools/`.
- **Exception process**:
  - Record rationale, impact and rollback here before conditional changes.

## Feedback Loop
- [x] Shared Git metadata is read-only: use local Git metadata and audit a bundle
  against the original base in a fresh repository; do not push.
- [x] Owner instruction overrides commit trailers and report language.

## Orchestration Mode (AI-selected)
- [x] Single branch integration; no cherry-pick.

## UAT Management (in orchestration context)
- [x] No UAT or deployment in L1/L2 qualification.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules, Muse report, design and prime review.
  - [x] Merge main 0.2.2 in the local recovery repository.
- [ ] **Lot 1 — Host general admission**
  - [ ] Activation, membership-independent admission and workspace decoupling.
  - [ ] Transactional global, actor and shared minute quotas with migration.
  - [ ] Host unit tests.
- [ ] **Lot 2 — MCP general admission**
  - [ ] Approved accounts bypass stale workspace claims for artifact tools.
  - [ ] Four tools, server identities, forged-field refusals and MCP tests.
- [ ] **Lot 3 — Qualification**
  - [ ] Typecheck, ESLint, API unit tests and PostgreSQL admission tests.
  - [ ] Isolation and authorization mutations.
  - [ ] Complete API suite matching CI.
  - [x] Implemented: `feat(host): add general activation mode`.
  - [x] Implemented: `feat(host): reserve actor quotas with schema migration`.
  - [x] Implemented: `feat(host): admit general accounts without cohort`.
  - [x] Implemented: `feat(host): decouple workspace and probe actor rate`.
  - [x] Implemented: `feat(mcp): admit approved accounts on artifact tools`.
  - [x] Implemented: `feat(mcp): reject forged artifact caller identities`.
  - [x] Implemented: `test(host): cover general activation parsing`.
  - [x] Implemented: `test(host): cover general admission`.
  - [x] Implemented: `test(host): cover general facade and rate probe`.
- [ ] **Lot 4 — Delivery**
  - [ ] Atomic commits, bundle audit and French results report.
  - [ ] Confirm own Docker project has no containers, networks or volumes.
