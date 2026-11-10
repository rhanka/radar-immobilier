# Feature: D2-C preprod artifact catalogue preservation across restores

## Objective
Survive prod-to-preprod restores without losing the preprod-only artifact catalogue: consistent export before the schema reset, controlled re-import after the replay and before reopening, byte-for-byte verified.

## Scope / Guardrails
- Scope limited to catalogue export/import engine, restore-path hook, cutover test wiring.
- No migration in `api/drizzle/*.sql`; no workflow file touched; bascule-preprod stays paused.
- Make-only workflow, `ENV` last, test stacks always `down -v`; never `ENV=dev`.
- Commits carry no trailer (owner decision 2026-11-02).
- No deploy, no merge, no cluster access, never read `.env`, no Python, no new image.
- Worktree `.worktrees/restore-persist` is user-assigned (see BR-D2-EX2).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/cutover/artifacts-catalogue.sh`
  - `deploy/cutover/artifacts-catalogue.test.mjs`
  - `deploy/cutover/artifacts-catalogue-persist.test.sh`
  - `deploy/cutover/atomic-restore.sh`
  - `tools/make/cutover-verify.sh`
  - `docs/spec/SPEC_EVOL_ARTIFACTS_RESTORE_PERSIST.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `.github/workflows/**`
  - `PREPROD_CD_ENABLED`, `BASCULE_SCHEDULE_ENABLED`, `.env`, any cluster state
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `../poc-k8s/**` (cross-repo work)
- **Exception process**:
  - Declare exception ID `BR-D2-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `BR-D2-EX1` (accepted): touch shared `tools/make/cutover-verify.sh` to wire the two new tests. Reason: only sanctioned gate for cutover tests. Impact: hermetic `test` runs one extra file; `test-api` installs postgresql-client and runs the persist test. Rollback: revert the two lines.
- `BR-D2-EX2` (accepted): branch work happens in user-assigned `.worktrees/restore-persist`, not `./tmp/<slug>`. Reason: conductor lane assignment. Impact: none on isolation (dedicated worktree, own test ENV). Rollback: n/a.
- `BR-D2-EX3` (accepted): commits via plain `git commit` (no `make commit`). Reason: owner bans all trailers; the make target appends one. Impact: message format unchanged otherwise. Rollback: n/a.
- `BR-D2-EX4` (accepted): bootstrap commits for the new CLI and persist test exceed ~150 lines. Reason: a new self-contained tool cannot land in fragments without breaking intermediate states. Impact: review happens per lot with green gates. Rollback: `git revert` per commit.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one engine, one branch, sequential lots L0-L5 with gates; PR per green milestone on the same branch.

## UAT Management (in orchestration context)
- UAT is always presented on the **root checkout**, `ENV=dev`, at the fixed
  ports (stable URL `http://localhost:5301`). Do NOT define a per-branch UAT
  port. See `rules/MASTER.md` → *UAT Environment* and `rules/conductor.md`.
- [ ] No UI surface in L0/L1: no UAT checkpoint before the authenticated preview lot.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read design-transition-astra-full, design-transition-muse, restore-diag, SUMMARY.
  - [x] Inventory destructive paths into `catalogue_destructive_paths` registry.
  - [x] Create branch file with scope boundaries and exceptions.
- [x] **Lot 1 — L0 early gate (GO/NO-GO before any transfer)**
  - [x] `gate` subcommand: size budget, pending intents, mapping coverage, prod refusal, source/target split.
  - [x] Hermetic registry + manifest/map policy tests.
  - [x] Lot gate: `make -f deploy/cutover/operator.mk test ENV=test-cutover`
- [x] **Lot 2 — L1 export/import engine in the restore path**
  - [x] `export` (consistent snapshot, manifest, fingerprints, sealed checksums).
  - [x] `import` (single-transaction load, version/column gates, identity remap, rollback on mismatch).
  - [x] `verify` byte-for-byte proof; `CATALOGUE_DIR` hook in `atomic-restore.sh`.
  - [x] Real PostgreSQL persist test with witness artifact through the restore path.
  - [x] Lot gate: `make -f deploy/cutover/operator.mk test-api ENV=test-cutover` (green 2026-11-02: witness byte-identical on daily, mapped and prepared paths)
- [ ] **Lot 3 — Durable BHS copy (s5cmd, Loi 25)**
  - [x] `archive` subcommand: sealed-only upload + read-back proof (count, generation), prod refusal.
  - [x] Hermetic stub-`s5cmd` contract tests (upload, refusal, drift, prod).
  - [ ] Engine Job wiring before any reset (new template; needs scope exception).
  - [ ] Retention pins vs GC; seven-day retention proposal.
  - [ ] Lot gate (same checklist as Lot 2)
- [ ] **Lot 4 — Blue/green (#956) and PG18 reuse + authenticated preview**
  - [ ] Prepared-database import path qualification; tuple instance/DB/generation.
  - [ ] Reader-only preview composition on the candidate; generation-bound grants.
  - [ ] Lot gate (same checklist as Lot 2)
- [ ] **Lot 5 — Supervised manual restore + campaign**
  - [ ] Runbook for the conductor with witness artifact and witness artifact checks.
  - [ ] Green campaignRc: restore, rotation, rollback-after-writes, storage failures.
  - [ ] Lot gate (same checklist as Lot 2)
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `docs/spec/SPEC_EVOL_ARTIFACTS_RESTORE_PERSIST.md` with final design decisions.
  - [ ] Update `PLAN.md` branch status.
  - [ ] Update this `BRANCH.md` with merge-ready state.
- [ ] **Lot N — PR & follow-ups (no merge, no deploy)**
  - [ ] Push branch.
  - [ ] Open PR when L0+L1 green; keep stacking lots on the same branch.
  - [ ] Verify CI green.
  - [ ] No merge, no deploy, branch preserved.
