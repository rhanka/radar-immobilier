# Feature: Artifacts live edge (W9 host side, controller grant)

## Objective
Implement immo's side of the W9 live edge as fixed by Sentropic on 2026-11-07
(`tmp/conductor/concertation-git-artifact/sentropic-live-edge-contract-2026-11-07.md`,
its CORRECTIF superseding the claim sources of §2): the controller grant
client, the HTTP LiveWorkerPort (reconcile / stop), the forward of the owner's
or invitee's stable pages Host to `artifact-content` (HTTP and HMR websocket)
with a signed `x-live-host-assertion`, and the control push to the internal
artifact-content Service. Everything sits behind a NEW flag
`IMMO_ARTIFACTS_LIVE_EDGE_ENABLED` (default off) on top of stage `live`.
Flag off stays zero-change.

## Scope / Guardrails
- Scope limited to the git-mode live modules of `packages/artifacts-host`, the
  radar-api content-host composition and forward, the operator doc and this plan.
- No flag change in any deployment; `deploy/**` untouched (PR #1033 owns the
  preprod stage `live` activation and is not touched).
- Sentropic side does not answer yet: coded against the contract with fakes.
- Make-only workflow, no direct Docker commands; `down -v` after every stack.
- Branch development happens in `./tmp/live-edge-prod`; tests on `ENV=test-liveedge*`.
- In every `make` command, `ENV=<env>` is the last argument.
- All new text in English. No Python.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts-host/src/git-mode/**`
  - `api/src/artifacts/live-edge-forward.ts`, `api/src/artifacts/live-edge-forward.test.ts`
  - `api/src/artifacts/control-route.ts`, `api/src/artifacts/control-route-startup.ts`
  - `api/src/index.ts`
  - `docs/operator/git-artifact-mode.md`
  - `plan/LIVEEDGE-BRANCH_feat-artifacts-live-edge.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `deploy/**`, `rules/**`, `.github/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `packages/immo-mcp/**` (tool catalogue and profile unchanged)
  - other `plan/*-BRANCH_*.md`
- **Conditional Paths**: none.

## Feedback Loop
- `attention`: CORRECTIF — the assertion signs the controller grant UNCHANGED
  (13 fields) plus `v`, `kid`, `host`, `iat`, `exp`; the package runtime fields
  are never used and `podUid` can no longer be `''`. The DB-runtime claim
  sourcing of the first draft is removed.
- `attention`: `invitationEpoch` floor: immo's invitations carry one epoch each
  (1 at creation, +1 on revocation); the floor sent is the current stored
  epoch of the active invitation (0 for the binding owner). Sentropic's
  `liveRole` requires `invitation.epoch === invitationEpoch`; to confirm with
  s-archi when the grant route lands.
- `attention`: "live consent" of the §8.2 gate is read as a non-revoked
  `baskets.read` reader consent row of the principal for the artifact (current
  scope version), re-read on every admission. Absent consent service: refused.
- `attention`: the control push now goes to the INTERNAL Service
  (`IMMO_ARTIFACTS_LIVE_EDGE_URL`) with Host and claim host
  `<artifactId>.<pages domain>` (the edge scopes control to the artifact Host).
  `IMMO_ARTIFACTS_LIVE_CONTROL_URL` (set by PR #1033) is still validated so the
  manifest keeps booting, but never used.
- `attention`: worker qualification stays `false`: with the flag on, a worker
  is composed but `live_write` / `live_control(start)` keep answering
  `builder_unavailable` until the M4-lite qualification is switched.
- `attention`: network: the Sentropic policy admits pods labelled
  `app.kubernetes.io/name: radar-immobilier` + `app.kubernetes.io/component: api`;
  radar-api carries exactly these labels; immo has no egress policy to adapt.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (one host feature behind one flag)

## UAT Management (in orchestration context)
- No UI surface change while the flag is off; live UAT waits for the Sentropic
  M4-R wagon and GB4-P.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: worktree `./tmp/live-edge-prod` from `origin/main` (8dea88507); first draft (pre-CORRECTIF) reviewed and kept where it fits (node:http forward, header allowlist, websocket tunnel, socket registry).
- [x] **Lot 1 — Controller clients** (`live-grant.ts`): grant client (`POST v1/live/grant`, S2S `artifacts:builder`, 200/409/403, strict grant parsing with recomputed pod name, 30 s cache per artifact/principal/invitation, invalidation on 409, edge 404 and revocation); HTTP LiveWorkerPort (`v1/live/reconcile` -> BridgeAck, `v1/live/stop` -> 204) composed as the package LiveService `worker` only with the new flag.
- [x] **Lot 2 — Admission** (`live-forward.ts`): §8.2 gate (owner / active invitee, code rights, live consent), readiness (phase LIVE and appliedRevision = draft revision), grant with `sourceRevision` = that revision, otherwise release; closed 18-claim assertion (HTTP 60 s, websocket 3600 s capped at the invitation expiry).
- [x] **Lot 3 — Forward** (`api/src/artifacts/live-edge-forward.ts`, `index.ts`): GET/HEAD node:http forward with exact Host, Origin as is, credential headers stripped; HMR upgrade (`token` only, Origin required, `vite-hmr`), sockets tracked per session/invitation and closed on revocation, at exp and on a failed recheck; « live indisponible » on any non-2xx / non-101 / connection failure.
- [x] **Lot 4 — Control push** (`live-edge.ts`): node:http POST `/_live-control/v1` to the internal Service, per-artifact Host and claim host, 10 control fields.
- [x] **Lot 5 — Gate**: see Verification.

## Verification
- `make -f tools/mcp-p0b.mk integration SCOPE="src/git-mode/live-grant.test.ts src/git-mode/live-forward.test.ts src/git-mode/live-edge.test.ts src/git-mode/live.test.ts" ENV=test-liveedge`: 4 files, 53 tests (one expectation fixed after the first run, then covered by the full run below).
- `make -f tools/mcp-p0b.mk test-api SCOPE="src/artifacts/live-edge-forward.test.ts src/artifacts/control-route-startup.test.ts src/artifacts/live-host-route.test.ts" ENV=test-liveedgeapi`: migrations on Postgres, 3 files, 19 tests passed.
- `make -f tools/mcp-p0b.mk verify ENV=test-liveedge`: typecheck immo-mcp / artifacts-host / api and eslint (packages/immo-mcp/src, packages/artifacts-host/src, api/src/artifacts/control-route*.ts): pass; immo-mcp 74 files, 604 tests passed (5 skipped), identical to the 0.2.20 baseline (tool definitions hash and flag-off profile digests unchanged); artifacts-host with Postgres 60 files, 481 tests passed (baseline 58 / 456); strict cas.v2: the 1 pre-existing `p0c-transport` failure (13 vs 16 tools, documented in ART0220), unrelated.
- Workspace-wide eslint (`api/src/artifacts/live-edge-forward*.ts`, `api/src/index.ts`) runs in CI (`make lint ENV=ci`).
- Every stack torn down (`down -v` trap).

## Waiting on Sentropic
- M4-R wagon: `POST /v1/live/grant`, `/v1/live/reconcile`, `/v1/live/stop`, draft staging format.
- GB4-P go; `APP_ARTIFACT_LIVE_ENABLED=1` on artifact-content (default 0: every request 404).
- Netpol `allow-immo-content-host-to-artifact-content` (sentropic `40cc46c30`) applied in sentropic-preprod.
