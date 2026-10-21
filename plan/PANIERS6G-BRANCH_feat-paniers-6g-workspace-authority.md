# Feature: Paniers 6G — Workspace and membership authority

## Objective
Provide the workspace and membership authority for one team workspace: explicit identity, explicit memberships, separate archive-moderation and membership-management capabilities, audited grants, a single resolver reused by later sublots, and an idempotent operator initialization. No activation of workspace scope in existing reads or writes.

## Scope / Guardrails
- Scope limited to 6G files listed below. No change to existing facet readers, writers, routes, graph reads, MCP behavior, lot schema, or activation.
- One migration max in `api/drizzle/*.sql` (`0017_workspace_memberships.sql`). Never modify existing migrations.
- Explicit grants only: approval, invitation, or global administration never implies membership or capability.
- Real accounts are never hardcoded. Tests use synthetic accounts only.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in this worktree (already isolated). Do not use system `/tmp` for work.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- Verification: `ENV=test-paniers-6g`, API `18867`, UI `15867`, mail UI `11867`; no host ports published.
- All new text in English. Discussions with the user may be in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `plan/PANIERS6G-BRANCH_feat-paniers-6g-workspace-authority.md`
  - `api/drizzle/0017_workspace_memberships.sql`
  - `api/drizzle/meta/_journal.json`
  - `api/src/db/schema.ts`
  - `api/src/services/workspaces/**`
  - `api/src/routes/workspaces.ts`
  - `api/src/scripts/init-workspace-authority.ts`
  - `RAPPORT-MUSE-6G.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/drizzle/000*.sql` through `api/drizzle/0016*.sql`
  - `api/src/services/facets/**`
  - `api/src/services/graph/**`
  - `api/src/routes/signal-facets.ts`
  - `api/src/routes/graph-signals.ts`
  - `api/src/app.ts`
  - `api/tests/integration/**`
  - `packages/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `../poc-k8s/**` (cross-repo work)
  - `tools/make/paniers-lot6*`
- **Exception process**:
  - Declare exception ID `BR6G-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `BR6G-EX3`: adapt only `migrate-idempotence.spec.ts`, `artifacts-migrations.spec.ts` and `artifacts-provenance.spec.ts` under `api/tests/integration/` for appended migrations. Reason: CI assumes the artifact migrations end the journal. Impact: preserve hash, timestamp, replay and startup-guard checks while including every later migration; isolated Make entry and evidence stay under ignored `tmp/paniers-6g-ci/`. Rollback: restore these tests and this plan from `fd814416`.
- [x] CI integration correction: 2,774 API tests pass (32 conditional skips), API declarations build, two SQL guard tests pass, five copied mutations fail as expected then restore green, and all eight adapted-file tests pass with a copied future 0018; existing SQL stays unchanged.
- [x] CI build correction: merge origin/main, reproduce TS4023, explicitly type the Vitest collector with ReturnType<typeof describe.skipIf>; API declaration build, typecheck, scoped lint, 41 tests and 11 copied mutation checks pass.
- [x] Astra fix qualification: canonical locks, SQL revision guards and explicit-absence conflicts.
- [x] Astra fix qualification: withdrawals preserve revoked status and work on suspended accounts.
- [x] Astra fix qualification: deterministic service concurrency and stale-creation regression tests.
- [x] Astra fix qualification: HTTP withdrawal invariants and concurrent creation conflicts.
- [x] Astra fix qualification: LOT-specific default scopes and copied Make regression proof.
- [x] Astra fix qualification: copied assertion failures, byte restoration and checked commit snapshots.
- `BR6G-EX2`: extend `tools/make/paniers-lot6*` for SQL/HTTP regression tests, migration replay, copied mutation proofs, failure diagnostics and workspace-local commit/bundle delivery. Reason: complete the assigned integration qualification without reading environment files or writing shared Git metadata. Impact: isolated test tooling only; no application activation. Rollback: restore these tools from the base commit.
- [x] Integration qualification: corrected migration source lookup, enforced HTTP expected revisions and atomic commands, serialized authorization against revocation, verified SQL initialization/audit and all three copied mutations; 130 API, 209 UI and 66 MCP tests pass. Delivery uses individually typechecked snapshots, a workspace-local Git repository and a bundle; the French report remains uncommitted.
- `BR6G-EX1`: allow `LOT=6G` in `tools/make/paniers-lot6*`. The `mk` guard widens from `6F` to `6F|6G`; `paniers-lot6-verify.sh` lints the workspaces scope (instead of facets) and skips the 6F-only mutation proof when `LOT=6G`. Reason: the entry pins a single profile; without the wider gate the required `LOT=6G` invocation exits before running, and the 6F mutation would prove the wrong module. Impact: two guard lines, no change to compose files, ports, SCOPE plumbing, or cleanup. Rollback: restore the single-value guard and the unconditional lint/mutation lines.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (single reviewable sublot, no peer dispatch)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: 6G is a self-contained authority module with no activation; one branch, one test cycle.

## UAT Management (in orchestration context)
- UAT is always presented on the **root checkout**, `ENV=dev`, at the fixed
  ports (stable URL `http://localhost:5301`). Do NOT define a per-branch UAT
  port. See `rules/MASTER.md` → *UAT Environment* and `rules/conductor.md`.
- **Mono-branch**: no UI surface is impacted by 6G; no UAT checkpoint applies.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read reference design `/home/antoinefa/src/radar-immobilier/.lanes/conductor/tmp/paniers/conception-lot6-v2.md` §3.4 and `### 6G`.
  - [x] Confirm migration number: next free after `0016` is `0017`; never touch existing SQL.
  - [x] Confirm scope and guardrails; declare `BR6G-EX1` for the Make guard.
- [x] **Lot 1 — Schema and migration**
  - [x] `api/drizzle/0017_workspace_memberships.sql`: workspaces, memberships with revision, append-only audit, guards.
  - [x] `api/drizzle/meta/_journal.json`: append the `0017` entry.
  - [x] `api/src/db/schema.ts`: mirror the three tables for Drizzle.
  - [x] Lot gate: `typecheck`; migration static test; no existing test touched.
- [x] **Lot 2 — Resolver, capabilities, and store**
  - [x] `api/src/services/workspaces/types.ts`: identity, capabilities, errors.
  - [x] `api/src/services/workspaces/policy.ts`: pure checks, no administrator bypass.
  - [x] `api/src/services/workspaces/authority.ts`: explicit grants, revisions, audit.
  - [x] `api/src/services/workspaces/store.ts` + `mutations.ts` + `capabilities.ts`: Drizzle reads and writes with advisory locks.
  - [x] Lot gate: `typecheck` + scoped unit tests.
- [x] **Lot 3 — Initialization and reads**
  - [x] `api/src/services/workspaces/init.ts` + `init-store.ts`: idempotent operator initialization with receipt.
  - [x] `api/src/routes/workspaces.ts`: list route plus membership commands behind the management capability.
  - [x] `api/src/scripts/init-workspace-authority.ts`: CLI wiring account references to the initializer.
  - [x] Lot gate: `typecheck` + scoped unit tests; routes stay unmounted from `app.ts` until 6H.
- [x] **Lot 4 — Discriminating tests**
  - [x] Nonmember refused; member without capability refused.
  - [x] Manager without moderation cannot moderate, and moderator without management cannot manage.
  - [x] Global administrator without grant refused.
  - [x] Revocation effective; history references survive.
  - [x] Audit entry for every grant and revocation.
  - [x] Initialization idempotent: second run changes nothing and reports replay.
- [x] **Lot N-1 — Docs consolidation**
  - [x] Write `RAPPORT-MUSE-6G.md` in French (uncommitted): changes, tests, commit slicing, operator procedure, `not covered`.
- [ ] **Lot N — Merge & close (not covered; no push authorized)**
  - [ ] Push branch.
  - [ ] Open PR (or merge directly if solo dev).
  - [ ] Verify CI green.
  - [ ] Merge commit (NO squash, NO rebase merge).
  - [ ] Preserve branch (do NOT delete on merge).
  - [ ] Move this file to `plan/done/PANIERS6G-BRANCH_feat-paniers-6g-workspace-authority.md`.
