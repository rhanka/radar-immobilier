# Feature: 6F Lossless lot-migration report

## Objective
Build a read-only deterministic report mapping every `prospect_marks` row to its qualified lot-facet destination, listing conflicts for the 6K activation gate.

## Scope / Guardrails
- Scope limited to `api/src/services/facets/lot-migration-report/**` and `plan/PANIERS6F-BRANCH_*`.
- No migration in `api/drizzle/*.sql`.
- No business endpoint, no write path, no `prospect_marks` modification.
- No personal data inference from `author_id`; no automatic conflict resolution.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in repository-local isolated worktree `./tmp/<slug>` (even for one active branch). Do not use system `/tmp`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- Verification: `ENV=test-paniers-6f`, API `18866`, UI `15866`, mail UI `11866`; no host ports published.
- All new text in English. Discussions with the user may be in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/facets/lot-migration-report/**`
  - `plan/PANIERS6F-BRANCH_feat-paniers-6f-lot-migration-report.md`
  - `RAPPORT-MUSE-6F.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/drizzle/**`
  - `api/src/db/**`
  - `api/src/services/prospect/**`
  - `api/src/routes/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `../poc-k8s/**` (cross-repo work)
  - `tools/make/paniers-lot6.mk`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] BR6F-EX1: allow `tools/make/paniers-lot6*` for the requested isolated verification entry; synthetic configuration, no root Makefile or environment files, no host ports; rollback removes these standalone tools.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (isolated integrator checkout, no peer dispatch)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single read-only module with synthetic tests, no cross-surface impact.

## UAT Management (in orchestration context)
- UAT is always presented on the **root checkout**, `ENV=dev`, at the fixed
  ports (stable URL `http://localhost:5301`). Do NOT define a per-branch UAT
  port. See `rules/MASTER.md` → *UAT Environment* and `rules/conductor.md`.
- **Mono-branch**: UAT after each lot if UI surface impacted; present it by
  pointing the root checkout at this branch, then return root to its prior state.
- No UI surface is impacted by 6F; no UAT checkpoint applies.

## Plan / Todo (lot-based)
- [ ] **Lot 1 — Report contract and source inventory**
  - [x] `api/src/services/facets/lot-migration-report/types.ts`
  - [x] `api/src/services/facets/lot-migration-report/manifest.ts`
  - [ ] `api/src/services/facets/lot-migration-report/SPEC.md`
- [ ] **Lot 2 — Deterministic, read-only report builder**
  - [x] `api/src/services/facets/lot-migration-report/digest.ts`
  - [x] `api/src/services/facets/lot-migration-report/chains.ts`
  - [x] `api/src/services/facets/lot-migration-report/target.ts`
  - [x] `api/src/services/facets/lot-migration-report/shapes.ts`
  - [x] `api/src/services/facets/lot-migration-report/diagnose.ts`
  - [x] `api/src/services/facets/lot-migration-report/report.ts`
  - [x] `api/src/services/facets/lot-migration-report/index.ts`
- [ ] **Lot 3 — Synthetic and discriminating qualification**
  - [x] `api/src/services/facets/lot-migration-report/fixtures.ts`
  - [x] `api/src/services/facets/lot-migration-report/report.test.ts`
  - [x] `api/src/services/facets/lot-migration-report/contract.test.ts`
  - [ ] `api/src/services/facets/lot-migration-report/destinations.test.ts`
  - [ ] `api/src/services/facets/lot-migration-report/lossless.test.ts`
  - [ ] `api/src/services/facets/lot-migration-report/integrity.test.ts`
  - [ ] `api/src/services/facets/lot-migration-report/no-write-guard.test.ts`
  - [ ] `api/src/services/facets/lot-migration-report/source-db.test.ts`
- [ ] **Lot 4 — Isolated verification (BR6F-EX1)**
  - [ ] `tools/make/paniers-lot6.mk`
  - [ ] `tools/make/paniers-lot6-verify.sh`
  - [ ] `tools/make/paniers-lot6-mutation.sh`
  - [ ] API typecheck and facets lint pass in containers.
  - [ ] All `src/services/facets` tests, including the read-only DB test, pass.
  - [ ] Removing conflict detection in a copy fails tests; restoration passes `cmp` and tests.
  - [ ] Teardown removes this test project's containers, volumes and networks (`down -v`).
- [ ] **Lot 5 — Integrator delivery**
  - [ ] Every commit passes API typecheck and stays within 150 lines / 15 files.
  - [ ] Local fallback repository and bundle based on `7c56bb93` are verified.
  - [ ] French integrator report remains uncommitted.
- [ ] **Lot N — Merge & close**
  - [ ] Outside this task: no push, PR, CI or merge is authorized.
  - [ ] Push branch.
  - [ ] Open PR (or merge directly if solo dev).
  - [ ] Verify CI green.
  - [ ] Merge commit (NO squash, NO rebase merge).
  - [ ] Preserve branch (do NOT delete on merge).
  - [ ] Move this file to `plan/done/PANIERS6F-BRANCH_feat-paniers-6f-lot-migration-report.md`.
