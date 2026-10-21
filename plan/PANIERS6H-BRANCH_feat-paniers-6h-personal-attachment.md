# Feature: Paniers 6H — Personal-state attachment and scoped activation

## Objective
Bind qualified personal histories to explicit workspace streams, then replace
the workspace-blind head index and switch the writer epoch in one protected
transaction with no enforcement gap. Ambiguous histories and unresolved
null-result receipts stay pending, never converted. Existing behavior is
unchanged until activation runs; scoped routes stay unmounted from `app.ts`.

## Scope / Guardrails
- Base `ea15f263` (stacked on 6G); reference `conception-lot6-v2.md` §3.5,
  `### 6H`, and ratified D3. Dependencies: 6A, 6B, 6G. No 6K/6L behavior.
- One migration max (`0018_facet_scope_bindings.sql`); never modify existing
  migrations; never drop `facet_events_head_idx` outside the protected swap.
- Explicit destinations only: mapping and activation inputs arrive as operator
  arguments; real accounts never hardcoded; tests use synthetic data only.
- No personal-to-workspace conversion; archive streams keep a null basket.
- Scoped routes stay unmounted; no reader/SSE/buffer/replica retirement here.
- Make-only workflow, no direct Docker; no host ports; `ENV` always last.
- Verification: `ENV=test-paniers-6h`, API `18868`, UI `15868`, mail `11868`.
- Root checkout and `ENV=dev` stay reserved for UAT; work stays in worktree.
- Every indexed commit passes typecheck; max 150 changed lines, 15 files.
- English Conventional Commit subjects, max 72 chars, no body or trailer.
- French reports uncommitted; no push or remote integration authorized.

## Branch Scope Boundaries (MANDATORY)
- **Allowed**: this plan file; `api/drizzle/0018*`; `meta/_journal.json`;
  `api/src/db/schema.ts`; `api/src/services/facets/{scope,attachment-input,
  attachment,activation*,scope-db-fixture,scoped-reader,scoped-transition,
  scoped-writer}`; `api/src/services/facets/*.test.ts` (6H files only);
  `api/src/routes/scoped-signal-facets.ts`;
  `api/src/scripts/attach-personal-history.ts`;
  `packages/immo-mcp/src/{workspace-context*.ts,data-source.ts}`;
  `ui/src/lib/signals/signal-facet-scope*.ts`; `tools/make/paniers-lot6*`;
  `RAPPORT-MUSE-6H.md`.
- **Allowed by task**: `services/workspaces/{authority,authority.test,migration.test}.ts`;
  `routes/scoped-signal-facets-db.test.ts`; uncommitted `RAPPORT-SOL-6H.md`.
