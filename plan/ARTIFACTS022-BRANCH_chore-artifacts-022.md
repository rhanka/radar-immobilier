# Feature: Artifacts 0.2.2 qualification

## Objective
- [ ] Upgrade the published artifacts package and qualify its blob-prefix contract.

## Scope / Guardrails
- [x] Work in `tmp/artifacts-022`, branch `chore/artifacts-0.2.2`.
- [x] Make-only container execution; no environment files or secrets read.
- [x] Use `ENV=test-artifacts-022`; always remove this stack and its volumes.
- [x] Reserve API `18929`, UI `15929`, Maildev `11929`; publish no ports.
- [x] Keep commits within 150 changed lines; no body or attribution trailer.
- [x] Do not push; the conductor owns publication and CI.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `api/package.json`, `package-lock.json`.
- [x] Allowed Paths: `packages/artifacts-host/package.json`, `packages/immo-mcp/package.json`.
- [x] Allowed Paths: `api/tests/*artifacts*`, `api/tests/integration/artifacts-listkeys.spec.ts`.
- [x] Allowed Paths: `packages/artifacts-host/src/host-outcome*`.
- [x] Allowed Paths: `packages/artifacts-host/src/s3-timeout.spec.ts` (remove prefix wrapper).
- [x] Allowed Paths: `packages/immo-mcp/config/immo-artifacts.v1.json`.
- [x] Allowed Paths: `packages/immo-mcp/src/registry/*profile*`, `packages/immo-mcp/src/registry/*integrity*`, `packages/immo-mcp/src/registry/validation-regressions.test.ts`.
- [x] Allowed Paths: `tools/make/artefacts-a5-*`, `docs/operator/artefacts-mcp.md`, this plan.
- [x] Forbidden Paths: `Makefile`, `docker-compose*.yml`, `rules/**`, agent bootstrap files, other branch plans.
- [x] Conditional Paths: none required.

## Feedback Loop
- [x] User execution instructions override older commit-trailer guidance.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; dependency upgrade and behavioral qualification share one checkout.

## UAT Management (in orchestration context)
- [x] No UI change; automated qualification only, no root UAT mutation.

## Plan / Todo (lot-based)
- [x] Lot 0: Read project rules and confirm branch, Make targets and isolation.
- [x] Lot 1: Pin 0.2.2; npm changed only three workspace pins and the provider entry.
- [x] Lot 2: Removed redundant static/runtime guards; test published adapters directly.
- [x] Lot 2: Assert native error projection through `mapHostError` and real S3 refusal.
- [x] Lot 2: Locate the unexported memory double via the exported migration path (Vitest lacks `import.meta.resolve`).
- [x] Lot 3: Aligned current provider profile, qualification scripts and docs.
- [ ] Lot 4: Pass typecheck, lint, unit tests and Docker artifacts integration.
- [x] Lot 4: Add a sequential qualification command with per-check logs and exit codes.
- [ ] Lot 5: Review changes, audit commits and deliver the uncommitted report.
- [ ] Conductor: push, run CI and merge with a merge commit.
