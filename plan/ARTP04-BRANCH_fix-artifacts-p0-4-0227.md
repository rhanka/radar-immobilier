# Feature: Artifacts 0.2.27 live re-drive adoption (P0-4)

## Objective
- [x] Make the live artifact flow reliable on the immo host with `@sentropic/artifacts` 0.2.27 (sentropic #1004).

## Scope / Guardrails
- [x] Branch `fix/artifacts-p0-4-0227` from `origin/main`, isolated agent worktree.
- [x] Make-only container execution; no environment files or secrets read; no kube config.
- [x] Use `ENV=test-artp04`; test stack publishes no ports; always `down -v` afterwards.
- [x] No preprod or prod action; no merge; PR #1078 left open (owner decision Q3).
- [x] Commits carry no attribution trailer.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package.json`
  - `package-lock.json`
  - `artifact-build/gb1-qualification.json`
  - `packages/artifacts-host/src/**`
  - `packages/immo-mcp/config/immo-artifacts.*.json`
  - `packages/immo-mcp/src/registry/artifact-profile.test.ts`
  - `tools/mcp-p0b.mk`
  - `tools/mcp-p0b-candidate.sh`
  - `docs/operator/git-artifact-mode.md`
  - `deploy/overlays/preprod/patch-immo-mcp-config.yaml` (re-drive flag, one workload)
  - `plan/ARTP04-BRANCH_fix-artifacts-p0-4-0227.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (not touched: package index 0014 deferred, see Feedback Loop)

## Feedback Loop
- [x] attention: package migration `0014_live_drafts_pending.sql` (partial index for `LiveStore.pending`) is not mirrored in `api/drizzle`; the scan works without it. Owner: conductor.
- [x] attention: 0.2.27 requires `ownerId` in the host recheck view; supplied from `personal_principal_id`, `attached_by` fallback.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; dependency bump and host wiring share one checkout.

## UAT Management (in orchestration context)
- [x] No UI change; automated qualification only.

## Plan / Todo (lot-based)
- [x] Lot 0: Read rules, wait for the 0.2.27 publication, read the published types.
- [x] Lot 1: Pin 0.2.27 (lock, routing lists, profiles, P0B tooling, GB1 lock digest).
- [x] Lot 2: Drop the pre-build live reconcile (A7); host view carries `ownerId`.
- [x] Lot 3: Boot + 15 s re-drive timer, SIGTERM drain, `onWorkerEvent` JSON logs (A1, A3, A9).
- [x] Lot 4: Unit tests for the three points; typecheck, lint, test on `ENV=test-artp04`.
- [x] Lot 5: Push, open the PR (#1079), CI green.
- [x] Lot 6 (review): 409 `live_session_active` as `git_live_conflict`/`active_session`, logged, job closed and re-armed on retry.
- [x] Lot 6 (review): re-drive gated by `IMMO_ARTIFACTS_LIVE_REDRIVE_ENABLED=true`, set on radar-immo-mcp only.
- [x] Lot 6 (review): SIGTERM drain ends with exit 0 (PID 1); composition wiring and ownerId fallback tests in CI.
- [ ] Conductor: review and merge with a merge commit.
