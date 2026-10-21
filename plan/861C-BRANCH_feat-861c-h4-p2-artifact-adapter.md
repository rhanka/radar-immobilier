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

## Deliverables

- [x] Adapter types, exact routing and MCP result mapping helpers.
- [x] Closed validation and sanitized facade delegation.
- [x] Authority and effective-input checks (caller key, binding, profile, pagination, forged fields).
- [x] Provider-contract seams documented as preparation (`BLOCKED` finalization, typed outcome via facade).
- [x] Post-success admission outage: sanitized response, no receipt, exactly one ledger entry.
- [ ] Real-provider parity, conflict, private metadata, pagination and pre-dispatch admission evidence.
- [ ] Four copied-source mutation failures, restored and checked with `cmp`.
- [ ] Parity cases with preparation mocks: minimal profile, HTTP↔MCP replay, changed-content conflict
      including file order, key boundaries, forged refusals, foreign metadata/pagination, suspension/expiry.
- [ ] Report `RAPPORT-MUSE-H4-P2.md` with tests, commit split, commands, `not covered`/`unverified`/`BLOCKED`.

## Verification (executed by another agent; no shell here)

```sh
rtk make -f tools/artifact-host.mk typecheck API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p2
rtk make -f tools/artifact-host.mk lint API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p2
rtk make -f tools/artifact-host.mk test-host SCOPE=src/artifacts API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p2
rtk make -f tools/artifact-host.mk test-api SCOPE="tests/integration/artifacts --no-file-parallelism" API_PORT=18914 UI_PORT=15914 MAILDEV_UI_PORT=11914 ENV=test-861c-h4-p2
```

Ports are reserved planning values. Teardown with the same runner and `ENV` follows every run.

## Not covered (later work)

Real-provider qualification through `createHttpArtifactApp`/`composeArtifactHost` with PostgreSQL/S3 barriers and
faults below the app; persistent prevention, reauthorization retry, cross-process restart evidence; MCP codec
qualification; candidate scope/hash/validation reconciliation; tuple publication and image qualification; P7 wiring.
