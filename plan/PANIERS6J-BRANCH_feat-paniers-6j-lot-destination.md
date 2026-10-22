# Feature: Paniers 6J — Lot destination, commands and preserved history

## Objective

Install the lot destination schema, the four-facet lot command contract
(selection, archive, pipeline, market), the synthetic importer, and the
scoped history readers behind a closed activation gate. Operational lot
writes stay disabled until 6K. No D5 input is required.

## Scope / Guardrails

- Base: this worktree (`feat/paniers-6j-lot-destination`), stacked on main
  (6F report) plus 6G + 6H + 6I; reference `conception-lot6-v2.md` §3.7 +
  `### 6J`, ratified D4; D5 stays at the 6K gate only.
- One migration max (`0020_facet_lot_history.sql`); never modify existing
  migrations; never modify `prospect_marks` or its indexes.
- Contracts 6A (expected head, 409 with authorized state) and 6B
  (displayed version) apply per lot stream; mode is explicit in stream
  scope; `author_id` never assigns ownership.
- New routes stay unmounted in `app.ts`; legacy mark routes untouched; no
  reader/SSE/buffer/replica retirement here.
- Tests use synthetic data only; the 6F report is the correspondence
  source; real accounts never hardcoded.
- Make-only workflow, no direct Docker; no host ports; `ENV` last.
- Verification: `ENV=test-paniers-6j`, API `18870`, UI `15870`, Maildev `11870`.
- Every indexed commit passes typecheck; max 150 changed lines, 15 files.
- English code, tests and commit subjects (max 72 chars, no body/trailer);
  French reports uncommitted; no push authorized.

## Branch Scope Boundaries (MANDATORY)

- **Allowed**: this plan file; `api/drizzle/0020_*`;
  `api/drizzle/meta/_journal.json` (append-only entry);
  `api/src/db/schema.ts` (additive lot mirrors only);
  `api/src/services/facets/lots/**`;
  `api/src/routes/scoped-lot-*.ts`;
  `tools/make/paniers-lot6*`; `tools/make/paniers-lot6j-*`;
  `RAPPORT-MUSE-6J.md`.
- **Conditional qualified**: none. 6G/6H/6I services, routes, fixtures and
  tests are reused by import only, never edited (`BR6J-EXn` required
  otherwise, with reason, impact and rollback).
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`,
  root docs, other branch plans, `api/drizzle/000*.sql`–`0019*.sql`,
  `api/src/services/prospect/**`, `api/src/routes/{signal-facets,
  prospect-marks,graph-signals,workspaces}.ts`, `app.ts`, MCP packages,
  frozen UI facet controls and views (`LotFichePanel.svelte` unchanged).

## Feedback Loop

- Delivery uses individually typechecked snapshots; the French report
  remains uncommitted.
- `BR6J-EX1`: widen the `paniers-lot6*` guard to `6F|6G|6H|6I|6J`, add the
  6J SCOPE profile and lint branch. Reason: the entry gates on pinned
  profiles; without the wider gate the required `LOT=6J` invocation exits
  before running. Impact: guard line, one SCOPE branch, one lint branch;
  no compose, port, or cleanup change. Rollback: restore the four-value
  guard and drop the 6J branches.
- `BR6J-EX2`: new versioned runner `paniers-lot6j-run.sh` archives every
  file read by the 6J tests (manifest + sha256 under the evidence dir).
  Reason: the task requires a versioned launcher with full read archiving.
  Impact: one new script plus one `mk` target; no compose change.
  Rollback: delete the script and the target.
- Review corrections: reject `legacy-unknown` on ordinary commands; refuse
  common archive from contributors; keep personal restore without workspace
  effect; return 422 for omitted market fields; conflict payloads expose
  authorized heads only.
- Delivery checkpoint: 29.
- `BR6J-EX5`: adapt integration constraint names and the 6H upgrade
  snapshot to additive lot columns. Preserve every historical value and
  classified signal selection; no prior migration changes. Impact: two
  existing test files; rollback: revert those test assertions.
- `BR6J-EX4`: await socket closure in `scope-db-fixture.ts` before dropping
  synthetic databases. Evidence: 115 passing tests still exited with
  uncaught `57P01` on a closing pooled client during forced teardown.
  Impact: test cleanup only; rollback: restore the previous pool teardown.
- `BR6J-EX3`: complete the existing split lot routers, runner archive,
  synthetic SQL/replay tests and local delivery scripts. Reason: required
  qualification and individually typechecked commits. Impact: 6J paths
  only; all source, SQL, UI and MCP inputs are archived without environment
  files. Rollback: remove the 6J delivery and verification additions.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline**: read §3.7 + `### 6J` + D4; next free number
  is `0020`; write this plan.
- [x] **Lot 1 — Schema**: `0020` lot streams/mode/values/provenance,
  destination gate, import runs/evidence, lot capability grants/events;
  journal entry; schema mirror. Replayable guards; signal constraints
  preserved for signal rows.
- [x] **Lot 2 — Target/version DTOs**: stable lot identity, fingerprint
  over stored source fields, UUID vs content-change conflicts.
- [x] **Lot 3 — Values**: canonical decimal price, public URL contract,
  complete market replacement, pipeline values, import-only provenance.
- [x] **Lot 4 — Commands**: `lot-facets-v1` digest incl. every batch item;
  strict DTOs rejecting client actor/owner/scope fields.
- [x] **Lot 5 — Capabilities/gate**: distinct select/pipeline/market
  grants, moderator archive, closed destination gate, disabled importer.
- [x] **Lot 6 — Writer**: four families, independence, composite
  discard/deselect, 409 head/version, atomic batch, exact replay.
- [x] **Lot 7 — Reader/history**: independent facet heads, capabilities,
  effective hiding, paginated destination + source history.
- [x] **Lot 8 — Importer**: exact-once evidence, head-only init,
  legacy-unknown exception, pending dispositions, no author ownership.
- [ ] **Lot 9 — Routes**: scoped reads/commands/batch, browser-session
  writes, unmounted; mapping table for `LotFichePanel` actions.
- [ ] **Lot 10 — Fixtures**: synthetic workspace/lots/manifest builders,
  annotated exports, disposable databases.
- [ ] **Lot 11 — Tests**: facet independence, atomic batch, 409
  head/version, D4 rights, moderator-only common archive, no author_id
  ownership, exact-once import, disabled importer.
- [ ] **Lot 12 — Make**: `LOT=6J` guard, SCOPE, lint; versioned runner
  archiving every file read by tests; build and regression covered.
- [ ] **Lot N-1 — Docs**: uncommitted French `RAPPORT-MUSE-6J.md`.
- [ ] **Lot N — Close (not covered)**: verify green, push, PR, CI, merge
  commit (no squash/rebase), keep branch, move plan to `plan/done/`.
