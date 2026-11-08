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
  - `api/drizzle/0041_artifacts_live_authorizations.sql`, `api/drizzle/meta/_journal.json`
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
- `attention`: CORRECTIF — the assertion signs the controller grant UNCHANGED
  (13 fields) plus `v`, `kid`, `host`, `iat`, `exp`; the package runtime fields
  are never used and `podUid` can no longer be `''`. The DB-runtime claim
  sourcing of the first draft is removed.
- `attention` (s-archi r2, superseded r1): the invitation epoch is SESSION state of the binding generation, shared by every active invitation (several allowed, one principal each); 0 until the first invitation, +1 on each revoke or replace (remaining rows adopt it), never lowered. Grant and reconcile bodies carry `invitation: {epoch, expiresAt}` (latest active expiry or null); the top-level `invitationEpoch` of the CORRECTIF is replaced by it (to confirm with s-archi).
- `attention` (s-archi r2): baskets.read reader consent is necessary, not sufficient; a dedicated `artifacts.live_authorizations` record (migration 0041) is required: owner on first admitted open, invitee on explicit acceptance; the gate requires consent, code rights, owner or invitation, and a valid record.
- `attention`: one invitation flag only (`IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED`), plus `IMMO_ARTIFACTS_LIVE_QUALIFIED` for the worker; both default false, turned on by an ops change only after an owner-recorded « GB4 GO preprod ».
- `attention` (review 1034): B1 socket error handler at the upgrade entry (regression test), M1 revocation wired through the invitation routes, M2 live principal through `content-serve.ts#authorized`, L1 invitee session check, L2 socket caps and shared recheck, L3 response header allowlist, conditional headers dropped, controller answers bounded to 64 KiB.
- `attention`: the control push now goes to the INTERNAL Service
  (`IMMO_ARTIFACTS_LIVE_EDGE_URL`) with Host and claim host
  `<artifactId>.<pages domain>` (the edge scopes control to the artifact Host).
  `IMMO_ARTIFACTS_LIVE_CONTROL_URL` (set by PR #1033) is still validated so the
  manifest keeps booting, but never used.
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
- [x] **Lot 5 — s-archi r2 + review 1034**: session epoch, live authorization records (0041), qualification flags, invitation routes (`/api/v1/artifacts/control/live/*`), B1/M1/M2/L1-L3.
- [x] **Lot 6 — Gate**: see Verification.

## Verification
- Head r1 (04d40d180): verify pass (immo-mcp 604, artifacts-host 481), test-api 19.
- Head r2 (s-archi r2 + review 1034):
  - `make -f tools/mcp-p0b.mk verify ENV=test-liveedge`: typecheck immo-mcp / artifacts-host / api and eslint: pass; immo-mcp 74 files, 604 tests passed (5 skipped), unchanged (tool definitions hash and flag-off profile digests); artifacts-host with Postgres 60 files, 490 tests passed (incl. live invitations / 0041 integration); strict cas.v2: the 1 pre-existing `p0c-transport` failure (13 vs 16 tools, ART0220), unrelated.
  - `make -f tools/mcp-p0b.mk test-api SCOPE="src/artifacts/live-edge-forward.test.ts src/artifacts/control-route src/artifacts/content-serve src/artifacts/live-host-route.test.ts tests/integration/migrate-idempotence.spec.ts tests/integration/artifacts-migrations.spec.ts tests/integration/artifacts-provenance.spec.ts" ENV=test-liveedgeapi`: migrations 0000 -> 0041 on Postgres, 22 files, 142 tests passed, no unhandled error (B1 regression included).
- Workspace-wide eslint of the api files runs in CI (`make lint ENV=ci`).
- Every stack torn down (`down -v` trap).

## Waiting on Sentropic
- M4-R wagon: `POST /v1/live/grant`, `/v1/live/reconcile`, `/v1/live/stop`, draft staging format.
- GB4-P go; `APP_ARTIFACT_LIVE_ENABLED=1` on artifact-content (default 0: every request 404).
- Netpol `allow-immo-content-host-to-artifact-content` (sentropic `40cc46c30`) applied in sentropic-preprod.
