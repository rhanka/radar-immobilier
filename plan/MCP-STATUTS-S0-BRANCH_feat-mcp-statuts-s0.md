# Feature: MCP status tools S0 — frozen contracts

## Objective

Freeze rights, six closed tool input/output schemas, pending semantic choices,
successor compatibility and delegation A as pure, unregistered contracts.

## Scope / Guardrails

- [x] Work only in the conductor-assigned `feat/mcp-statuts-s0` worktree.
- [x] Preserve the twelve live tools and the exposed `search_signals` schema.
- [x] No dependency, migration, real data, environment-file read or Python.
- [x] Make-only container execution, `ENV` last, teardown with volume removal.
- [x] Test project `test-mcp-statuts-s0`; standalone Compose publishes no ports.
- [x] Stop heavy campaigns below 10 GiB free; root dev/UAT remains untouched.
- [x] English code and commits; subjects at most 72 characters, no body/trailer.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/immo-mcp/src/status/**`
  - `plan/MCP-STATUTS-S0-BRANCH_feat-mcp-statuts-s0.md`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - Existing MCP dispatch, definitions, servers, data sources and registry
  - Dependency manifests and lockfiles
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans
- **Conditional Paths (allowed only with explicit exception)**:
  - None; local evidence and runners under ignored `tmp/mcp-statuts-s0/`
  - Uncommitted integration reports at the worktree root
- **Exception process**:
  - Record rationale, impact and rollback here before extending scope.

## Feedback Loop

- [x] S0-EX1: owner assigns `.worktrees/mcp-statuts-s0` instead of `tmp/`;
  impact limited to this existing checkout; rollback removes only test stacks.
- [x] Integration corrects missing closed schemas, weak delegation checks,
  batch-context validation and unresolved correspondence replacement.
- [x] Peer consensus unavailable: packet lacks exact author model metadata;
  local review plus executable and mutation evidence is recorded separately.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** — test and integrate the supplied uncommitted S0 work.
- [ ] **Multi-branch**
- Rationale: pure contracts only; no runtime activation or branch transfer.

## UAT Management (in orchestration context)

- [x] No user-facing change; no UAT needed. Root `ENV=dev` stays untouched.

## Plan / Todo (lot-based)

- [ ] **S0a — Context/profile**
  - [x] Freeze wire primitives and ordered D4/public-opening authority contract.
  - [x] Freeze personal/common rights and independent capabilities.
  - [x] Cover rights and moderation refusals.
  - [x] Freeze Steve vocabulary and pending-choice availability metadata.
  - [x] Cover vocabulary and pending-choice metadata.
- [ ] **S0b — Read schemas**
  - [x] Freeze closed read input/output schemas and continuation context.
  - [x] Freeze read validation and diagnostic confidentiality.
  - [x] Cover qualified reads, effective hiding, pagination and fingerprints.
- [ ] **S0c — Command schemas**
  - [x] Freeze signal/lot DTOs, explicit versions, heads and atomic envelopes.
  - [x] Freeze command-key and batch-shape validation.
  - [x] Freeze semantic refusals against qualified progression evidence.
  - [ ] Catalog all six inert contracts and cover command regressions.
  - [ ] Cover command schema refusals and historical receipt outputs.
- [ ] **S0d — Successor compatibility**
  - [ ] Freeze versioned manifest and named successor search migration.
  - [ ] Cover successor schema compatibility and unchanged live definitions.
  - [ ] Freeze verified issuer/receiver delegation A policy.
  - [ ] Cover forged, broadened and generic-scope delegation refusals.
- [ ] **Lot N — Validate and deliver**
  - [ ] Package unit suite, existing and new tests, passes.
  - [ ] Rights, pending-choice and delegation mutations on copies are killed.
  - [ ] Package and API typecheck, lint and build pass.
  - [ ] Twelve exposed tools and protected composition match the base.
  - [ ] Atomic commits obey line, subject and message constraints.
