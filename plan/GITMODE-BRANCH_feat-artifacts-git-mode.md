# Feature: Git-backed artifact mode wiring, flag off (W10: M2-I, M3-I, M4-I)

## Objective
Prepare the immo side of the git-backed artifact mode (A-LIVE v2, enablement plan r3.1, design D0) behind `IMMO_ARTIFACTS_GIT_MODE` (default off), so that the 0.2.19 pin is one small qualification commit and the owner's MCP-only test can start once 0.2.19, SG0-app and the builder are available.

## Scope / Guardrails
- Flag off: served tools, tool definitions (`artifact-tool-definitions-hash.test.ts`), compiled profile, assembled config and authoring guide byte-identical to `origin/main`.
- No provider bump (stays 0.2.18). 0.2.19 symbols live behind `git-mode/provider-adapter.ts` (TODO, fail-closed).
- Migrations: provider `0010_git_bindings` / `0011_live_drafts` copied byte for byte as `0036` / `0037` (provenance test), plus the immo-owned `0038_artifacts_live_invitations`. All additive and inert while the flag is off.
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
  - `deploy/overlays/preprod/**` (flag-on commit only, GITMODE-EX2)
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
- `GITMODE-EX2` (`deploy/overlays/preprod/**`): the preprod flag-on value sits in its own commit so the conductor enables it on preprod only, after the 0.2.19 qualification commit (the flag refuses to boot on an unqualified provider).
- `clarification` (conductor, Δ4): live is multi-user. Each user edits their own personal binding; invited live readers (code rights required, session- and generation-bound, revocable) read only; a third party never writes to another user's binding; the artifacts access enum is not widened.
- `attention`: `artifacts_list_app_sources` stays unrouted in 0.2.19 (M1 changelog): selected by no stage until a provider routes it.
- `attention`: the 0.3.0 allowance removal (A-LIVE §10) belongs to the 0.2.19 pin commit.
- `clarification` (s-archi): all host-executed or host-verified crypto comes from `@sentropic/artifacts/live-host` (0.2.20); the `content/live-assertion` subpath is abandoned.
- `deferred`: GB1 install-script rows need the integrity values of #1029 (15 of the 19 entries lack `integrity` on `origin/main`).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** — one draft PR, one commit per milestone (M2-I, M3-I, M4-I), then the plan/doc commit and the preprod flag commit.

## UAT Management (in orchestration context)
- No UI change; no UAT on this branch. The owner test runs through the preprod MCP after activation.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: rules, facts lane `immo-git-live-wiring.md`, plan r3.1 §0/§1/Δ4, M1 wagon shape (`createGitToolService`, `deps.gitTools`), worktree from `origin/main` `cc9f7ce2c`.
- [x] **Lot 1 — M2-I git bindings**
  - [x] `0036_artifacts_git_bindings` (provider 0010 byte copy) + provenance entry + journal.
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
- [ ] **Lot 5 — GB1 rows**: after #1029 merges, generate the 19 disabled install-script rows from the lock (`make -f tools/make/git-artifact.mk gb1-rows`), with the divergence test.
- [ ] **Lot 6 — Conductor**: 0.2.19 (+0.2.20) qualification commit, preprod flag-on, owner MCP-only test.
