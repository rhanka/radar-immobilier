# H4 P2 — Shared artifact command adapter (preparation, unexposed)

**Type**: feature · **Base**: integrated `origin/main` at `0bea67c6` (H3 second PR and H4 P0) · **Branch**: `feat/861c-h4-p2-artifact-adapter`
**Workspace**: `/home/antoinefa/src/radar-immobilier/.worktrees/861c-h4-p2`
**Reference design**: `/home/antoinefa/src/radar-immobilier/.lanes/conductor/tmp/861c/conception-h4-v3.md` (section P2 only, preparation part)

## Objective

Implement only the preparation part of P2: `packages/artifacts-host/src/mcp-app-adapter.ts` translating the four
selected provider operations to the same facade as HTTP. The adapter stays unexposed: no registered MCP tool, no
transport wiring. Real-provider acceptance stays pending upstream delivery.

Selected mappings (exact method/path only, no generic proxy):

| MCP tool | Provider request | Shared command |
|---|---|---|
| `artifacts_ensure` | `POST /ensure` | `ensure` |
| `artifacts_publish` | `POST /publish` | `publish` |
| `artifacts_list` | `POST /list` | `list` |
| `artifacts_get` | `GET /meta/{artifactId}` | `meta` with `{artifactId}` |

## Scope / Guardrails

- English code, tests and identifiers; French report only; no Python; never read `.env`.
- No added dependency; reuse `@sentropic/artifacts` contracts, `facade.ts`, `publish-policy.ts`, `idempotency.ts`.
- Preserve composition, admission, exports, HTTP routes, MCP transports and deployment; facade exception below.
- Adapter receives the actor from verified request authority, never from arguments.
- Trusted storage scope stays server-bound; caller scope, actor, hashes and provenance are never authoritative.
- Shared server derivation for internal keys and effective parameter hashes; array order stays significant.
- Publication limits, defaults, fixed `inline-original` provenance and URL policy preserved via the facade.
- Requested `profile` stays distinct from granted permissions; no grant is issued here.
- Unsupported methods/paths refused before dispatch; closed MCP argument objects.
- H3 admission binding reused through the facade; provider finalization authorization stays `BLOCKED`/`unverified`
  pending the upstream mechanism (same state as H3 P2 unit 7).
- Private typed outcome consumed via the facade sanitized response; no internal cause serialized.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `plan/861C-BRANCH_feat-861c-h4-p2-artifact-adapter.md`
  - `packages/artifacts-host/src/mcp-app-adapter.ts`
  - `packages/artifacts-host/src/mcp-app-adapter.test.ts`
  - `RAPPORT-MUSE-H4-P2.md` (uncommitted deliverable)
  - `RAPPORT-SOL-H4-P2.md`, `tmp/861c-h4-p2/**` (uncommitted delivery/proofs only)
- **Forbidden Paths (must not change in this branch)**:
  - `packages/artifacts-host/src/facade.ts`, `composition.ts`, `admission.ts`, `index.ts`, other host sources
  - `api/src/artifacts/**`, MCP server/host/transport, `packages/immo-mcp/**`
  - `package.json`, `package-lock.json`, manifests, lockfiles, `tools/artifact-host.mk`, root `Makefile`
  - `deploy/**`, `rules/**`, other `plan/*-BRANCH_*.md`, `.env*`
- **Conditional Paths (allowed only with an explicit exception recorded here)**:
  - `packages/artifacts-host/src/facade.ts`, `commit-authorization.test.ts` (861C-EX1).
  - `api/tests/integration/artifacts-mcp-adapter.spec.ts` (861C-EX2).
- **Exception process**:
  - Declare rationale, impact and rollback before any expansion; keep the adapter unexposed.

## Feedback Loop

- [x] 861C-EX1: owner-requested Astra H3 review point 1. Account for an admission recheck exception
  after provider success with one ledger entry and a sanitized, receipt-free response. Impact: facade
  failure handling and focused regression tests only. Rollback: revert these hunks; no storage migration.
- [x] 861C-EX2: qualify the adapter through the existing real provider composition and HTTP route.
  Impact: isolated integration test only, no runtime wiring. Rollback: remove that test file.
- [x] Git metadata outside this workspace is read-only. Local metadata at `tmp/861c-h4-p2/git` preserves
  ancestry and holds the integrated branch; deliver a bundle, never push or mutate the root checkout.
- [x] Integrated main by fast-forward; `.track` is byte-identical, with no divergent events to reconcile.

## Orchestration Mode

- [x] Single branch, sequential source changes; independent isolated verification projects.
- [x] Use the owner-provided worktree; keep root Git metadata and UAT untouched, no push.

## UAT Management

- [x] No UI or transport exposure; browser UAT is outside this preparation step.

## Plan / Todo (lot-based)

- [x] Mock minimal calls, bidirectional replay, effective hashing and ordered file conflicts.
- [x] Mock caller-key preservation and boundaries, authority and unsupported-route refusals.
- [x] Adapter types, exact routing and MCP result mapping helpers.
- [x] Closed validation and sanitized facade delegation.
- [x] Authority and effective-input checks (caller key, binding, profile, pagination, forged fields).
- [x] Provider-contract seams documented as preparation (`BLOCKED` finalization, typed outcome via facade).
- [x] Post-success admission outage: sanitized response, no receipt, exactly one ledger entry.
- [x] Real-provider parity, conflict, private metadata, pagination and pre-dispatch admission evidence.
- [x] Added composed-provider tests with shared PostgreSQL/S3 and the existing HTTP control route.
- [x] Corrected the composed fixture name to satisfy S3 bucket naming; retained the initial failure log.
- [x] Aligned list assertions and mocks with the selected provider's `{ total, artifacts }` response.
- [x] Four copied-source mutation failures, restored and checked with `cmp`.
- [x] Parity cases with preparation mocks: minimal profile, HTTP↔MCP replay, changed-content conflict
      including file order, key boundaries, forged refusals, foreign metadata/pagination, suspension/expiry.
- [x] Muse report available; SOL report retains commands, proof paths and qualification boundaries.

## Verification

```sh
rtk make -f tools/artifact-host.mk typecheck API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p2
rtk make -f tools/artifact-host.mk lint API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p2
rtk make -f tools/artifact-host.mk test-host SCOPE=src/artifacts API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p2
rtk make -f tools/artifact-host.mk test-api SCOPE="tests/integration/artifacts --no-file-parallelism" API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p2
```

All stacks publish no host ports. Final isolated runs use the local diagnostic wrapper and synthetic
Compose override in `tmp/861c-h4-p2/`: npm dependencies in memory, no unnecessary Poppler install,
Postgres health checked over TCP after its temporary initialization server. No test timeout is raised.
The tracked runner and Compose files are unchanged. Every run tears down with `down -v --remove-orphans`.

- [x] Typecheck each exact commit archive (all workspaces, zero errors, seven unchanged CSS warnings).
- [x] Lint; 153 artifacts-host tests; 67 scoped API tests; 2,616 API tests passed / 8 skipped.
- [x] Five composed P2 cases passed before mutation; all four mutations fail behaviorally and restore cleanly.
- [x] Full-suite outcomes and infrastructure limits retained separately in the uncommitted SOL report.

## Not covered (later work)

Provider finalization authorization remains BLOCKED: current post-settle refusal can hide an already
persisted publication. Existing H3 tests pin this residue; no compensation or prevention is claimed.
The upstream typed-outcome contract, effective candidate profile, MCP codec, cross-process restart,
tuple publication, image qualification, operator bindings and P7 exposure remain unverified/not covered.
