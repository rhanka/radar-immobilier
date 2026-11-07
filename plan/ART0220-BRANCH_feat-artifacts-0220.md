# Feature: Artifacts provider 0.2.20 pin and git/live provider qualification

## Objective
Pin `@sentropic/artifacts@0.2.20` (git tools at the package root, `./live-host` subpath) and qualify it as the provider of the git-backed artifact mode prepared by #1030: route the git and live tools on 0.2.20, replace the local mirrors by static package imports, port the package migration `0012_git_attach_intents`, and close the #1030 review minors. Flag OFF stays zero-change.

## Scope / Guardrails
- Scope limited to the provider pin, provider qualification lists, the git-mode provider seams, migration 0040 and its provenance, the operator doc and the #1030 r2 review minors.
- No flag change in any deployment (`IMMO_ARTIFACTS_GIT_MODE` stays unset everywhere).
- Make-only workflow, no direct Docker commands; `down -v` after every stack.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in `./tmp/artifacts-0220`.
- Automated tests run on `ENV=test-0220`, never on `dev`.
- In every `make` command, `ENV=<env>` is the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package.json`, `package-lock.json`, `artifact-build/gb1-qualification.json`
  - `packages/artifacts-host/src/**`
  - `packages/immo-mcp/config/**`, `packages/immo-mcp/src/registry/**`
  - `api/drizzle/0040_artifacts_git_attach_intents.sql`, `api/drizzle/meta/_journal.json`
  - `api/tests/integration/artifacts-provenance.spec.ts`
  - `docs/operator/git-artifact-mode.md`
  - `tools/mcp-p0b.mk`, `tools/mcp-p0b-candidate.sh`
  - `plan/ART0220-BRANCH_feat-artifacts-0220.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `deploy/**`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `.github/**`
  - other `plan/*-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` other than 0040 (none in this branch)
- **Exception process**:
  - Declare exception ID `ART0220-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `attention`: 0.2.20 `live-host` is byte-identical to sentropic `8ce4700e4` (the contract #1030 mirrored). The host-ledger mirrors matched it; the live-edge mirrors did NOT: `LiveControlClaims` carried `generation`, `routeEpoch` and an `op: "fence"` that the provider format refuses (exact claim set), and `LiveAssertionClaims.sourceRevision` was a number (provider: opaque string). With the package types, revocation pushes now carry exactly `op`, `sessionId`, `invitationId`, `epoch` (test verifies them with the provider `verifyLiveControl`).
- `attention`: `handoff.ts` (`createHandoffAcceptance`, `FAIL_CLOSED_HANDOFF_COMMIT`) was the pre-live-host acceptance design, superseded by `live-host-endpoints.ts` + `host-ledger.ts` over the provider `acceptHandoff`; only tests used it. Deleted with `handoff.contract.test-support.ts`; the contract cases run against the package in `build.test.ts`.
- `attention`: review m3: the provider exports no standalone handoff verifier, so the handoff route authenticates first with a probe `acceptHandoff` on a ledger that stops at its first read (performed by the package only after the signature and evidence checks), then decodes the files. The JSON body stays capped at 96 MiB.
- `attention`: review m4: the lockfile change regenerates `artifact-build/gb1-qualification.json` (`lockSha256`); the divergence test enforces it.
- `attention`: the 0.3.0 placeholder is removed from the P0b qualification (A-LIVE §10); 0.2.17 and 0.2.18 stay qualified.
- `attention`: pre-existing, out of scope: `make -f tools/mcp-p0b.mk strict` fails one assertion of `p0c-transport.test.ts` (cas.v2 expects 13 tools, gets 16 since the upload-page tools). Identical on `origin/main` 020bcf475 with 0.2.18 (`ENV=test-0220main`); not caused by the pin. The `immo-artifacts.v2` strict pass does not run after it.
- `attention`: 0.2.20 changes the provider served authoring guide text (git-backed section, inline caps wording); immo serves its own guide (`artifact-authoring-guide.ts`), unchanged. Existing tool definitions are byte-identical (hash test).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (one dependency bump and its qualification)
- Rationale: single provider pin; every piece is gated by the flag (off).

## UAT Management (in orchestration context)
- No UI surface change; UAT not required for this branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: worktree `./tmp/artifacts-0220` from `origin/main` (020bcf475); 0.2.20 diff read against 0.2.18 and `8ce4700e4`.
- [x] **Lot 1 — Provider pin 0.2.20**: `package.json`, lockfile (only `@sentropic/artifacts` entries), GB1 file regenerated; P0b/strict lists, profile configs, P0b Make tooling and candidate script qualified; 0.3.0 removed.
- [x] **Lot 2 — Git/live provider qualification**: `GIT_TOOL_PROVIDER_ROUTING` routes the 9 git/live tools on 0.2.20; static imports from `@sentropic/artifacts` and `@sentropic/artifacts/live-host` replace the local mirrors; contract cases run against the package.
- [x] **Lot 3 — Migration 0040**: package `0012_git_attach_intents` adopted with the lock-timeout prefix and the idempotence rewrite (new `ADD CONSTRAINT` rule), pinned by provenance.
- [x] **Lot 4 — Review minors (1030 r2)**: m1 allowlist / kill switch documented, m2 S3-orphan limitation documented, m3 authenticate before decode, m4 GB1 regeneration.
- [x] **Lot 5 — Gate**: see Verification.

## Verification
- `make -f tools/mcp-p0b.mk registry P0B_VERSION=0.2.20 ENV=test-0220` -> `0.2.20`; `integrity` -> `sha512-5jvu0iia…LOn+g==` (equal to the lockfile).
- `make -f tools/make/git-artifact.mk gb1-rows ENV=test-0220` -> only `lockSha256` changes (19 rows unchanged).
- `make -f tools/mcp-p0b.mk verify ENV=test-0220`: typecheck immo-mcp / artifacts-host / api, eslint: pass; immo-mcp 74 files, 604 tests passed (5 skipped), including `artifact-tool-definitions-hash` (4), `artifact-authoring-guide` (17), `artifact-git-mode` (8); artifacts-host with Postgres 58 files, 456 tests passed (flag-off profile digests unchanged); strict cas.v2: 1 pre-existing failure (see Feedback Loop).
- `make -f tools/mcp-p0b.mk integration SCOPE="src/git-mode … p0b/p0c integration" ENV=test-0220`: 19 files, 135 tests passed; then git-bindings + host-ledger integration: 2 files, 6 tests passed (0040 attach intents, `branchCreated` CHECK, provider `candidateDigest` / `LiveHostError` on the ledger).
- `make -f tools/mcp-p0b.mk test-api SCOPE="provenance, migrate-idempotence, artifacts-migrations, artifacts-startup, live-host-route, control-route-startup, release-files" ENV=test-0220api`: migrations 0000 -> 0040 on Postgres, 7 files, 35 tests passed.
- Every stack torn down (`down -v` trap); no container or volume left for `*0220*`.
