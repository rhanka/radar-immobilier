# Feature: ÉV1 Socle — states model + scoring grids

## Objective
Build the shared states + scoring foundation of the post-SOCLE evolution track:
enriched states model, six 0-5 grids with non-disponible renormalization + recommendation
cap, per-axis score envelope, grid versioning, the configurable "Grilles de score" view,
and the numeric calibration on the 3 real Valleyfield pilots.

## Scope / Guardrails
- Scope limited to `packages/radar-domain`, new `packages/radar-scoring`, the scoring UI, and one additive migration.
- One migration max in `api/drizzle/*.sql` (append-only journal + per-axis columns).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in `./tmp/socle-states-scoring` only. Do not use system `/tmp`.
- Automated test campaigns run on `ENV=test-socle-states-scoring`, never on root `dev`.
- UAT qualification worktree must be commit-identical to this branch (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text/code in English. Discussions with the user may be in French.
- Design reference: `docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md` (this branch) + `SPEC_EVOL_PROCESS_E2E.md`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md`
  - `packages/radar-domain/src/**`
  - `packages/radar-scoring/**`
  - `ui/src/lib/components/scoring/**`
  - `ui/src/lib/demo/**` (calibration fixture wiring only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit `BRxx-EXn` exception)**:
  - `api/drizzle/*.sql` (max 1 file — append-only journal + per-axis columns)
  - `api/src/services/**` (only the glue reading the new scoring aggregate)
- **Exception process**:
  - Declare exception ID `EV1-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- (none yet)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: domain schema → scoring package → fixture migration → UI are sequential and share one test cycle; no independent CI needed.

## UAT Management (in orchestration context)
- UAT is presented on the **root checkout**, `ENV=dev`, at fixed ports (stable URL `http://localhost:5301`).
- Mono-branch: UAT after the UI lot (Lot 4) by pointing the root checkout at this branch, then returning root to its prior state.
- UAT checkpoints are checkboxes inside the relevant lot.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md` and pointers (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`).
  - [ ] Confirm isolated worktree `./tmp/socle-states-scoring` and run development there.
  - [ ] Test stack env mapping: `test-socle-states-scoring` with ports `API=8813 / UI=5313 / MAILDEV_UI=1113` (no collision with root dev `8801/5301/1101`).
  - [ ] Confirm command style: `make ... ENV=<env>` with `ENV` last.
  - [ ] Confirm scope/guardrails; declare `EV1-EXn` for the `api/drizzle` migration.

- [ ] **Lot 1 — States model in `radar-domain` (TDD)**
  - [ ] Failing tests: lot `confirmed`/`zonePolygonSource`/`assemblyCandidate`; signal status enum; timeline + journal-entry shapes; per-datum provenance unchanged.
  - [ ] Implement the Zod schema extensions in `packages/radar-domain/src/schemas/opportunity.ts` (+ new `signal.ts`/`journal.ts` if cleaner).
  - [ ] Lot gate: `make typecheck` + `make lint` + `make test ENV=test-socle-states-scoring`.

- [ ] **Lot 2 — `radar-scoring` package: grids + aggregate (TDD)**
  - [ ] Failing tests for `aggregate()`: all-available; one-non-disponible renormalization; market-non-disponible; partial→cap `qualifier-avec-expert`; never-fabricate-neutral.
  - [ ] Implement v1 grids (§3.3), `aggregate()` with renormalization + cap (§3.4), grid versioning (§3.6), `AxisScore`/`OpportunityScore` envelopes (§3.5).
  - [ ] Implement pre-filter + micro-lot contiguity helpers (§2.1) with unit tests.
  - [ ] Lot gate (same checklist as Lot 1).

- [ ] **Lot 3 — Migrate the 3 pilots + calibration test**
  - [ ] Migrate `packages/radar-domain/src/valleyfield-dossiers.ts` to the enriched model (axis envelopes; market `non-disponible`).
  - [ ] Calibration test reproduces §5: scores `3.18 / 3.35 / 2.59`, all `partial`, all capped at `qualifier-avec-expert`.
  - [ ] Lot gate (same checklist as Lot 1).

- [ ] **Lot 4 — "Grilles de score" view + hover (UI)**
  - [ ] `ui/src/lib/components/scoring/**`: configurable grids screen + hover mini-grid (level highlighted, rationale/evidence/confidence/version) + partial/cap badges.
  - [ ] Component tests (vitest) for grid render + hover envelope + partial badge.
  - [ ] Lot gate: `make typecheck` + `make lint` + `make test ENV=test-socle-states-scoring` + `make build ENV=test-socle-states-scoring`.
  - [ ] UAT on root `dev` (point root checkout at this branch, then restore): Grilles view renders v1 grids + the calibrated pilot scores with correct partial/cap badges.

- [ ] **Lot 5 — Append-only journal migration (conditional path)**
  - [ ] Declare `EV1-EX1` (reason: persist decision journal + per-axis score columns; impact: 1 additive migration; rollback: drop table/columns).
  - [ ] `api/drizzle/*.sql`: append-only journal table (no `UPDATE`/`DELETE` at app role; `supersedes` column) + per-axis score columns.
  - [ ] Test the journal rejects `UPDATE`/`DELETE` at the app role.
  - [ ] Lot gate (same checklist as Lot 1).

- [ ] **Lot 6 — Docs consolidation**
  - [ ] Update `docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md` with any final decisions (open questions §9 resolved).
  - [ ] Update `PLAN.md` ÉV1 status.
  - [ ] Update this file with merge-ready state.

- [ ] **Lot 7 — Merge & close**
  - [ ] Push branch.
  - [ ] Open PR; verify CI green (full 40-char head SHA).
  - [ ] Merge commit (NO squash, NO rebase merge); preserve branch.
  - [ ] Move this file to `plan/done/EV1-BRANCH_feat-socle-states-scoring.md`.
