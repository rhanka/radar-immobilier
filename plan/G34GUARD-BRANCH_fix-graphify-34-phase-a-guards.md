# Feature: Graphify 3.4 Phase A safety guards

## Objective

Correct the measured Phase A destructive-write defects before any production
application, while retaining the existing dry-run default.

## Scope / Guardrails

- No `--apply`, production S3 operation, credential read, Docker stack, or Kubernetes action.
- Vitest is run directly and only on the focused API test files at the owner's instruction.
- The batch must archive every selected `graph/<city>/` prefix before it writes any canonical snapshot.
- Instrument values already present are authoritative; no canonicalization is performed in this pass.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `api/src/services/graph/graphify-34-enrichment.ts`
  - `api/src/services/graph/graphify-34-enrichment.test.ts`
  - `api/src/services/graph/graphify-34-snapshot.ts`
  - `api/src/services/graph/graphify-34-snapshot.test.ts`
  - `api/src/services/graph/graph-store.ts`
  - `api/src/services/graph/graph-store.test.ts`
  - `api/src/scripts/graphify-34-enrich.ts`
  - `plan/G34GUARD-BRANCH_fix-graphify-34-phase-a-guards.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `.track/**`
  - `.github/**`
  - `ui/**`
  - `api/src/services/graph/vivier-v2.ts`
  - `packages/immo-mcp/src/raw-data.ts`

## Orchestration Mode (AI-selected)

- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: the three guards change one sequential enrichment command and its narrow unit tests.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Created `fix/graphify-34-phase-a-guards` from `origin/main` in the existing worktree.
  - [x] Read the project rules, workflow, test rules, and Phase A writer/configuration.
  - [x] Confirmed that no S3 or production operation will be run.

- [x] **Lot 1 — Preserve existing business values**
  - [x] Guard `instrument` on absence only and remove the `effet_densifiant` placeholder write.
  - [x] Reject an informative business value degraded to `autre` or an empty string.
  - [x] Add focused regression tests and prove their pre-fix failure.

- [x] **Lot 2 — Archive before apply**
  - [x] Archive selected city prefixes and require a completion marker before canonical writes.
  - [x] Wire the archive-before-write sequence into `--apply` without running it.
  - [x] Add a focused failure-path test and prove its pre-fix failure.

- [x] **Lot 3 — Deliver**
  - [x] Run focused Vitest directly, inspect the scope, commit, push, and open the PR.
