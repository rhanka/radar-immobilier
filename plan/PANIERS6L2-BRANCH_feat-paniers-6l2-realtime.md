# Feature: Paniers 6L2 — Authorized real-time invalidations

## Objective

Emit minimal authorized invalidations over a browser-session SSE stream
under the selected workspace, and let each one invoke the 6L1 coherent
refetch. No global `replayAll`, no legacy marks/notes bus, no second
business-event ledger: durable 6L1 revisions stay the only authority.

## Scope / Guardrails

- Reference: `conception-lot6-v2.md` §3.6 + `### 6L2`.
  Dependencies: 6L1 (scoped revisions, coherent refetch, fixtures);
  6K for activation (retirement of old delivery paths).
- Activation stays guarded: the SSE route is NOT mounted in `app.ts`
  and the UI transport stays inactive until 6K retires the old read,
  write, connection, buffer and replica paths. Nothing here retires them.
- Existing guards stay the reference: account approval, workspace
  membership with capabilities, city selector, operation tokens, and the
  `viewerKey` incarnation (`signal-facet-scope.ts`). No parallel guard
  mechanism is introduced.
- The watcher checks account, membership and credential validity on every
  cycle, even without changes, and before every emission. Revocation
  closes the stream; the client clears its context through the
  authorization path.
- Initial connection, restart and incompatible cursor force
  resynchronization through the 6L1 coherent read. The cursor carries the
  viewer (`sub`), workspace, city, mode and token.
- Notifications may coalesce: delivery of every business transition is
  not promised. Steady cycles emit nothing observable.
- Watcher interval is configurable through
  `PROJECTION_WATCH_INTERVAL_MS` (default 1000 ms, range 100–30000 ms).
  The proposed 1 s default is qualified against convergence and
  deployment load during verification.
- Tests use synthetic data only; journal assertions stay unfrozen (no
  count/tag pinning). Fixture exports are annotated.
- Make-only workflow, no direct Docker; no host ports; `ENV` last.
- Verification: `ENV=test-paniers-6l2`, API `18872`, UI `15872`, Maildev `11872`.
- Every indexed commit passes typecheck; max 150 changed lines, 15 files.
- English Conventional Commits subjects, max 72 chars, no body or trailer.
- French reports uncommitted; no push authorized.

## Branch Scope Boundaries (MANDATORY)

- **Allowed**: this plan file; `api/src/services/facets/projection-invalidation.ts`;
  `api/src/services/facets/projection-invalidation.test.ts`;
  `api/src/services/facets/projection-invalidation-db.test.ts`;
  `api/src/routes/scoped-projection-events.ts`;
  `api/src/routes/scoped-projection-events-db.test.ts`;
  `ui/src/lib/signals/signal-projection-invalidation.ts`;
  `ui/src/lib/signals/signal-projection-invalidation-observer.ts`;
  `ui/src/lib/signals/signal-projection-invalidation.test.ts`;
  `ui/src/lib/signals/signal-projection-invalidation-lifecycle.test.ts`;
  `tools/make/paniers-lot6.mk`; `tools/make/paniers-lot6-verify.sh`;
  `tools/make/paniers-lot6l2-slices.txt`;
  `RAPPORT-MUSE-6L2.md` (uncommitted).
- **Conditional qualified**: none declared; any new conditional path needs
  a `BR6L2-EXn` entry (reason, impact, rollback) before touching it.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`, root docs,
  other branch plans, historical SQL migrations (none beyond 6L1),
  `app.ts` (route stays unmounted), existing facet readers/responses/
  targets/commands, scope/activation/attachment services, workspaces
  authority/mutations, MCP packages, frozen UI facet controls and views,
  6K cutover/retirement, the legacy marks/notes bus and chat `replayAll`.

- `BR6L2-EX1`: allow `api/src/routes/scoped-projection-events-cycle-db.test.ts`,
  `api/src/routes/scoped-projection-events-lifecycle.test.ts` and
  `ui/src/lib/signals/signal-projection-invalidation-races.test.ts`.
  Reason: qualify live cycles, credentials, cancellation and pending refetches.
  Impact: synthetic tests only. Rollback: remove these test files.
- `BR6L2-EX2`: allow `tools/make/paniers-lot6l2-{mutation,deliver}.sh`
  and the uncommitted `RAPPORT-SOL-6L2.md`. Reason: versioned copy proofs,
  atomic commits and local bundle with isolated Git metadata. Impact: test
  tooling and delivery only. Rollback: remove these files and bundle.
- `BR6L2-EX3`: allow `tools/make/paniers-lot6l2-fix-{deliver.sh,slices.txt}`.
  Reason: deliver review corrections above `960a9c4d` without shared Git writes.
  Impact: isolated commit checkpoints and a local bundle only.
  Rollback: remove the fix delivery files and generated bundle.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline**: read §3.6 + `### 6L2`; confirm no migration
  beyond 6L1; write this plan.
- [x] **Lot 1 — Helpers**: opaque cursor (viewer/workspace/city/mode/
  token), tick and reconnect decisions, authorized per-cycle poll,
  configurable watcher interval, SSE frame encoding.
- [x] **Lot 2 — Route**: guarded SSE under the workspace, initial-resync
  first frame, per-cycle authorization before emission, revocation close,
  coalesced invalidations, test seam for the first frames, unmounted.
- [x] **Lot 3 — API tests**: shared changes invalidate every member, private
  changes stay invisible, idle revocation closes, restart/lost cursor
  resync, late emission never precedes authorization.
- [x] **Lot 4 — UI transport**: gated signals and observer over the 6L1
  sync state, cursor tracking, revocation context clearing, failed refetch
  never acknowledged, late responses ignored.
- [x] **Lot 5 — UI tests**: two tabs, shared invalidation, private silence,
  idle revocation, restart, lost cursor, late response, failed refetch.
- [x] **Lot 6 — Make**: `LOT=6L2` guard, SCOPE, lint, regression patterns,
  versioned archiving of every file read by tests; slices file.
- [ ] **Lot N — Close (not covered)**: push, PR, remote CI,
  merge commit (no squash/rebase), keep branch, move plan to `plan/done/`.

- [x] Review fix 1: serialize reads and qualify deferred reconnect denials.
- [x] Review fix 2: bound SSE buffering and reauthorize resumed consumers.
- [x] Review fix 3: discriminate live ping and unavailable handling.
- [x] Review fix 4: qualify copy mutations and byte-for-byte restoration.
- [x] Review fix 5: version isolated incremental delivery and its audit.
- Delivery checkpoint: 22.
