# Feature: Remove the hallucinated multifamily 4+ signal filter

## Objective
Remove the signal-level multifamily 4+ filter from the Signals UI and client
filtering while preserving the zonage, early-signal, and residential-relevance
axes and restrictive server-provided subset counts.

## Scope / Guardrails
- Scope limited to the Signals rail, client subset filtering, filter persistence, and their unit tests.
- Do not change the API subset-count calculation or source-coverage/focus logic.
- Make-only workflow, no direct Docker commands.
- Root workspace is reserved for user dev/UAT and must remain stable.
- Branch development happens in `./tmp/fix-remove-multi4-filter`.
- Automated tests run on `ENV=test-remove-multi4-filter`, never `ENV=dev`.
- All new text in English. Discussions with the user may be in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/src/lib/components/maps/SignauxRail.test.ts`
  - `ui/src/lib/components/maps/SignauxMapView.svelte`
  - `ui/src/lib/signals/graph-signal-filter.ts`
  - `ui/src/lib/signals/graph-signal-filter.test.ts`
  - `ui/src/lib/router/filter-persistence.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `api/**`
  - `packages/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `api/drizzle/*.sql`
  - `../poc-k8s/**`
- **Exception process**:
  - No exception is required for this branch.

## Feedback Loop
- No external or sub-agent feedback required.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: the requested client-only fix is small and has one coherent test gate.

## UAT Management (in orchestration context)
- [ ] UI UAT on the root checkout is not run by this branch; automated UI tests cover the changed controls.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read repository rules and establish the isolated worktree.
  - [x] Capture the existing `m` filter and confirm the baseline UI test command.
  - [x] Confirm the dedicated test environment `test-remove-multi4-filter`.

- [x] **Lot 1 — Remove client filter axis and preserve restrictive counts**
  - [x] Remove the multifamily 4+ control and client heuristic.
  - [x] Ignore legacy unsupported filter flags during persistence/restoration.
  - [x] Update rail and client filter tests, including the restrictive early-signal count regression.
  - [x] Lot gate: `make lint ENV=test-remove-multi4-filter` and `make test-ui ENV=test-remove-multi4-filter`.

- [ ] **Lot 2 — Publish**
  - [x] Commit only scoped files with the repository identity.
  - [x] Push `fix/remove-multi4-filter` and open PR #373 targeting `main`.
  - [ ] Verify CI status where available; do not merge.
