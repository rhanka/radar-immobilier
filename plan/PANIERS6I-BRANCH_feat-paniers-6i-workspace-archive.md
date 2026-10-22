# Feature: Paniers 6I — Workspace archive and moderator controls

## Objective

Give moderators an explicit workspace archive while keeping personal
archives private and independent. Only a moderator may change
`D(workspace)`; changing a personal basket or restoring a personal
archive can never lift a workspace archive. Reads return personal and
workspace heads separately so the UI can explain effective hiding
without exposing another member's private state.

## Scope / Guardrails

- Base: this worktree (`feat/paniers-6i-workspace-archive`), stacked on
  6G + 6H; reference `conception-lot6-v2.md` §3.4 + `### 6I`, and
  `SPEC_PANIERS_ECARTES_STEVE.md` §4.2 rule O2. No 6J/6K/6L behavior.
- One migration max (`0019_facet_workspace_archive.sql`); never modify
  existing migrations; never mount new routes in `app.ts`.
- Contracts 6A (expected head, 409 with authorized state) and 6B
  (displayed version) apply to workspace archive commands.
- No existing read or write changes until activation runs; scoped routes
  stay unmounted. No reader/SSE/buffer/replica retirement here.
- Tests use synthetic data only; real accounts never hardcoded.
- Make-only workflow, no direct Docker; no host ports; `ENV` last.
- Verification: `ENV=test-paniers-6i`, API `18869`, UI `15869`.
- Every indexed commit passes typecheck; max 150 changed lines, 15 files.
- English Conventional Commits subjects, max 72 chars, no body or trailer.
- French reports uncommitted; no push authorized.

## Branch Scope Boundaries (MANDATORY)

- **Allowed**: this plan file; `api/drizzle/0019*`;
  `meta/_journal.json`; `api/src/db/schema.ts`;
  `api/src/services/facets/{workspace-writer,workspace-reader,
  workspace-streams,workspace-discarded,workspace-archive-fixture,
  workspace-*.test}.ts`;
  `api/src/routes/scoped-workspace-archive*.ts`;
  `ui/src/lib/signals/signal-facet-workspace*.ts`;
  `tools/make/paniers-lot6*`; `RAPPORT-MUSE-6I.md`; `RAPPORT-SOL-6I.md`.
- **Conditional qualified**: `tools/make/paniers-lot6-verify.sh`
  — declare `BR6I-EXn` (reason, impact, rollback).
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`,
  root docs, other branch plans, `api/drizzle/000*.sql`–`0018*.sql`,
  existing facet services (`writer`, `commands`, `reader`, `response`,
  `target`, `codebook`, `private-response`, `scoped-*`, `activation*`,
  `attachment*`, `scope*`), `graph/**`, other `services/workspaces/**`,
  `routes/{signal-facets,graph-signals,workspaces}.ts`, `app.ts`,
  MCP packages, frozen UI facet controls and views.

## Feedback Loop

- `BR6I-EX1`: widen `paniers-lot6*` guard to `6F|6G|6H|6I`, add the 6I
  SCOPE profile and lint branch. Reason: the entry gates on pinned
  profiles; without the wider gate the required `LOT=6I` invocation
  exits before running. Impact: guard line, one SCOPE branch, one lint
  branch; no compose, port, or cleanup change. Rollback: restore the
  single-value guard and the unconditional lint lines.
- Delivery uses individually typechecked snapshots; the French report
  remains uncommitted.
- Delivery checkpoint: 17.
- `BR6I-EX2`: narrow personal owners in `activation-bind.ts` after the
  schema permits null workspace owners. Typecheck proves the old chain
  input no longer fits. Reject null personal owners; no history rewrite.
  Rollback: revert the narrowing when reverting the nullable schema.
- `BR6I-EX3`: extend the isolated runner with full CI API coverage,
  ontology fixtures, source-copy discrimination and checked 6I delivery.
  Impact: test-only container actions and workspace-local Git metadata.
  Rollback: remove the 6I actions and scripts; no operational change.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline**: read §3.4 + `### 6I` + O2; next free
  number is `0019`; write this plan.
- [ ] **Lot 1 — Schema**: `0019` workspace scope, null business owner,
  moderator attribution, archive-only workspace events; journal entry;
  schema mirror. Replayable (`IF EXISTS`, `CREATE OR REPLACE` style
  guards, `DO` blocks for constraints).
- [ ] **Lot 2 — Writer**: `workspace-writer.ts` moderator-only
  discard/restore with 6A/6B checks, workspace stream lock, terminal
  registration, actor-keyed receipt with workspace context.
- [ ] **Lot 3 — Reader**: `workspace-reader.ts` separate personal and
  workspace heads, effective hiding, capabilities; never exposes
  another member's personal state, including in conflicts.
- [ ] **Lot 4 — Union**: `workspace-discarded.ts` scoped union
  `D(viewer) = D(workspace) ∪ D(personal viewer)`; legacy readers
  untouched.
- [ ] **Lot 5 — Routes**: `scoped-workspace-archive.ts` guarded
  workspace discard/restore and city projection; unmounted.
- [ ] **Lot 6 — UI client**: `signal-facet-workspace.ts` intention
  builder, effective-hiding helpers; no existing view wiring.
- [ ] **Lot 7 — Tests**: moderator allowed, contributor refused,
  personal restore without workspace effect, stale-head 409,
  no private-state leak, version conflict, duplicate-terminal
  enforcement in both workspaces with null-basket archives
  (6H review reprise), HTTP authorization and conflicts.
- [ ] **Lot 8 — Make**: `LOT=6I` guard, SCOPE, lint; build and
  regression targets covered.
- [ ] **Lot N-1 — Docs**: uncommitted French `RAPPORT-MUSE-6I.md`.
- [ ] **Lot N — Close (not covered)**: verify green, push, PR, CI,
  merge commit (no squash/rebase), keep branch, move plan to
  `plan/done/`.
