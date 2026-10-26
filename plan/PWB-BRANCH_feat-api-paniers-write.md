# PW-B — Atomic BASE admission for prepared signal writes

## Objective

- [x] Preserve Muse's eight uncommitted files in a local backup before editing.
- [x] Implement the v7 PW-B contract on top of `8c0ad35c950e97a47c892b9b4b70d6b5428b823f`.
- [x] Use `feat/api-paniers-write` in the repository-local worktree.

## Scope

- [x] Allowed Paths: `api/src/services/facets/signal-write-*`, `api/tests/integration/base-api-pwb-*`, this plan.
- [x] Conditional Paths: `scoped-writer.ts`, `workspace-writer.ts`, `projection-revisions.ts` for extracting shared transaction executors only.
- [x] Conditional Paths: `tools/make/base-api-pwb*` and PW-B contract documentation for qualification and the PW-D integration seam.
- [x] Forbidden Paths: migrations, schema, routes, unrelated services, root Makefile, compose files, rules, other branch plans, environment files.
- [x] Environment: `ENV=test-api-paniers-w`, `API_PORT=18928`, `UI_PORT=15928`, `MAILDEV_UI_PORT=11928`.
- [x] No push, deployment, activation, or migration authoring.

## Execution

- [x] Extract personal, workspace, and 6L1 executors without duplicating business logic.
- [ ] Qualify strict operations and canonical operation digests.
- [ ] Enforce fresh READ COMMITTED snapshots under workspace/actor/key/city locks.
- [ ] Require transactional PW-D authority, reservation, consumption, and audit hooks.
- [ ] Reject consumed confirmations and unexpected BASE receipts; consult immutable receipts separately.
- [ ] Check current authority and deadlines after waits; prove complete rollback.
- [ ] Preserve historical BASE HTTP wrappers and lot isolation.

## Verification

- [ ] Run scoped unit and PostgreSQL tests with no required skips.
- [ ] Run createApp plus PostgreSQL regressions.
- [ ] Kill authority, expiry, snapshot, and replay mutations.
- [ ] Run the API's complete CI include list, API typecheck, integration typecheck, build, and lint.
- [ ] Audit every commit: Conventional Commit subject only, at most 150 changed lines.
- [ ] Audit the incremental bundle in a fresh repository seeded only with the base.
- [ ] Deliver the French qualification report, full SHA, numstat, bundle path and SHA-256.
- [ ] Remove the isolated stack with volumes and orphans; verify no residual resources.

## Deferred integration

- [x] PW-D owns durable intentions, challenge state, immutable reservations, H5 fences, quota, and audit/outbox.
- [x] PW-B supplies an executable transaction port, not a substitute store or activation path.
- [x] Two-peer author-complementary review cannot be selected: Muse's exact author host/model/effort metadata is absent. No consensus is claimed.
