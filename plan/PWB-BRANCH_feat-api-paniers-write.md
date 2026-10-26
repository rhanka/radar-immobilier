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
- [x] Environment: `ENV=test-api-paniers-w`, `API_PORT=18930`, `UI_PORT=15930`, `MAILDEV_UI_PORT=11930`.
- [x] No push, deployment, activation, or migration authoring.

## Execution

- [x] Extract personal, workspace, and 6L1 executors without duplicating business logic.
- [x] Qualify strict operations and canonical operation digests.
- [x] Enforce fresh READ COMMITTED snapshots under workspace/actor/key/city locks.
- [x] Require transactional PW-D authority, reservation, consumption, and audit hooks.
- [x] Reject consumed confirmations and unexpected BASE receipts; consult immutable receipts separately.
- [x] Check current authority and deadlines after waits; prove complete rollback.
- [x] Preserve historical BASE HTTP wrappers and lot isolation.

## Verification
- [x] Reproduce two real `55P03` failures as `500 internal_error`, then normalize execution-only failures to `503 write_fence_unavailable`.
- [x] Assert the actual PostgreSQL SQLSTATE `55P03` in both contention probes before checking the public refusal.
- [x] Prepare a separate incremental delivery audit rooted exactly at `b09a8ccccab5d7256c0a08b8b93979dbec57b65f`.
- [ ] Requalify all PW-B tests, five targeted mutations and CI API gates after the Astra corrections.
- [x] Wait for the shared campaign lock with resource checks before testing, without touching other stacks.
- [x] Add real audit-lock contention regressions for both transaction owners and preserve commit acknowledgement uncertainty.
- [x] Require exact structured outcomes for every mutation, including committed bypasses and restored refusal codes.
- [x] Replace authority and digest false-positive probes with current-token commit and direct digest evidence.
- [x] Add assertion-qualified mutation legs and independent local bundle verification.

- [x] Add a serial Docker-only campaign with resource monitoring and guarded teardown.

- [x] Document the transactional seam and qualify unchanged createApp BASE wrappers.

- [x] Exercise real source and workspace waits, revoked authority and expired admissions.

- [x] Compare all BASE tables after expiry, audit failure, unrelated receipts and caller rollback.

- [x] Prove concurrent confirmation exclusion and atomic composite BASE transitions.

- [x] Exercise moderation, independent restoration, private receipts and unresolved history.

- [x] Exercise personal commits, stale heads, versions, tokens and expired admissions.

- [x] Qualify strict operation variants, digest stability and masked internal errors.

- [x] Add authorized immutable receipt consultation and closed public event projections.

- [x] Add mandatory PW-D hooks, fresh source-fenced snapshots and final deadline checks.

- [x] Add canonical digests, shared scope helpers and a synthetic transactional test port.


- [x] Run scoped unit and PostgreSQL tests with no required skips.
- [x] Run createApp plus PostgreSQL regressions.
- [x] Kill authority, expiry, snapshot, replay and digest mutations: green/red/green, restored SHA-256 identities verified.
- [x] Run the complete CI API include list: 3923 passed, 76 conditional skips, zero failures; 38 required PW-B tests passed without skips.
- [x] Pass API typecheck, BASE/PW-B integration typecheck, API build and complete API lint on `c718a52364b66b41cd6972f7e3b5ba0d27b9dc20`.
- [x] Audit every commit: Conventional Commit subject only, at most 150 changed lines.
- [x] Audit the incremental bundle in a fresh repository seeded only with the base.
- [x] Deliver the local French qualification report with full SHA, numstat, bundle path and SHA-256.
- [x] Remove the isolated stack with volumes and orphans; no residual project resources.

## Deferred integration

- [x] PW-D owns durable intentions, challenge state, immutable reservations, H5 fences, quota, and audit/outbox.
- [x] PW-B supplies an executable transaction port, not a substitute store or activation path.
- [x] Two-peer author-complementary review cannot be selected: Muse's exact author host/model/effort metadata is absent. No consensus is claimed.
