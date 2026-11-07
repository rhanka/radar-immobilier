# Feature: Git-backed artifact mode wiring, flag off (W10: M2-I, M3-I, M4-I)

## Objective
Prepare the immo side of the git-backed artifact mode (A-LIVE v2, enablement plan r3.1, design D0) behind `IMMO_ARTIFACTS_GIT_MODE` (default off), so that the 0.2.20 pin is one small qualification commit and the owner's MCP-only test can start once 0.2.20, SG0-app and the builder are available.

## Scope / Guardrails
- Flag off: served tools, tool definitions (`artifact-tool-definitions-hash.test.ts`), compiled profile, assembled config and authoring guide byte-identical to `origin/main`.
- No provider bump (stays 0.2.18). 0.2.20 symbols live behind `git-mode/provider-adapter.ts` (TODO, fail-closed).
- Migrations: `0036` is derived from provider `0010_git_bindings` by one fixed rewrite (immo `lock_timeout` prefix + replay-idempotence rewrite, provider hash pinned); `0037` is a byte copy of provider `0011_live_drafts`; `0038_artifacts_live_invitations` is immo-owned. All checked by the provenance test, additive and inert while the flag is off.
- Make-only workflow; `ENV=test-gitmode*`; every stack removed (`down -v` traps in the Make targets).
- Branch development in `./tmp/artifacts-git-mode`; root checkout untouched.
- No Python, no `.env` read, no cluster action, no bascule/cutover/PG18 change.
- Commits carry no attribution trailer.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts-host/src/**`
  - `packages/immo-mcp/src/registry/**`, `packages/immo-mcp/config/**`
  - `api/drizzle/0036_artifacts_git_bindings.sql`, `api/drizzle/0037_artifacts_live_drafts.sql`, `api/drizzle/0038_artifacts_live_invitations.sql`, `api/drizzle/meta/_journal.json`
  - `api/tests/integration/artifacts-provenance.spec.ts`
  - `docs/operator/git-artifact-mode.md`
  - `tools/make/git-artifact.mk`, `tools/make/git-artifact-gb1-rows.mjs` (GB1 rows generator), `artifact-build/gb1-qualification.json`
  - `api/src/app.ts`, `api/src/artifacts/control-route.ts`, `api/src/artifacts/control-route-startup.ts`, `api/src/artifacts/live-host-route*.ts` (inbound SG4b routes, stage `build`+ only)
  - `ui/vite.config.ts`, `tools/make/ui-artifact-env.mjs`, `tools/make/git-artifact-descriptor.test.mjs` (live basemap default)
  - `plan/GITMODE-BRANCH_feat-artifacts-git-mode.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (other branches), `.github/**`, `deploy/k8s/**` (prod base)
  - `package.json`, `package-lock.json` (no bump in this branch)
- **Conditional Paths**:
  - `api/drizzle/*.sql`: three files (GITMODE-EX1).
- **Exception process**: declared below.

## Feedback Loop
- `GITMODE-EX1` (`api/drizzle`, 3 files instead of 1): 0036/0037 are provider copies required by D0 (immo composes bindings and live drafts locally); 0038 is the immo invitation ledger required by Δ4. Impact: additive tables and indexes, one nullable column on `artifacts.releases`; no row is written while the flag is off. Rollback: revert the commits before deploy; after deploy, the objects are inert and can stay.
- `GITMODE-EX2` (cancelled by review B1): the preprod flag-on commit is NOT part of this PR; it lives on the local, unpushed branch `feat/artifacts-git-mode-preprod-on` on top of the PR head, to be stacked after the 0.2.20 qualification commit. This PR is flag-off everywhere.
- `acknowledge` (review #1030): B1 preprod commit removed; flag off never reads the git configuration (tested); M1 `lock_timeout` prefix on 0036 within the provenance rewrite; GB1 qualification wired into every build job request; fence push drains bodies and surfaces non-2xx; invitations capped at the session end; flag-off profile digests pinned from `origin/main`.
- `clarification` (conductor, Δ4): live is multi-user. Each user edits their own personal binding; invited live readers (code rights required, session- and generation-bound, revocable) read only; a third party never writes to another user's binding; the artifacts access enum is not widened.
- `attention`: `artifacts_list_app_sources` stays unrouted in 0.2.20 (M1 changelog): selected by no stage until a provider routes it.
- `attention`: the 0.3.0 allowance removal (A-LIVE §10) belongs to the 0.2.20 pin commit.
- `clarification` (s-archi): all host-executed or host-verified crypto comes from `@sentropic/artifacts/live-host` (0.2.20); the `content/live-assertion` subpath is abandoned.
- `acknowledge`: #1029 merged; the 19 GB1 DISABLED rows (15 package names, `allowScripts`) are generated from the merged lock; `postinstallAllowlist` stays `[]`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** — one draft PR, one commit per milestone (M2-I, M3-I, M4-I), then the docs, GB1, capacity and review commits.

## UAT Management (in orchestration context)
- No UI change; no UAT on this branch. The owner test runs through the preprod MCP after activation.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: rules, facts lane `immo-git-live-wiring.md`, plan r3.1 §0/§1/Δ4, M1 wagon shape (`createGitToolService`, `deps.gitTools`), worktree from `origin/main` `cc9f7ce2c`.
- [x] **Lot 1 — M2-I git bindings**
  - [x] `0036_artifacts_git_bindings` (provider 0010 + lock-timeout prefix + idempotence rewrite, review M1) + provenance entry + journal.
  - [x] `IMMO_ARTIFACTS_GIT_MODE` stages `off|bindings|build|live`, provider routing table (fail-closed), profile/selection/scopes/effective profile/overlay config gated by the flag.
  - [x] A1 registry with the A-LIVE §3.1 refusals; SG0-app lease broker client (`/github-app/broker/lease`); per-user code rights, GitHub human directory, write-scope context; `deps.git` + `gitTools` composition.
  - [x] Authoring guide `gitMode` section (flag on only) with the enforced ceilings.
- [x] **Lot 2 — M3-I build**
  - [x] Host build API client (`sandbox` only); SG4b handoff verification (signature, 10-minute lifetime, job/commit/generation, 255 files / 16 MiB / 64 MiB, candidate digest), single-commit acceptance port (fail-closed), host-signed receipt.
- [x] **Lot 3 — M4-I live (stubs)**
  - [x] `0037_artifacts_live_drafts` (provider 0011) and `0038_artifacts_live_invitations`.
  - [x] Per-user live authority, invitations (create/list/revoke), content-host reader gate; `LiveService` composition with fail-closed keys, no worker, `qualified=false`.
  - [x] Live edge revocation: sockets closed first, fence pushed to `/_live-control/v1` with retry, failure surfaced.
  - [x] One provider seam `@sentropic/artifacts/live-host` (0.2.20) for handoff verification, receipt/assertion signing, candidate digest; no immo crypto (local SG4b checks kept as test-support contract reference only).
- [x] **Lot 4 — Gate**: typecheck, lint, artifacts-host / immo-mcp / provenance / binding-store integration tests via Make.
- [x] **Lot 5 — GB1 rows**: after #1029 merged (rebased on `621e8d2c4`), generated the 19 disabled install-script rows from the lock (`make -f tools/make/git-artifact.mk gb1-rows`), with the divergence test.
- [x] **Lot 6 — Sentropic integration values (2026-11-07)**
  - [x] One OAuth client_credentials token source (scopes `github-app:broker`, `artifacts:builder`), cached until expiry, fail-closed.
  - [x] Broker on `/api/v1/github-app/broker/lease`; builder client `POST /v1/builds {artifactId, jobId}` (202/200) and `GET /v1/builds/<artifactId>/<jobId>` after persisting the job (fail-closed job store).
  - [x] Inbound `POST /api/v1/artifacts/live-host/v1/job` and `/handoff` on radar-api (stage `build`+), provider `verifyJobRequest`/`resolvePendingJob`/`parseHandoffRequest`/`acceptHandoff`, Ed25519 builder keys and immo receipt key from env, fail-closed ledger.
  - [x] Live edge HMAC keyring (`kid=base64url`), pages host and control URL; sealed `LiveKeyPort` (HKDF per binding).
  - [x] `VITE_BASEMAP_TILE_URL` defaulted by `ui/vite.config.ts` in artifact mode for the live dev server; wrapper and dist check unchanged in effect.
  - [x] Exact env var list in `docs/operator/git-artifact-mode.md`.
- [ ] **Lot 7 — Conductor**: 0.2.20 qualification commit, preprod flag-on, owner MCP-only test.
