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
  - `api/src/index.ts`, `api/src/artifacts/content-serve.ts` (live reader verification reuse)
  - `api/drizzle/0041_drop_artifacts_live_invitations.sql`, `api/drizzle/meta/_journal.json`, `api/tests/integration/artifacts-migrations.spec.ts`
  - `packages/artifacts-host/src/p0b.test-support.ts` (fixture migration list)
  - `docs/operator/git-artifact-mode.md`
  - `plan/LIVEEDGE-BRANCH_feat-artifacts-live-edge.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `deploy/**`, `rules/**`, `.github/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `packages/immo-mcp/**` (tool catalogue and profile unchanged)
  - other `plan/*-BRANCH_*.md`
- **Conditional Paths**: none.

## Feedback Loop
- `attention`: CORRECTIF: the assertion signs the controller grant UNCHANGED (13 fields) plus `v`, `kid`, `host`, `iat`, `exp`; the package runtime fields are never used.
- `attention` (s-archi r3): `grant.sessionId` is the CONTROLLER session (new on every revive and crash restore, revive.ts:26 @ e14fb6b9e): carried as is in the assertion and the HMR path, never compared with the package `liveSessionId`. Grant freshness: 200, current revision, 30 s cache, invalidated on 409 / edge 404. The body `invitation:{epoch, expiresAt}` (replacing the top-level `invitationEpoch`) is confirmed.
- `attention` (owner decision, s-archi): live invitations become GENERIC in @sentropic/artifacts 0.2.22 (train 1c). #1034 keeps no invitation storage nor route: the r2 session-epoch store, the live authorization table (former 0041) and the `/control/live/*` routes are removed before merge (never deployed). Live is OWNER-ONLY: (a) baskets reader consent, (b) code rights, (c)+(d) binding owner = runtime owner; invitees refused (TODO(0.2.22): `liveViewer`); `invitation` body = `{epoch: 0, expiresAt: null}` (TODO(0.2.22): `liveInvitationState`).
- `attention` (collision): the immo 0038 table `artifacts.live_invitations` (empty, applied on preprod) has the same name and a different schema than the package `0013_live_invitations` (whose column guard would RAISE). `0041_drop_artifacts_live_invitations` drops it forward-only (refused if any row exists); the immo invitation store and service of #1030 are removed (no legacy fallback).
- `attention` (flags): `IMMO_ARTIFACTS_LIVE_QUALIFIED` (worker) and `IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED` (reserved for the 0.2.22 host port), both default false, turned on by an ops change only after an owner-recorded « GB4 GO preprod ».
- `attention` (reviews 1034 r1/r2): B1 socket error handlers from the upgrade entry (regression tests), M2 live principal through `content-serve.ts#authorized`, L2 socket caps and shared recheck, L3 response header allowlist, N1 every `__` first segment reserved, N2 `grant` query never relayed, controller answers bounded to 64 KiB. M1/N3/N4/N5 concerned the removed invitation routes.
- `attention`: the control push goes to the INTERNAL Service (`IMMO_ARTIFACTS_LIVE_EDGE_URL`) with Host and claim host `<artifactId>.<pages domain>`; `IMMO_ARTIFACTS_LIVE_CONTROL_URL` is validated only.
- `attention`: network: radar-api carries `app.kubernetes.io/name: radar-immobilier` + `app.kubernetes.io/component: api` (Sentropic policy selector); no immo egress policy to adapt.

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
- [x] **Lot 5 — s-archi r2/r3 + reviews 1034**: session-key fix, owner-only gate, 0041 drop of the immo invitation table, qualification flags, review fixes.
- [x] **Lot 6 — Gate**: see Verification.

## Verification
- Final head (owner-only, 0041 drop):
  - `make -f tools/mcp-p0b.mk verify ENV=test-liveedge`: typecheck immo-mcp / artifacts-host / api and eslint pass; immo-mcp 74 files, 604 passed (5 skipped), unchanged (tool definitions hash and flag-off profile digests); artifacts-host with Postgres 59 files, 478 passed; strict cas.v2: the 1 pre-existing `p0c-transport` failure (13 vs 16 tools, ART0220), unrelated.
  - `make -f tools/mcp-p0b.mk test-api SCOPE="live-edge-forward, control-route*, content-serve*, live-host-route, migrate-idempotence, artifacts-migrations, artifacts-provenance" ENV=test-liveedgeapi`: migrations 0000 -> 0041 (0041 replayed on a drifted journal), 22 files, 145 passed, no unhandled error.
  - `make -f tools/mcp-p0b.mk integration SCOPE="live-forward, live-edge, live, git-bindings, host-ledger, p0b" ENV=test-liveedge`: Postgres fixture 0015 -> 0041, 6 files, 57 passed.
- Workspace-wide eslint of the api files runs in CI (`make lint ENV=ci`).
- Every stack torn down (`down -v` trap); no container or volume left.

## Waiting on Sentropic
- M4-R wagon: `POST /v1/live/grant`, `/v1/live/reconcile`, `/v1/live/stop`, draft staging format.
- GB4-P go; `APP_ARTIFACT_LIVE_ENABLED=1` on artifact-content (default 0: every request 404).
- Netpol `allow-immo-content-host-to-artifact-content` (sentropic `40cc46c30`) applied in sentropic-preprod.
