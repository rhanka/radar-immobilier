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
  - `docs/spec/reviews/SPEC_EVOL_SOCLE_STATES_SCORING_*` (archived agent critiques)
  - `docs/superpowers/plans/**` (implementation plan)
  - `packages/radar-domain/src/**`
  - `packages/radar-domain/package.json` (add `@radar/scoring` dep if needed)
  - `packages/radar-scoring/**`
  - `packages/radar-scoring/**`
  - `ui/src/lib/components/scoring/**`
  - `ui/src/lib/scoring/**`
  - `ui/src/lib/demo/**` (views enum + calibration fixture wiring)
  - `ui/src/App.svelte`, `ui/src/lib/components/NavMenu.svelte` (wire the Grilles view into the switcher)
  - `ui/package.json` (add `@radar/scoring` dependency)
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
  - [ ] Failing tests: `Signal` entity (§2.0) + `signalId` 1→N link; lot `confirmed`/`zonePolygonSource`(+`other`)/`assemblyClusterId`/`metadata`; `SignalStatus`; `mode` on dossier + journal (§2.7); `Verification` += `simulé` (§2.6); timeline + journal-entry shapes (with `supersedes`).
  - [ ] Implement the Zod schema extensions (`packages/radar-domain/src/schemas/`: new `signal.ts`/`journal.ts`, extend `opportunity.ts`).
  - [ ] Lot gate: `make typecheck` + `make lint` + `make test ENV=test-socle-states-scoring`.

- [ ] **Lot 2 — `radar-scoring` package: grids + aggregate (TDD)**
  - [ ] Failing tests for `aggregate()`: all-available; one-non-disponible renormalization; market-non-disponible; **all-non-disponible → `tooThin` (no NaN)**; **`availableWeightSum < 0.50` floor**; **invalid input throws** (level out of `[0,5]`, missing/negative/NaN weight, unknown axis, `available ⇔ level≠null` mismatch); partial→cap `qualifier-avec-expert`; never-fabricate-neutral.
  - [ ] `mode`/`simulé` boundary test: a real-mode query/export excludes `mode === "simulation"` rows AND `verification === "simulé"` evidence (§2.7).
  - [ ] Implement v1 grids (§3.3), the availability doctrine (§3.4.0) + `aggregate()` with renormalization + floor + cap + invariant guards (§3.4), grid version stamp (§3.6), `AxisScore`/`OpportunityScore` envelopes (§3.5).
  - [ ] Implement pre-filter + micro-lot contiguity (`assemblyClusterId`) helpers (§2.1) with unit tests.
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

- [x] **Lot 5 — Append-only journal migration — DEFERRED to ÉV3**
  - Decision (post double-review): the journal/score *shapes* (Zod) ship in ÉV1; the SQL
    table + grant-hardening land in ÉV3 **with the first writer/reader**. Creating an
    unused table now is premature DB work (both v1 reviews flagged it). No `api/drizzle`
    change in this branch → the `api/drizzle` conditional path is NOT exercised; no
    `EV1-EX1` exception needed. See `SPEC_EVOL_SOCLE_STATES_SCORING.md` §7.

- [ ] **Lot 6 — Docs consolidation**
  - [ ] Update `docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md` with any final decisions (open questions §9 resolved).
  - [ ] Update `PLAN.md` ÉV1 status.
  - [ ] Update this file with merge-ready state.

- [ ] **Lot 7 — Merge & close**
  - [ ] Push branch.
  - [ ] Open PR; verify CI green (full 40-char head SHA).
  - [ ] Merge commit (NO squash, NO rebase merge); preserve branch.
  - [ ] Move this file to `plan/done/EV1-BRANCH_feat-socle-states-scoring.md`.
