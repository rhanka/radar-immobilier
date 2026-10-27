# Feature: Artifacts 0.2.2 qualification

## Objective
- [x] Upgrade the published artifacts package and qualify its blob-prefix contract.

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
- [x] Review qualification blocked: the foreign Docker campaign holds the machine lock; owner: conductor to coordinate release. No foreign resources changed.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; dependency upgrade and behavioral qualification share one checkout.

## UAT Management (in orchestration context)
- [x] No UI change; automated qualification only, no root UAT mutation.

## Plan / Todo (lot-based)
- [x] Lot 0: Read project rules and confirm branch, Make targets and isolation.
- [x] Lot 1: Pin 0.2.2; npm changed only three workspace pins and the provider entry.
- [x] Lot 2: Removed redundant static/runtime guards; test published adapters directly.
- [x] Lot 2: Assert native error projection through `mapHostError` and real S3 refusal.
- [x] Lot 2: Import the memory double through the public ESM publication export.
- [x] Lot 3: Aligned current provider profile, qualification scripts and docs.
- [x] Lot 4: Typecheck/lint passed; API 3566, host 166, MCP 406, artifacts integration 153 passed.
- [x] Lot 4: Add a sequential qualification command with per-check logs and exit codes.
- [x] Lot 4: Typecheck passed; declare the Node URL global required by the tuple check.
- [x] Lot 4: Host/MCP unit suites passed; migrate before API tests that probe a reachable DB.
- [x] Lot 5: Reviewed scope/diff; audited commits; deliver local bundle and uncommitted report.
- [x] Lot 5: Removed owned Docker resources with `down -v`; API has 7 optional skipped tests.
- [x] Lot 5: Peer consensus unverified (live model catalog unavailable); no consensus claimed.
- [x] Review corrections: align the committed A5 runner baseline with 9a723753; keep strict tuple comparison.
- [x] Review corrections: support test-artifacts-022 ports and use the current checkout's Git context.
- [ ] Review corrections: requalify inspect-profile, verify and affected artifact suites through committed Make targets.
- [x] Review corrections: report the blocked preflight, preserve skipped checks and deliver an incremental bundle.
- [ ] Conductor: push, run CI and merge with a merge commit.