- **Conditional qualified**: `api/tests/integration/facets-constraints.spec.ts`
  uses TRUNCATE CASCADE to reach immutable guards despite new foreign keys.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`, root docs,
  other branch plans, `api/drizzle/000*.sql`–`0017*.sql`, existing facet
  services (`writer`, `commands`, `reader`, `response`, `target`, `codebook`,
  `private-response`), `graph/**`, other `services/workspaces/**`,
  `routes/{signal-facets,graph-signals,workspaces}.ts`, `app.ts`,
  `scripts/init-workspace-authority.ts`, `packages/immo-mcp/src/tools.ts`,
  `packages/immo-mcp/src/fixtures/**`, frozen UI facet controls and views.
- **Conditional**: `api/drizzle/*.sql` (max 1), `.github/workflows/**`,
  `tools/make/paniers-lot6*` — declare `BR6H-EXn` (reason, impact, rollback).

## Feedback Loop
- `BR6H-EX1`: widen `paniers-lot6*` guard to `6F|6G|6H`, add the 6H SCOPE
  profile and lint branch. Reason: the pinned entry gates on one profile.
  Impact: three lines; no compose, port, or cleanup change. Rollback:
  restore the guard and unconditional lint lines.
- `BR6H-EX2`: share 6G `checkRevision` with the reference authority and
  qualify explicit-null conflicts; let its journal guard accept later migrations.
  Reason: explicit integration task; impact limited to reference semantics/tests;
  rollback: restore these three files. Existing SQL authority is unchanged.
- `BR6H-EX3`: add copied-source mutations and staged-tree delivery in the
  workspace-local Git fallback. Reason: shared metadata is read-only and
  every <=150-line commit needs typechecking; impact: isolated Make tooling;
  rollback: remove 6H scripts and restore the 6G delivery targets.
- MCP scoped search fails closed until guarded graph delivery exists; omitted
  workspace arguments retain exact legacy URLs, including reveal behavior.
- Delivery requires deployment-supplied drain/readback callbacks; no operational
  caller supplies them in this branch. Unresolved scopes remain closed.
- `BR6H-EX4`: recover the 6G declaration-build target and annotate its
  `services/workspaces/db-fixture.ts` export. Reason: the exact API build
  reports TS4023 on the inherited fixture. Impact: type-only annotation and
  isolated Make targets/proofs/delivery; rollback: restore these hunks.
- [x] Astra fix 1: name both DB fixture exports for declaration builds.
- [x] Astra fix 2: preserve bound chains during successive activation.
- [x] Astra fix 3: recover exact pre-6A/6A receipts without writes.
- [x] Astra fix 4: accept historical HTTP payloads for recovery only.
- [x] Astra fix 5: compare viewer incarnations by object identity.
- [x] Astra fix 6: qualify source-copy mutations and their restoration.
- [x] Astra fix 7: deliver typechecked atomic commits and a verified bundle.
- [x] Second pass: compare activation to the current journal and return scoped conflict heads.
- [x] Integration qualification: migration replay, 6A–6G non-regression,
  attachment idempotency, ambiguous-pending, SQL enforcement, activation
  recovery, UI/MCP suites.
- [x] Discriminating copies: uniqueness, delivery-safety gate, epoch gate,
  attachment replay and no conversion; assertion failures, restoration and cmp.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: read §3.5 + `### 6H`; next free number `0018`;
  declare `BR6H-EX1`; write this plan.
- [x] **Lot 1 — Schema**: `0018` streams (`NULLS NOT DISTINCT`), immutable
  bindings, head registry, attachments + pending, receipt contexts,
  activation state, deferred check, swap function; journal; schema mirror.
- [x] **Lot 2 — Attachment**: `scope.ts` keys/decisions/gate;
  `attachment-input.ts` guard; `attachment.ts` idempotent operator mapping;
  `attach-personal-history.ts` CLI; scoped unit tests.
- [x] **Lot 3 — Activation**: `activation.ts` state + qualification;
  `activation-run.ts` barrier/drain/bind/swap/open; `scoped-reader.ts`
  viewer-only 503-gated reads; `scoped-{transition,writer}.ts` 6A/6B per
  scope; `scoped-signal-facets.ts` unmounted routes.
- [x] **Lot 4 — MCP/UI**: `workspace-context.ts` explicit resolution;
  `data-source.ts` optional forwarding (legacy URL preserved); UI scope
  guards discarding late responses.
- [x] **Lot 5 — Tests**: per-workspace isolation, duplicate rejection,
  chain sealing, idempotent replay, ambiguous pending, no conversion,
  golden preservation, lots 2–6G non-regression.
- [x] **Lot N-1 — Docs**: uncommitted French Muse and Sol reports.
- [ ] **Lot N — Close (not covered)**: verify green, push, PR, CI, merge
  commit (no squash/rebase), keep branch, move plan to `plan/done/`.
- [x] Delivery checkpoint: 35

- [x] Fix2 integration checkpoint: `9631a885`.

- [x] Fix2 integration checkpoint: `2059d46e`.

- [x] Fix2 integration checkpoint: `3c995c46`.

- [x] Fix2 integration checkpoint: `f1fae596`.

- [x] Fix2 integration checkpoint: `04018337`.

- [x] Fix2 integration checkpoint: `4bbad866`.

- [x] Fix2 integration checkpoint: `a14c1e5c`.

- [x] Fix2 integration checkpoint: `7cae8430`.

- [x] Fix2 integration checkpoint: `f8289f08`.

- [x] Fix2 integration checkpoint: `56bdad6f`.

- [x] Fix2 integration checkpoint: `23d09114`.

- [x] Fix2 integration checkpoint: `348de870`.

- [x] Fix2 integration checkpoint: `76b55af1`.

- [x] Fix2 integration checkpoint: `2293a9d5`.

- [x] Fix2 integration checkpoint: `4935a0a9`.

- [x] Fix2 integration checkpoint: `a0c929c4`.

- [x] Fix2 integration checkpoint: `f88b966d`.

- [x] Fix2 integration checkpoint: `84df9da3`.

- [x] Fix2 integration checkpoint: `776bc663`.
- [x] Fix2 integration checkpoint: `5274491c`.
- [x] Fix2 integration checkpoint: `131183b0`.
- [x] Fix2 integration checkpoint: `f480a0b7`.
- [x] Fix2 integration checkpoint: `3e20e195`.
- [x] Fix2 integration checkpoint: `0ffb286c`.
- [x] Fix2 integration checkpoint: `3159c65e`.
- [x] Fix2 integration checkpoint: `37c81465`.
- [x] Fix2 integration checkpoint: `3ccc815c`.
- [x] Fix2 integration checkpoint: `f71a1f56`.
- [x] Fix2 integration checkpoint: `6425004e`.
- [x] Fix2 integration checkpoint: `c14baa3e`.
- [x] Fix2 integration checkpoint: `c0868bc6`.
- [x] Fix2 integration checkpoint: `70bbaa6a`.
- [x] Fix2 integration checkpoint: `4e640fe3`.
- [x] Fix2 integration checkpoint: `4cf4f2e8`.
- [x] Fix2 integration checkpoint: `7bee7480`.
- [x] Fix2 integration checkpoint: `b984d1e0`.
- [x] Fix2 integration checkpoint: `ee414850`.
- [x] Fix2 integration checkpoint: `1eb85407`.
- [x] Fix2 integration checkpoint: `c68a230f`.
- [x] Fix2 integration checkpoint: `39f863ec`.
- [x] Fix2 integration checkpoint: `ff5b8833`.
- [x] Fix2 integration checkpoint: `b0ffb300`.
- [x] Fix2 integration checkpoint: `90638353`.
- [x] Fix2 integration checkpoint: `c21da28d`.
- [x] Fix2 integration checkpoint: `d02954fa`.
