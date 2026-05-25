# Feature: <Title>

## Objective
<One or two sentences describing the goal.>

## Scope / Guardrails
- Scope limited to <areas>.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in repository-local isolated worktree `./tmp/<slug>` (even for one active branch). Do not use system `/tmp`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English. Discussions with the user may be in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `<path-or-glob-1>`
  - `<path-or-glob-2>`
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
  - `<other-sensitive-paths>`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
Actions with the following status should be included around tasks only if really required:
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: <Why this mode is selected>

## UAT Management (in orchestration context)
- UAT is always presented on the **root checkout**, `ENV=dev`, at the fixed
  ports (stable URL `http://localhost:5301`). Do NOT define a per-branch UAT
  port. See `rules/MASTER.md` → *UAT Environment* and `rules/conductor.md`.
- **Mono-branch**: UAT after each lot if UI surface impacted; present it by
  pointing the root checkout at this branch, then return root to its prior state.
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration.
- UAT checkpoints listed as checkboxes inside each relevant lot.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md` and pointers (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`).
  - [ ] Create/confirm isolated repository-local worktree `./tmp/<slug>` and run development there.
  - [ ] Capture Makefile targets needed for debug/testing.
  - [ ] Define environment mapping for **test/branch stacks only**
    (`test-<slug>`, `e2e-<slug>`, optional `feat-<slug>` dev stack) with a unique
    port block per `rules/conductor.md`. UAT uses the fixed root `dev` ports, not
    a per-branch port.
  - [ ] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [ ] Confirm scope and guardrails; declare `BRxx-EXn` exceptions if needed.

- [ ] **Lot 1 — <Main change>**
  - [ ] <Task 1>
  - [ ] <Task 2>
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint`
    - [ ] `make test ENV=test-<slug>`
    - [ ] `make test-e2e ENV=e2e-<slug>` (if UI/API surface impacted)

- [ ] **Lot 2 — <Next change>**
  - [ ] <Task 1>
  - [ ] <Task 2>
  - [ ] Lot gate (same checklist as Lot 1)

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `docs/spec/SPEC_EVOL_<topic>.md` with final design decisions.
  - [ ] Update `PLAN.md` branch status.
  - [ ] Update this `BRANCH.md` with merge-ready state.

- [ ] **Lot N — Merge & close**
  - [ ] Push branch.
  - [ ] Open PR (or merge directly if solo dev).
  - [ ] Verify CI green.
  - [ ] Merge commit (NO squash, NO rebase merge).
  - [ ] Preserve branch (do NOT delete on merge).
  - [ ] Move this file to `plan/done/NN-BRANCH_<slug>.md`.
