# Feature: Paniers 6L1 — Authorized revisions and coherent refetch

## Objective

Let an authorized viewer detect staleness and reload heads, detail, and
counts coherently (same revision before and after the fetch), without any
cross-scope or cross-account leak. No real-time transport here (6L2 owns
it); no legacy reader/buffer retirement here (6K owns it).

## Scope / Guardrails

- Reference: `conception-lot6-v2.md` §3.6 + `### 6L1`.
  Dependencies: 6I (union reads, moderator archive), 6C (MCP reveal
  stays on the server hiding predicate), 6D (evidence/counter populations
  stay distinct; a successful refetch rebuilds them, it never merges them).
- Existing guards stay the reference: account approval, workspace
  membership with capabilities, city selector, operation tokens, and the
  `viewerKey` incarnation (`signal-facet-scope.ts`). No parallel guard
  mechanism is introduced.
- Revision tokens depend only on: the viewer's personal state in the
  workspace, the applicable workspace state, the viewer's applicable
  permissions, the source revisions covering the loaded populations, and
  the selected mode. No global private-event counter, no `MAX(created_at)`.
- Revisions increment inside the mutation transaction. Reads sample the
  revision before and after fetching heads/detail/aggregates, acknowledge
  only a successful coherent result, retry boundedly on drift, otherwise
  keep a stale/unavailable state.
- Source coverage: every supported graph writer bumps the city source
  revision through the existing per-city lock. A facet-only cursor never
  claims graph consistency. Lot writers belong to 6J/6K: `mode` is
  accepted but restricted to `signal` until they qualify.
- One migration max, replayable, additive only, allocated as `0020`.
  If 6J also takes `0020` at merge time, rename this file and its journal
  entry to the next free number; the statements themselves do not change.
- Activation is guarded: new routes are NOT mounted in `app.ts`. No
  current read changes while inactive.
- Tests use synthetic data only; journal assertions stay unfrozen (no
  count/tag pinning). Fixture exports are annotated.
- Make-only workflow, no direct Docker; no host ports; `ENV` last.
- Verification: `ENV=test-paniers-6l1`, API `18871`, UI `15871`.
- Every indexed commit passes typecheck; max 150 changed lines, 15 files.
- English Conventional Commits subjects, max 72 chars, no body or trailer.
- French reports uncommitted; no push authorized.

## Branch Scope Boundaries (MANDATORY)

- **Allowed**: this plan file; `api/drizzle/0020_facet_projection_revisions.sql`
  (renumberable, see above); `api/drizzle/meta/_journal.json` (one entry);
  `api/src/db/schema.ts` (three tables only);
  `api/src/services/facets/projection-scope.ts`;
  `api/src/services/facets/projection-revisions.ts`;
  `api/src/services/facets/projection-scope.test.ts`;
  `api/src/services/facets/projection-revisions-fixture.ts`;
  `api/src/services/facets/projection-revisions-db.test.ts`;
  `api/src/services/facets/scoped-writer.ts` (revision bump only);
  `api/src/services/facets/workspace-writer.ts` (revision bump only);
  `api/src/services/graph/graph-store.ts` (source-revision hook only);
  `api/src/routes/scoped-projection-revisions.ts`;
  `api/src/routes/scoped-projection-revisions-db.test.ts`;
  `ui/src/lib/signals/signal-projection-revision.ts`;
  `ui/src/lib/signals/signal-projection-revision.test.ts`;
  `tools/make/paniers-lot6.mk`; `tools/make/paniers-lot6-verify.sh`;
  `tools/make/paniers-lot6l1-slices.txt`;
  `RAPPORT-MUSE-6L1.md` (uncommitted).
- **Conditional qualified**: none declared; any new conditional path needs
  a `BR6L1-EXn` entry (reason, impact, rollback) before touching it.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`, root docs,
  other branch plans, historical SQL migrations, `app.ts` (routes
  stay unmounted), existing facet readers/responses/targets/commands,
  scope/activation/attachment services, workspaces authority/mutations
  (membership revisions already increment there), MCP packages, frozen UI
  facet controls and views, 6L2 transport, 6K cutover/retirement.

## Feedback Loop

- BR6L1-EX1: allocate the next free migration number, 0020, rather than
  leaving provisional gaps 0020/0021. 6J may also allocate 0020; integration
  must order these additions. Rollback: rename the SQL and journal tag.
- BR6L1-EX2: add projection race/migration tests, UI lifecycle tests, and
  `tools/make/paniers-lot6l1-*.sh` for discrimination/delivery. These
  qualify the requested scope; no active reader or UI is changed.
- BR6L1-EX3: French reports `RAPPORT-*-6L1.md` remain uncommitted.
- BR6L1-EX4: change only the disposable DB teardown in
  `api/src/services/facets/scope-db-fixture.ts`: forced removal races
  closing pool clients (observed 57P01 in the complete API suite). Normal
  removal waits for disconnects and still fails on leaks. Rollback: restore FORCE.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline**: read §3.6 + `### 6L1`; confirm next free
  migration number at merge time; write this plan.
- [x] **Lot 1 — Schema**: `0020` personal/workspace projection revisions
  plus city graph source revisions; journal entry; schema mirror.
- [x] **Lot 2 — Token**: pure `projection-scope.ts` composition and city
  content digest (community excluded); no counters, no timestamps.
- [x] **Lot 3 — Revisions**: bump helpers; facet bumps on appended
  transitions only (no-op and replay bump nothing); source bump only when
  served signal content changes.
- [x] **Lot 4 — Reads**: authorized scope read (approval, membership with
  capabilities, epoch, unresolved history) plus bounded coherent refetch.
- [x] **Lot 5 — Routes**: guarded token and coherent-city routes, private
  caching, unmounted.
- [x] **Lot 6 — UI**: reconciliation coordinator over `viewerKey`
  incarnation and workspace guards; superseded responses ignored; failed
  reads retain the last acknowledged snapshot.
- [x] **Lot 7 — Tests**: revision visible only when authorized; coherent
  reload after revision; superseded response ignored; no leak (personal,
  workspace, source, membership, mode cases).
- [x] **Lot 8 — Make**: `LOT=6L1` guard, SCOPE, lint, regression patterns;
  delivery targets refuse 6L1 (no delivery profile ships here); slices file.
- [x] **Lot N-1 — Docs**: uncommitted French Muse and SOL reports.
- [ ] **Lot N — Close (not covered)**: run verification, push, PR, CI,
  merge commit (no squash/rebase), keep branch, move plan to `plan/done/`.

- [x] Review correction 1: guard rebuild after the final async boundary; qualify disposal and account switching.
- [x] Review correction 2: return coherent displayed fingerprints; qualify a subsequent 6B command.
- [x] Review correction 3: locate the migration by identity; replay its suffix with a later migration.
- [x] Review correction 4: discriminate all three review regressions on restored source copies.

- Delivery checkpoint: 25.
