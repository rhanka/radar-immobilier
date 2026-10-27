# Chore: Dependency security hotfix 3

## Objective
- [ ] Resolve the fast-uri, ip-address, KaTeX and Zod alerts in one local branch.
- [ ] Deliver raw before/after audits, CI-equivalent gates and a verified bundle.

## Scope / Guardrails
- [x] Make-only, Docker-only execution; no Python or environment-file reads.
- [x] Base: `17f439c8d8e75303177ba8972a4fd7d8a8cbdc35`.
- [x] Worktree: `tmp/sec-hotfix-3`; fallback: its local `tmp/hotfix3-repo`.
- [x] ENV: `test-sec-hotfix-3`; ports: API 18936, UI 15936, Maildev 11936.
- [x] Publish no ports; use synthetic test credentials and isolated volumes.
- [x] Wait for other test stacks; clean only this project with `down -v --remove-orphans`.
- [x] Atomic commits: at most 150 lines excluding lockfiles; selective staging.
- [x] No push, merge, deployment or root-checkout changes.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: root/workspace manifests and `package-lock.json`.
- [x] Allowed Paths: Zod compatibility changes in `api/src/**`, `api/tests/**`, `packages/**`.
- [x] Allowed Paths: `.security/**`, `tools/security/**`, `tools/zod4-*`.
- [x] Allowed Paths: this plan and `RAPPORT-SOL-HOTFIX3.md`.
- [x] Forbidden Paths: `Makefile`, `docker-compose*.yml`, `rules/**`, agent entrypoints, other branch plans.
- [x] Conditional Paths: `api/Dockerfile` only if dependency bundling proves incompatible.
- [x] Record rationale, impact and rollback before any conditional-path edit.

## Feedback Loop
- [x] L2n: preserve MCP scalar diagnostics, integer bounds and historical GUIDs.
- [x] L2m: use native Zod 4 JSON Schema on the current stateful MCP composition.
- [x] L2l: align graph mocks and integration imports with Engram.
- [x] L2k: replace the graph client imports with the published Engram entrypoint.
- [x] L2j: preserve source-parser and upstream validation diagnostics.
- [x] L2i: preserve GUID inputs on scoped workspace and signal routes.
- [x] L2h: preserve validation details on administrative HTTP routes.
- [x] L2g: preserve prospect HTTP validation and bound raw batch diagnostics.
- [x] L2f: reuse guarded special-key and enum-record regression coverage.
- [x] L2e: reuse domain default and partial-record regression coverage.
- [x] L2d: retain historical GUID acceptance in prospect domain schemas.
- [x] L2c: migrate domain records, defaults and ontology identifiers.
- [x] L2b: preserve validation codes and metadata through public Zod schema APIs.
- [x] L2a: reuse the project validation DTO and error-tree contract from the prepared migration.
- [x] DEPSSEC3-EX1: owner requires single-line commits without trailers; use the local Make runner.
- [x] DEPSSEC3-EX2: owner requires a French delivery report; code and other documentation remain English.
- [x] Shared Git metadata is read-only; use the explicitly authorized local fallback and bundle.
- [ ] Record published dependency blockers with exact versions and peer/dependency ranges.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one integrated qualification campaign.
- [x] Reuse only the relevant Zod migration changes; preserve newer main work.

## UAT Management (in orchestration context)
- [x] No UAT requested; automated gates run in isolated test containers.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read project, workflow, security, testing and harness instructions.
  - [x] Confirm branch/base and clean initial state.
  - [x] Prepare an environment-free Make/Compose runner and local Git fallback.
  - [ ] Capture production-only and complete raw baseline audits in containers.
- [ ] **Lot 1 — Minimal patch updates**
  - [ ] Update fast-uri and ip-address within their existing declared ranges.
  - [ ] Update the existing KaTeX override to the first patched release.
  - [ ] Verify the generated lockfile diff and installed dependency tree.
- [ ] **Lot 2 — Zod remediation**
  - [ ] Check published Sentropic compatibility and reuse the prepared migration.
  - [ ] Preserve API/domain/MCP validation and discovery contracts.
  - [ ] Remove obsolete security exceptions only after raw findings disappear.
- [ ] **Lot 3 — Qualification**
  - [ ] Production-only and full after audits; security gate and its tests.
  - [ ] All-workspace typecheck and lint.
  - [ ] API/UI build and browser bundle smoke.
  - [ ] Complete CI test command: API, UI, MCP and all packages.
  - [ ] Independent review and reconciliation.
- [ ] **Lot 4 — Local delivery**
  - [ ] Audit atomic commit sizes and single-line messages.
  - [ ] Verify the base-to-head bundle in a fresh repository.
  - [ ] Write the final French report with command results, SHA and bundle hash.
  - [ ] Remove only this campaign's containers and volumes.
