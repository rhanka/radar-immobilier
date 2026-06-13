# Fix: Graph import normalization

## Objective
Normalize manual graphify fan-out graph shapes during graph import so SCW
`graph/{city}/latest.json` snapshots can be projected without losing edge
endpoints or free-form metadata.

## Scope / Guardrails
- Make-only workflow.
- Worktree: `./tmp/graph-import-normalize`.
- Test environment: `ENV=test-graph-import-normalize`.
- Root checkout remains untouched.

## Branch Scope Boundaries
- **Allowed Paths**:
  - `api/src/services/graph/graph-store.ts`
  - `api/src/services/graph/graph-store.test.ts`
  - `plan/GRAPHIMPORT-BRANCH_fix-graph-import-normalize.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `rules/**`,
  `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, other `plan/*-BRANCH_*.md`.
- **Conditional Paths**: none.

## Orchestration Mode
- [x] Mono-branch + single final test cycle.

## Plan / Todo
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Confirm isolated repository-local worktree.
  - [x] Confirm Makefile targets for graph-store tests.
- [ ] **Lot 1 — Normalize manual graphify imports**
  - [x] Accept `from`/`to` edge endpoints as `source`/`target`.
  - [x] Preserve node and edge `properties` in DB props.
  - [x] Import both `links` and `edges` when both are present.
  - [x] Lot gate: targeted API test.
  - [x] Lot gate: typecheck, lint, build.
- [ ] **Lot 2 — PR handoff**
  - [x] Commit branch changes.
  - [ ] Push branch.
  - [ ] Open PR.
