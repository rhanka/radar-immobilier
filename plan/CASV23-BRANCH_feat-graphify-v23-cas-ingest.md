# Feature: Graphify v2.3 CAS ingestion

## Objective
Ingest the immutable 139-document CAS batch for 40 municipalities, merge fresh semantic extraction with each production baseline, and prove publish readiness through a read-only dry-run.

## Scope / Guardrails
- Scope is limited to `tools/graphify-v23/**` and this branch plan.
- Worktree: `tmp/graphify-cas`; branch: `feat/graphify-v23-cas-ingest`.
- No production graph upload, projection, Kubernetes action, or PostgreSQL write.
- LLM extraction and description calls must stop before call 501.
- Credentials remain process-local and never enter files, logs, commits, or output.
- Automated checks use `ENV=test-graphify-cas`, never `ENV=dev`.
- All new repository text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `tools/graphify-v23/**`
  - `plan/CASV23-BRANCH_feat-graphify-v23-cas-ingest.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths**:
  - `.github/workflows/**`
  - `api/drizzle/*.sql`
  - `../poc-k8s/**`
- **Exception process**:
  - Declare the exception below before touching a conditional or forbidden path.

## Feedback Loop
- `CASV23-EX1` — The owner-mandated Graphify runner and its targeted Shell/Node checks have no Make targets, while modifying `Makefile` is forbidden. Impact: these commands run directly in the isolated worktree. Rollback: remove the branch worktree; production state is unchanged.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + review peers**
- [ ] **Multi-branch**
- Rationale: the scripts form one coupled ingestion pipeline; independent peers review the completed diff without writing it.

## UAT Management
- [x] No UI surface or UAT stack is involved.
- [x] The root checkout and fixed `ENV=dev` services remain untouched.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read the mandatory rules, dry-run 1 report, runner, and owner brief.
  - [x] Create the isolated repository-local worktree from `origin/main`.
  - [x] Freeze scope, safety constraints, and test environment.
- [ ] **Lot 1 — Immutable CAS batch**
  - [x] Build and validate the exact CAS manifest.
  - [x] Download selected representations and verify every SHA-256.
- [ ] **Lot 2 — Semantic extraction and baseline merge**
  - [x] Count and cap structured semantic extraction attempts.
  - [x] Convert grounded findings and merge with the v2.3 baseline extraction.
  - [x] Resolve the two ungrounded baseline nodes by declared exclusion.
- [ ] **Lot 3 — Runner and gates**
  - [x] Carry the immutable contract through runner, worker, gate, and metrics.
  - [ ] Keep dry-run preflight and gate strictly read-only.
- [ ] **Lot 4 — Qualification and delivery**
  - [ ] Run targeted static checks and the complete 40-city dry-run.
  - [ ] Record per-city results, exact calls, duration, errors, and verdict.
  - [ ] Complete consensus review, push the branch, open the PR, and verify CI.
