# Feature: MCP artifact lifecycle P0 and tool annotations

## Objective
Qualify the published artifact lifecycle transport, expose supported operations
with existing authorization and quotas, and annotate every active MCP tool.

## Scope / Guardrails
- Work only in the owner-specified `feat/mcp-artifacts-lifecycle-p0` worktree.
- Run every step directly in this session; no workflow or background agents.
- Make only, no Python, no environment-file reads, no cluster operations.
- Never touch kube config or the root checkout and its stable dev environment.
- Use `ENV=test-mcp-lifecycle` last and tear down the isolated stack with `down -v`.
- The standalone Make runner exposes no host ports and uses synthetic settings.
- Keep commits atomic, selectively staged and free of trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/immo-mcp/src/registry/**`
  - `packages/immo-mcp/src/artifacts-composition.test.ts`
  - `packages/immo-mcp/src/tool-definitions.ts`
  - `packages/immo-mcp/src/tools.ts`
  - `plan/MCPLIFECYCLE-BRANCH_feat-mcp-artifacts-lifecycle-p0.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
  - Other branch plans, deployment files, migrations and environment files
- **Conditional Paths**:
  - Dependency pins and lockfile only if a compatible lifecycle release exists.

## Feedback Loop
- [x] MCPLIFECYCLE-EX1: use the existing owner-specified `.worktrees/` checkout; impact limited to this branch, rollback removes this branch's changes.
- [x] MCPLIFECYCLE-EX2: owner requires no trailers; use a standalone Make commit target instead of the attribution recipe, rollback uses normal repository commit defaults.
- [x] Blocked: artifacts 0.2.2 declares all seven lifecycle names, but `assertArtifactsTransportProfile` and the executor support only ensure/publish/list/get. Published 0.2.3, latest 0.2.4 and sentropic origin/main have the same restriction. Owner authorized stopping and reporting when no compatible bump exists.
- [x] Handoff: sentropic artifacts maintainers must qualify get_source/delete/restore/set_access/fork/promote/renew in the MCP executor and HTTP app with commit authorization and quota participation. Acceptance requires real transport calls, cross-owner refusal and atomic accounting; then Immo can select the seven tools with explicit read/write scopes.

## Orchestration Mode (AI-selected)
- [x] Single branch; all inspection, implementation, verification and delivery performed directly in this session.

## UAT Management
- [x] No UI changes; keep root UAT unchanged.
- [ ] Owner/conductor checks the refreshed Claude connector after deployment; client consent behavior cannot be proved by server metadata tests.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and dependency qualification**
  - [x] Read repository rules and investigation; confirm clean requested branch.
  - [x] Inspect published tarballs 0.2.2/0.2.3/0.2.4 and sentropic origin/main.
  - [x] Identify the transport guard, missing dispatch and bounded upstream handoff.
- [ ] **Lot 1 — Active-tool annotations**
  - [ ] Annotate twelve Immo reads and artifact list/get in both active projections.
  - [ ] Mark ensure/publish as non-destructive idempotent writes.
  - [ ] Keep SDK contract registrations consistent with the active projection.
  - [ ] Verify tools/list is identical across sessions, scopes and ensure calls.
- [ ] **Lot 2 — Authoring guide**
  - [ ] Bump the guide revision and explain publication on the same artifactId.
  - [ ] Describe source/edit/delete/restore/sharing availability accurately.
- [ ] **Lot 3 — Verification and delivery**
  - [ ] Reproduce the seven blocked capabilities against published transports.
  - [ ] Run registry and HTTP tests, MCP typecheck and scoped lint.
  - [ ] Remove the isolated compose stack and volumes with down -v.
  - [ ] Push the branch, open an English PR and write the French conductor report.
