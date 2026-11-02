# Feature: Artifact parity P0-C

## Objective
- [ ] Prepare two independently configured artifact switchovers and qualified part1 without changing the default P0b deployment.

## Scope / Guardrails
- [x] Follow converged-r2 §2.5, §2.6 and acceptance rows P0-A/P0-C/P0-D.
- [x] Make-only, container execution, no Python, environment-file reads, cluster actions, deployment or merge.
- [x] Use the owner-provided `.worktrees/mcp-p0c`, branch `feat/mcp-artifacts-p0c` (MCPP0C-EX1).
- [x] Tests use `test-mcp-p0c`, no published ports; teardown always removes test volumes.
- [x] English repository text; owner-requested external report in French.
- [x] Selective staging and atomic commits without trailers through the standalone make runner.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: `packages/artifacts-host/**`, `packages/immo-mcp/**`, `api/src/artifacts/**`, `api/tests/**`, `api/drizzle/**`, `tools/mcp-p0*`, `docs/runbooks/mcp-artifacts-p0*`, `package.json`, `package-lock.json`, this plan.
- [x] Forbidden: root `Makefile`, root compose files, `rules/**`, agent bootstrap files, other branch plans, immutable client inputs.
- [x] Conditional: migration journal and one new additive schema migration; explicit policy activation is separate from schema migration.

## Feedback Loop
- [x] MCPP0C-EX1: owner explicitly selected the existing worktree; do not relocate it or disturb root UAT.
- [x] MCPP0C-EX2: owner requires no commit trailers, overriding the repository co-author convention; standalone commit target already supports this.
- [x] MCPP0C-EX3: historic receipt codecs and both projections are contract requirements, overriding the generic no-legacy-fallback rule for these codecs.
- [x] Source pointers corrected: control route is `api/src/artifacts/control-route.ts`; successor contract is `packages/immo-mcp/src/status/successor-contract.ts`.

## Orchestration Mode (AI-selected)
- [x] One branch, two deployment lots, all execution in this session; no delegation or background workflow.

## UAT Management (in orchestration context)
- [ ] Conductor qualifies real Claude conversations after deployment, including conflict reconciliation and unknown outcome with the same key.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read project rules, current bindings and converged contract.
  - [x] Confirm clean branch and test-only runner without ports or environment files.
  - [x] Verify published 0.2.6 integrity before consuming it (exact owner-provided SHA-512 matches npm).
- [ ] **Lot A — Strict inputs and authority, envelope 1**
  - [ ] Pin artifacts 0.2.6 and mcp-platform 0.4.1 centrally; regenerate lock through make.
  - [ ] Add trusted profile selection, strict guide/catalogue and startup coherence checks.
  - [ ] Add replayable locked policy activation and complete writer inventory.
  - [ ] Preserve old receipts and refuse new omissions after authorization without quota.
  - [ ] Verify unit/integration, old and waiting writers, crossing-switch retry, HTTP/MCP omission and first null publication.
- [ ] **Lot B — Results and qualified part1**
  - [ ] Freeze projection per binding/request; migrate consumers, errors and guide placement.
  - [ ] Expose versions/revert only for the v2 profile, with operation-specific annotations.
  - [ ] Run strict P0-A lifecycle, conflict, edits, metadata, revert and retry proofs.
- [ ] **Delivery and qualification**
  - [ ] Add one operator command per switchover and explicit Claude qualification gates.
  - [ ] Run verify, integration, full API Quality gates integration suite; always down -v.
  - [ ] Review final changes in this session, push and open one PR in English.
  - [ ] Write the conductor report with exact activation sequence and remaining gaps.
  - [ ] Observe CI; do not deploy or merge.
