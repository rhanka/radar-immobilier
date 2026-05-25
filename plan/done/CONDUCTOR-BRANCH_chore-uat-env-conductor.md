# Chore: UAT env stability + conductor report + multi-agent registry

## Objective
Operationalize the "UAT on the root checkout at fixed dev ports, worktrees for
test/branch ports only" model (sentropic-aligned), add a `make conductor-report`
status target, and add a `.agents/` registry so the conductor can report which
agent works on which branch.

## Scope / Guardrails
- This branch is explicitly allowed to touch the default-forbidden infra files
  (`Makefile`, `rules/**`, `plan/BRANCH_TEMPLATE.md`) because its purpose is to
  fix the orchestration rules themselves.
- Make-only workflow, no direct Docker/npm/node commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT
  (`ENV=dev`) and must remain stable.
- Branch development happens in repository-local isolated worktree
  `./tmp/chore-uat-env-conductor`; never use system `/tmp`.
- No test campaign needs `dev`; verification uses `make` targets only.
- In every `make` command, `ENV=<env>` is the last argument.
- All new Markdown/spec/rules/Makefile text is English. Discussions FR.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/CONDUCTOR-BRANCH_chore-uat-env-conductor.md`
  - `PLAN.md`
  - `Makefile`
  - `rules/MASTER.md`, `rules/workflow.md`, `rules/conductor.md` (new)
  - `plan/BRANCH_TEMPLATE.md`
  - `.agents/**`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `api/**`, `ui/**`, `packages/**`, `e2e/**`
  - `docs/spec/input/**`
  - `plan/NN-BRANCH_*.md` (other branches), `plan/done/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` (pointers stay; rules carry content)
- **Conditional Paths**:
  - `.github/workflows/**` only if conductor-report must run in CI (not planned).
- **Exception process**: declare `BRxx-EXn` in `## Feedback Loop` before touching
  any conditional/forbidden path.

## Feedback Loop
- `CONDUCTOR-EX1` (acknowledge): touching `Makefile`, `rules/**`, and
  `plan/BRANCH_TEMPLATE.md` is the explicit purpose of this branch.
  - Impact: changes orchestration conventions for all future branches.
  - Rollback: revert this branch's commits; conventions return to prior state.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — one coherent infra change set.
- [ ] **Multi-branch**
- Rationale: rules + Makefile + registry are one reviewable change with no
  independent CI need.

## UAT Management (in orchestration context)
- No UI surface. "UAT" here = run `make conductor-report` and confirm the
  report renders lanes/agents/branches correctly, and confirm stale stacks are
  torn down via `make down ENV=<stale>`.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, sentropic `rules/conductor.md`
    and `conductor-agent-report` target.
  - [x] Create isolated worktree `./tmp/chore-uat-env-conductor`; confirm `tmp/`
    ignored; confirm `cloc` available on host.
  - [x] Record decisions (env hygiene first, then registry + report).

- [x] **Lot 1 — Fixed-UAT-ports rule + conductor rules**
  - [x] `rules/MASTER.md`: make the UAT-on-root fixed-ports contract explicit
    (root `ENV=dev`: API 8801 / UI 5301 / Maildev 1101, stable data; worktrees
    use test/branch ports only; sub-agents never use root UAT ports).
  - [x] Add `rules/conductor.md` (radar-adapted): conductor role, port
    non-concurrency, lane registry, 3-agent model (gpt-5.5 xhigh / opus 4.7 /
    gemini 3.5 high), launch packet, escalation format.
  - [x] `rules/workflow.md`: UAT step points to root checkout fixed ports.
  - [x] Lot gate: `git diff --check`; rules cross-references resolve.

- [x] **Lot 2 — BRANCH_TEMPLATE.md alignment**
  - [x] Remove per-branch UAT ports; UAT section points to the root fixed-port
    contract; keep per-branch test/branch ports only.
  - [x] Lot gate: `git diff --check`.

- [x] **Lot 3 — Makefile: conductor-report + cloc + teardown**
  - [x] SLOC via inline `cloc` (graceful `n/a` if binary missing).
  - [x] Add `conductor-report` (+ aliases) adapted to radar's plan-file layout
    (`tmp/<slug>/plan/*-BRANCH_*.md`), UAT-lot-excluded done/treated %, dirty,
    head, sloc, heartbeat. Lanes via `CONDUCTOR_LANES` / `CONDUCTOR_LANES_FILE`
    (default `.agents/lanes`) / auto-glob `tmp/feat-* tmp/fix-* tmp/chore-*`.
  - [x] Add `down-stale` helper to stop a list of ENV stacks.
  - [x] Lot gate: `make conductor-report` renders (tested explicit lanes +
    auto-glob; correctly reports done%, dirty, head, sloc, heartbeat).

- [x] **Lot 4 — `.agents/` registry**
  - [x] `.agents/README.md` (format `lane|agent|dir`, the 3 agents, how report reads it).
  - [x] `.agents/lanes` seeded with current live lanes (CONDUCTOR, BR-04, BR-05R);
    agent left `-` where the real assignment is not known (filled at launch).
  - [x] Lot gate: `make conductor-report CONDUCTOR_LANES_FILE=.agents/lanes`
    (verified from root: scopes to active lanes).

- [x] **Lot 5 — Teardown stale stacks + verify**
  - [x] `make down-stale STALE="feat-ui-skeleton ..."` (BR-03 merged, was on 5304).
  - [x] Stop stale merged test stack (`test-source-spikes`).
  - [!] `test-k8s-tenant` left UP on purpose: BR-04 still in review (not orphan).
  - [x] Confirm only intended stacks remain via `make ps-all` (BR-05R UAT +
    BR-04 test stack only).
  - [!] BR-05R UAT migration to root fixed ports happens when BR-05R corrections
    resume (its 5306 stack left up for now so the user can still review).

- [x] **Lot 6 — PLAN.md + merge & close**
  - [x] Record this branch + BR-05R in `PLAN.md` §1.
  - [x] Push branch; open PR #11; CI green (Branch policy + Quality gates).
  - [x] Merge commit only (`4e8256b`); branch preserved.
  - [x] Move this file to `plan/done/`.
</content>
