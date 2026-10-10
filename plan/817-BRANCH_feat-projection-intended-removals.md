# Feature: Projection declared changes — intended removals and accepted property losses (#817)

## Objective
Give the `projection` job two bounded, validated declarations for ONE city: intended node removals (ids) and accepted business-property losses (`id:key`). The projection accepts exactly those changes and refuses every other removal or loss; a declaration absent from the plan fails the run. Calls without the option are unchanged. Owner decision 2026-10-10 (#817, D7): brigham = 21 removals + 1 accepted loss `muni-brigham:flag`, preprod then prod. Spec: `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md` §17.

## Scope / Guardrails
- Scope limited to the projection guards (`graph-store.ts`), the projection script and its argument parser, the two projection manifests, `run-job.yaml` input handling, one CI shell test, the spec section and this file.
- No migration.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in repository-local worktree `./tmp/projection-intended-removals`. Do not use system `/tmp`.
- Automated test campaigns run on `ENV=test-projection-declared`, never on root `dev`; `make clean ENV=test-projection-declared` after each stack.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English. Discussions with the user may be in French.
- 0 Python. No API key. No operation: no dispatch, no DB/S3 write, no kubectl write, no merge, no tag.
- No commit or PR attribution lines of any kind.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/graph/graph-store.ts`
  - `api/src/services/graph/graph-store.test.ts`
  - `api/src/scripts/project-graph-from-s3.ts`
  - `api/src/scripts/projection-args.ts`
  - `api/src/scripts/projection-args.test.ts`
  - `deploy/k8s/32-graph-projection-only-job.yaml`
  - `deploy/k8s/graph-projection-preprod/job.yaml`
  - `deploy/ci/projection-declared-args.sh`
  - `deploy/ci/projection-declared-args.test.sh`
  - `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md`
  - `docs/reviews/pr-*/**`
  - `plan/817-BRANCH_feat-projection-intended-removals.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `../poc-k8s/**` (cross-repo work)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `BR817-EX1` — `.github/workflows/run-job.yaml`: route the declarations (reused input `recovery_cities`, mode `recovery_mode`, both only for `job=projection` with declarations) through the validator script into the new `__PROJECTION_ARGS__` placeholder. Impact: projection dispatches only; empty declarations render an empty placeholder (unchanged command). Rollback: revert the commit.
- [x] `BR817-EX2` — `.github/workflows/ci.yml`: one step running `deploy/ci/projection-declared-args.test.sh` (offline). Impact: CI quality job only. Rollback: revert the commit.
- [x] `attention` — step 1 stop (2026-10-10): the projection deletes 21 nodes (not 22); the 22nd gate1 entry is `muni-brigham` (present in S3, loses `flag`). `clarification` owner 2026-10-10: 21 removals + 1 accepted loss `muni-brigham:flag`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one small tooling change, one PR.

## UAT Management (in orchestration context)
- No UI surface: no UAT. The acceptance is the preprod preview then apply run of the runbook (after merge and deploy, operator side).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and pointers (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`).
  - [x] Create isolated repository-local worktree `./tmp/projection-intended-removals` from `origin/main`.
  - [x] Establish the brigham change list from the run logs and the dossier proofs (read-only).
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Declare `BR817-EX1`, `BR817-EX2`.

- [x] **Lot 1 — Guards and script**
  - [x] Tests first: declared removals accepted, undeclared removal refused, declaration absent from the plan refused, accepted loss limited to its key, city without option unchanged, preview rolls back, argument parser bounds.
  - [x] `checkDeclaredChanges` + accepted losses in gate1; declared mode in `projectCityInTransaction`; `upsertGraphAtomic` options (`declared`, `preview`).
  - [x] `projection-args.ts` parser; script wiring and termination summary.
  - [x] Lot gate:
    - [x] `make typecheck ENV=test-projection-declared` + `make lint ENV=test-projection-declared`
    - [x] `make test-api SCOPE=... ENV=test-projection-declared` then `make clean ENV=test-projection-declared`

- [x] **Lot 2 — Workflow and manifests**
  - [x] Tests first: `deploy/ci/projection-declared-args.test.sh`.
  - [x] Validator script, `run-job.yaml` routing, `__PROJECTION_ARGS__` in both manifests, CI step.
  - [x] Lot gate: `make k8s-validate ENV=ci`, shell test.

- [ ] **Lot 3 — Docs, PR, review**
  - [x] Spec §17 (contract, brigham list, runbook).
  - [ ] PR `Refs #817` with the 21 ids, the loss and the runbook; CI green.
  - [ ] Two blind Codex reviews in `docs/reviews/pr-<n>/`; fix until GO.
